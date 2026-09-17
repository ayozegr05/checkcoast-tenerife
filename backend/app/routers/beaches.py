from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import (
    Beach,
    BeachIncident,
    BeachMeasurement,
    BeachState,
    BeachStatus,
)
from app.queries import beaches_with_latest_status
from app.schemas import (
    BeachIncidentOut,
    BeachMeasurementOut,
    BeachStatsOut,
    BeachStatusIn,
    BeachStatusOut,
    Feature,
    FeatureCollection,
    PointGeometry,
)

router = APIRouter(tags=["beaches"])


@router.get("/beaches", response_model=FeatureCollection)
def list_beaches(db: Session = Depends(get_db)) -> FeatureCollection:
    rows = (
        beaches_with_latest_status(db)
        .add_columns(
            func.ST_X(Beach.geom).label("lon"),
            func.ST_Y(Beach.geom).label("lat"),
        )
        .order_by(Beach.name)
        .all()
    )
    return FeatureCollection(
        features=[
            Feature(
                id=beach.id,
                geometry=PointGeometry(coordinates=[lon, lat]),
                properties={
                    "name": beach.name,
                    "municipality": beach.municipality,
                    "monitored": beach.monitored,
                    "source_url": beach.source_url,
                    "status": status.status.value if status else "unknown",
                    "reported_at": (
                        status.reported_at.isoformat() if status else None
                    ),
                },
            )
            for beach, status, lon, lat in rows
        ]
    )


@router.get("/beaches/stats", response_model=list[BeachStatsOut])
def beach_stats(db: Session = Depends(get_db)) -> list[BeachStatsOut]:
    """Agregados por playa monitorizada para el ranking:
    cierres totales / último año, muestras no aptas y última evaluación."""
    year_ago = date.today() - timedelta(days=365)
    stats: list[BeachStatsOut] = []
    for beach in db.query(Beach).filter(Beach.monitored.is_(True)):
        closures = warnings = closures_last_year = 0
        for inc in beach.incidents:
            if inc.observations and "prohib" in inc.observations.lower():
                closures += 1
                if inc.opened_at >= year_ago:
                    closures_last_year += 1
            else:
                warnings += 1
        bad = sum(
            1
            for m in beach.measurements
            if m.evaluation and "prohib" in m.evaluation.lower()
        )
        latest = beach.measurements[0] if beach.measurements else None
        stats.append(
            BeachStatsOut(
                beach_id=beach.id,
                closures=closures,
                warnings=warnings,
                closures_last_year=closures_last_year,
                bad_samples=bad,
                total_samples=len(beach.measurements),
                latest_evaluation=latest.evaluation if latest else None,
                latest_sampled_at=latest.sampled_at if latest else None,
            )
        )
    return stats


@router.get(
    "/beaches/{beach_id}/incidents",
    response_model=list[BeachIncidentOut],
)
def beach_incidents(
    beach_id: int, db: Session = Depends(get_db)
) -> list[BeachIncidentOut]:
    """Histórico de incidentes de una playa, más reciente primero."""
    if db.get(Beach, beach_id) is None:
        raise HTTPException(status_code=404, detail="Beach not found")
    rows = (
        db.query(BeachIncident)
        .filter(BeachIncident.beach_id == beach_id)
        .order_by(BeachIncident.opened_at.desc())
        .all()
    )
    return [
        BeachIncidentOut(
            id=row.id,
            beach_id=row.beach_id,
            opened_at=row.opened_at,
            closed_at=row.closed_at,
            observations=row.observations,
            source_url=row.source_url,
        )
        for row in rows
    ]


@router.get(
    "/beaches/{beach_id}/quality",
    response_model=list[BeachMeasurementOut],
)
def beach_quality(
    beach_id: int, db: Session = Depends(get_db)
) -> list[BeachMeasurementOut]:
    """Análisis de calidad del agua, más reciente primero."""
    if db.get(Beach, beach_id) is None:
        raise HTTPException(status_code=404, detail="Beach not found")
    rows = (
        db.query(BeachMeasurement)
        .filter(BeachMeasurement.beach_id == beach_id)
        .order_by(BeachMeasurement.sampled_at.desc())
        .all()
    )
    return [
        BeachMeasurementOut(
            id=row.id,
            beach_id=row.beach_id,
            sampled_at=row.sampled_at,
            ecoli=row.ecoli,
            enterococci=row.enterococci,
            evaluation=row.evaluation,
            source_url=row.source_url,
        )
        for row in rows
    ]


@router.post(
    "/beaches/{beach_id}/status",
    response_model=BeachStatusOut,
    status_code=201,
)
def set_beach_status(
    beach_id: int, payload: BeachStatusIn, db: Session = Depends(get_db)
) -> BeachStatusOut:
    """Registra manualmente el estado de una playa (respaldo del
    scraping automático y demos)."""
    beach = db.get(Beach, beach_id)
    if beach is None:
        raise HTTPException(status_code=404, detail="Beach not found")

    status = BeachStatus(
        beach_id=beach.id,
        status=BeachState(payload.status),
        source_url=payload.source_url or beach.source_url,
    )
    db.add(status)
    db.commit()
    db.refresh(status)

    from app.notify import notify_beach_status

    notify_beach_status(db, beach, status.status)
    return BeachStatusOut(
        beach_id=beach.id,
        beach_name=beach.name,
        status=status.status.value,
        reported_at=status.reported_at,
        source_url=status.source_url,
    )


@router.get("/beaches/{beach_id}/status", response_model=BeachStatusOut)
def beach_status(beach_id: int, db: Session = Depends(get_db)) -> BeachStatusOut:
    row = (
        beaches_with_latest_status(db)
        .filter(Beach.id == beach_id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Beach not found")

    beach, status = row
    return BeachStatusOut(
        beach_id=beach.id,
        beach_name=beach.name,
        status=status.status.value if status else "unknown",
        reported_at=status.reported_at if status else None,
        source_url=status.source_url if status else beach.source_url,
    )

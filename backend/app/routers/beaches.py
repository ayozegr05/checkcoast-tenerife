from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Beach, BeachIncident, BeachState, BeachStatus
from app.queries import beaches_with_latest_status
from app.schemas import (
    BeachIncidentOut,
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

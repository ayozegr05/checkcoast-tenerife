from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2 import Geography
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.events import SynthEvent, synthesize_events
from app.models import (
    Beach,
    BeachIncident,
    BeachMeasurement,
    BeachState,
    BeachStatus,
    NewsItem,
    Outfall,
)
from app.queries import beaches_with_latest_status
from app.schemas import (
    BeachIncidentOut,
    BeachMeasurementOut,
    BeachNearbyOutfallOut,
    BeachNewsOut,
    BeachStatsOut,
    BeachStatusIn,
    BeachStatusOut,
    Feature,
    FeatureCollection,
    MunicipalityIncidentOut,
    NewsItemOut,
    NewsSummaryOut,
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
    """Agregados por playa para el ranking: cierres totales / último
    año, muestras no aptas, última evaluación y episodios
    reconstruidos (analítica sin incidencia + cierres solo en prensa).
    Las playas no monitorizadas solo aportan `reconstructed`."""
    year_ago = date.today() - timedelta(days=365)
    stats: list[BeachStatsOut] = []
    for beach in db.query(Beach):
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
                reconstructed=len(synthesize_events(beach)),
            )
        )
    return stats


def _synth_observations(ev: SynthEvent) -> str:
    if ev.via == "measurement":
        obs = "Prohibición por analítica — sin incidencia en Náyade"
        if ev.press_confirmed:
            obs += (
                f" · {ev.press_count} "
                f"{'noticia' if ev.press_count == 1 else 'noticias'} "
                "de prensa lo recogieron"
            )
        return obs
    obs = "Cierre recogido solo en prensa — sin registro en Náyade"
    if ev.end_estimated:
        obs += " · fin aproximado (última mención)"
    return obs


@router.get("/incidents", response_model=list[MunicipalityIncidentOut])
def municipality_incidents(
    municipality: str = Query(..., description="Nombre del municipio"),
    db: Session = Depends(get_db),
) -> list[MunicipalityIncidentOut]:
    """Todos los incidentes de las playas de un municipio, más reciente
    primero. Alimenta la línea temporal del ranking municipal.

    Además de las incidencias oficiales emite eventos reconstruidos:
    ventanas de analítica prohibida sin incidencia (`via=measurement`)
    y cierres que solo existen en prensa (`via=press`)."""
    beaches = (
        db.query(Beach).filter(Beach.municipality == municipality).all()
    )
    by_id = {b.id: b for b in beaches}
    rows = (
        db.query(BeachIncident)
        .filter(BeachIncident.beach_id.in_(by_id))
        .order_by(BeachIncident.opened_at.desc())
        .all()
    )
    out = [
        MunicipalityIncidentOut(
            id=inc.id,
            beach_id=inc.beach_id,
            beach_name=by_id[inc.beach_id].name,
            municipality=municipality,
            kind=(
                "closure"
                if inc.observations
                and "prohib" in inc.observations.lower()
                else "warning"
            ),
            opened_at=inc.opened_at,
            closed_at=inc.closed_at,
            observations=inc.observations,
        )
        for inc in rows
    ]
    synth_id = -1
    for beach in beaches:
        for ev in synthesize_events(beach):
            out.append(
                MunicipalityIncidentOut(
                    id=synth_id,
                    beach_id=beach.id,
                    beach_name=beach.name,
                    municipality=municipality,
                    kind=ev.kind,
                    opened_at=ev.opened_at,
                    closed_at=ev.closed_at,
                    observations=_synth_observations(ev),
                    via=ev.via,
                )
            )
            synth_id -= 1
    out.sort(key=lambda r: r.opened_at, reverse=True)
    return out


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


def _news_mode(items: list[NewsItem], attr: str) -> str | None:
    """Valor más frecuente de un campo extraído; en empate gana el del
    titular más reciente (items vienen ordenados desc por fecha)."""
    counts: dict[str, int] = {}
    for it in items:
        v = getattr(it, attr)
        if not v or v == "other":
            continue
        counts[v] = counts.get(v, 0) + 1
    if not counts:
        return None
    best = max(counts.values())
    return next(
        getattr(it, attr)
        for it in items
        if getattr(it, attr) in counts and counts[getattr(it, attr)] == best
    )


@router.get(
    "/beaches/{beach_id}/news",
    response_model=BeachNewsOut,
)
def beach_news(
    beach_id: int, db: Session = Depends(get_db)
) -> BeachNewsOut:
    """Noticias de prensa ligadas a la playa, más reciente primero,
    más un resumen determinista (evento/causa dominantes + nº medios).

    Contexto "según prensa": nunca altera el estado oficial, que solo
    sale de Náyade."""
    if db.get(Beach, beach_id) is None:
        raise HTTPException(status_code=404, detail="Beach not found")
    rows = (
        db.query(NewsItem)
        .filter(
            NewsItem.beach_id == beach_id,
            NewsItem.relevant.is_(True),
        )
        .order_by(NewsItem.published_at.desc().nulls_last())
        .limit(30)
        .all()
    )
    dominant = _news_mode(rows, "event_type")
    since = min(
        (r.published_at for r in rows
         if r.event_type == dominant and r.published_at),
        default=None,
    )
    return BeachNewsOut(
        summary=NewsSummaryOut(
            event_type=dominant,
            cause=_news_mode(rows, "cause"),
            items_count=len(rows),
            outlets_count=len({r.source for r in rows if r.source}),
            since=since,
        ),
        items=[
            NewsItemOut(
                id=row.id,
                beach_id=row.beach_id,
                title=row.title,
                url=row.url,
                source=row.source,
                published_at=row.published_at,
                event_type=row.event_type,
                cause=row.cause,
            )
            for row in rows
        ],
    )


@router.get(
    "/beaches/{beach_id}/nearby-outfalls",
    response_model=list[BeachNearbyOutfallOut],
)
def beach_nearby_outfalls(
    beach_id: int,
    radius_m: int = Query(
        1000, ge=50, le=10000, description="Radio de búsqueda en metros"
    ),
    db: Session = Depends(get_db),
) -> list[BeachNearbyOutfallOut]:
    """Emisarios catalogados dentro del radio de la playa, ordenados por
    distancia (metros reales, geography). Contextualiza qué vertidos
    amenazan cada zona de baño."""
    if db.get(Beach, beach_id) is None:
        raise HTTPException(status_code=404, detail="Beach not found")
    distance = func.ST_Distance(
        Beach.geom.cast(Geography), Outfall.geom.cast(Geography)
    ).label("distance_m")
    rows = (
        db.query(
            Outfall.id,
            Outfall.name,
            Outfall.kind,
            Outfall.status,
            distance,
        )
        .filter(Beach.id == beach_id)
        .filter(
            func.ST_DWithin(
                Beach.geom.cast(Geography),
                Outfall.geom.cast(Geography),
                radius_m,
            )
        )
        .order_by("distance_m")
        .limit(5)
        .all()
    )
    return [
        BeachNearbyOutfallOut(
            outfall_id=row.id,
            name=row.name,
            kind=row.kind,
            status=row.status.value,
            distance_m=row.distance_m,
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

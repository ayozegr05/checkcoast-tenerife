from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Beach, BeachState, NewsItem
from app.queries import beaches_with_latest_status
from app.schemas import AlertOut

router = APIRouter(tags=["alerts"])

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
# Prensa vieja sin seguimiento no prueba el estado actual
PRESS_ALERT_MAX_AGE = timedelta(days=90)


def _press_state(items: list[NewsItem]) -> str | None:
    """Estado según prensa a partir del evento más reciente que cambia
    estado (items ordenados desc por fecha): el último closure/reopening
    decide; si no hay, un warning/pollution da 'warning'. Un 'other'
    (obras, política) nunca deshace un cierre."""
    change = next(
        (i for i in items if i.event_type in ("closure", "reopening")),
        None,
    )
    warn = next(
        (i for i in items if i.event_type in ("warning", "pollution")),
        None,
    )
    if change and change.event_type == "closure":
        return "closed"
    if warn and (
        change is None
        or (warn.published_at or _EPOCH) > (change.published_at or _EPOCH)
    ):
        return "warning"
    return None


@router.get("/alerts", response_model=list[AlertOut])
def list_alerts(db: Session = Depends(get_db)) -> list[AlertOut]:
    """Playas con alerta: estado oficial 'closed'/'warning' (Náyade), y
    además playas sin alerta oficial cuyo último evento de prensa que
    cambia estado es un cierre/aviso (p.ej. Benijo: cerrada por orden
    municipal, sin registro sanitario). Entran en la misma lista; `via`
    guarda la procedencia."""
    alerts: list[AlertOut] = []
    alerted: set[int] = set()
    for beach, status in beaches_with_latest_status(db).all():
        if status is None or status.status not in (
            BeachState.closed,
            BeachState.warning,
        ):
            continue
        alerted.add(beach.id)
        alerts.append(
            AlertOut(
                beach_id=beach.id,
                beach_name=beach.name,
                municipality=beach.municipality,
                status=status.status.value,
                reported_at=status.reported_at,
                source_url=status.source_url,
                longitude=db.scalar(func.ST_X(beach.geom)),
                latitude=db.scalar(func.ST_Y(beach.geom)),
            )
        )

    # Prensa: último evento que cambia estado es un cierre, en playas
    # sin alerta oficial vigente (estado oficial jamás se altera)
    items = (
        db.query(NewsItem)
        .filter(NewsItem.relevant.is_(True), NewsItem.beach_id.isnot(None))
        .order_by(NewsItem.published_at.desc().nulls_last())
        .all()
    )
    by_beach: dict[int, list[NewsItem]] = {}
    for it in items:
        if it.beach_id not in alerted:
            by_beach.setdefault(it.beach_id, []).append(it)
    cutoff = datetime.now(timezone.utc) - PRESS_ALERT_MAX_AGE
    for beach_id, its in by_beach.items():
        newest = its[0].published_at
        if newest is None or newest < cutoff:
            continue
        state = _press_state(its)
        if state is None:
            continue
        beach = db.get(Beach, beach_id)
        if beach is None:
            continue
        alerts.append(
            AlertOut(
                beach_id=beach.id,
                beach_name=beach.name,
                municipality=beach.municipality,
                status=state,
                via="press",
                reported_at=its[0].published_at,
                source_url=None,
                longitude=db.scalar(func.ST_X(beach.geom)),
                latitude=db.scalar(func.ST_Y(beach.geom)),
            )
        )
    return alerts

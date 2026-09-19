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
# Si la prensa lleva >3 semanas sin mencionar la playa, el cierre se
# considera caducado (p.ej. Los Cristianos: gasoil de "un par de días"
# en agosto sin noticia de reapertura — no sigue cerrada)
PRESS_ALERT_MAX_AGE = timedelta(days=21)


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
    guarda la procedencia. Si la prensa reciente confirma cierre en una
    playa con 'warning' oficial, la alerta se muestra como 'closed'
    (el cierre real puede no ser sanitario, p.ej. talud de Gaviotas)."""
    items = (
        db.query(NewsItem)
        .filter(NewsItem.relevant.is_(True), NewsItem.beach_id.isnot(None))
        .order_by(NewsItem.published_at.desc().nulls_last())
        .all()
    )
    by_beach: dict[int, list[NewsItem]] = {}
    for it in items:
        by_beach.setdefault(it.beach_id, []).append(it)

    # Estado según prensa solo con cobertura fresca: si la playa lleva
    # semanas sin noticias, no afirmamos que siga cerrada
    cutoff = datetime.now(timezone.utc) - PRESS_ALERT_MAX_AGE
    press_status: dict[int, str] = {}
    press_dominant: dict[int, str] = {}
    for beach_id, its in by_beach.items():
        newest = its[0].published_at
        if newest is None or newest < cutoff:
            continue
        state = _press_state(its)
        if state is not None:
            press_status[beach_id] = state
        # Dominante sirve para escalar warning->closed en playas con
        # alerta oficial: una sola noticia de "obras para reabrir" no
        # equivale a reabierta (Gaviotas sigue cerrada con obras)
        counts: dict[str, int] = {}
        for i in its:
            if i.event_type and i.event_type != "other":
                counts[i.event_type] = counts.get(i.event_type, 0) + 1
        if counts:
            best = max(counts.values())
            press_dominant[beach_id] = next(
                i.event_type
                for i in its
                if i.event_type in counts and counts[i.event_type] == best
            )

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
                # warning oficial + prensa dice cerrada = closed
                status="closed"
                if press_status.get(beach.id) == "closed"
                or press_dominant.get(beach.id) == "closure"
                else status.status.value,
                via="official",
                reported_at=status.reported_at,
                source_url=status.source_url,
                longitude=db.scalar(func.ST_X(beach.geom)),
                latitude=db.scalar(func.ST_Y(beach.geom)),
            )
        )

    # Prensa: cierre/aviso vigente en playas sin alerta oficial
    # (estado oficial jamás se altera en la BD)
    for beach_id, state in press_status.items():
        if beach_id in alerted:
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
                reported_at=by_beach[beach_id][0].published_at,
                source_url=None,
                longitude=db.scalar(func.ST_X(beach.geom)),
                latitude=db.scalar(func.ST_Y(beach.geom)),
            )
        )
    return alerts

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Beach, BeachIncident, BeachState, NewsItem
from app.queries import beaches_with_latest_status
from app.schemas import AlertOut

router = APIRouter(tags=["alerts"])

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
# Si la prensa lleva >3 semanas sin mencionar la playa, no afirmamos
# que siga cerrada (Los Cristianos: gasoil puntual de agosto)
PRESS_ALERT_MAX_AGE = timedelta(days=21)
# Ventana de gracia: un cierre de prensa fresco gana a un 'open' de
# Náyade porque los cierres municipales tardan en llegar a Sanidad;
# pasada la ventana sin seguimiento, gana Sanidad
PRESS_OPEN_GRACE = timedelta(days=14)


def _press_event(items: list[NewsItem]) -> NewsItem | None:
    """Titular que decide el estado según prensa (items ordenados desc
    por fecha): el último closure/reopening decide; si no hay, un
    warning/pollution da 'warning'. Un 'other' (obras, política) nunca
    deshace un cierre."""
    change = next(
        (i for i in items if i.event_type in ("closure", "reopening")),
        None,
    )
    warn = next(
        (i for i in items if i.event_type in ("warning", "pollution")),
        None,
    )
    if change and change.event_type == "closure":
        return change
    if warn and (
        change is None
        or (warn.published_at or _EPOCH) > (change.published_at or _EPOCH)
    ):
        return warn
    return None


@router.get("/alerts", response_model=list[AlertOut])
def list_alerts(db: Session = Depends(get_db)) -> list[AlertOut]:
    """Playas con alerta. Regla mixta oficial/prensa:

    - Estado oficial 'closed'/'warning' (Náyade) siempre alerta; si la
      prensa fresca confirma cierre, se muestra 'closed' (el cierre real
      puede no ser sanitario, p.ej. talud de Gaviotas).
    - Oficial 'open': gana Sanidad salvo ventana de gracia — un cierre
      de prensa <=14 días alerta porque los cierres municipales tardan
      en llegar a Náyade. Si Sanidad cerró formalmente un incidente
      después de la noticia, es reapertura probada y no hay alerta.
    - Sin dato oficial (OSM): la prensa decide; cobertura >21 días sin
      seguimiento no prueba el estado actual.
    `via` guarda la procedencia; el estado oficial nunca se altera."""
    items = (
        db.query(NewsItem)
        .filter(NewsItem.relevant.is_(True), NewsItem.beach_id.isnot(None))
        .order_by(NewsItem.published_at.desc().nulls_last())
        .all()
    )
    by_beach: dict[int, list[NewsItem]] = {}
    for it in items:
        by_beach.setdefault(it.beach_id, []).append(it)

    # Estado según prensa solo con cobertura fresca
    cutoff = datetime.now(timezone.utc) - PRESS_ALERT_MAX_AGE
    press_state: dict[int, str] = {}
    press_when: dict[int, datetime | None] = {}
    press_dominant: dict[int, str] = {}
    for beach_id, its in by_beach.items():
        newest = its[0].published_at
        if newest is None or newest < cutoff:
            continue
        ev = _press_event(its)
        if ev is not None:
            press_state[beach_id] = (
                "closed" if ev.event_type == "closure" else "warning"
            )
            press_when[beach_id] = ev.published_at
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
    official: dict[int, str] = {}
    for beach, status in beaches_with_latest_status(db).all():
        if status is not None:
            official[beach.id] = status.status.value
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
                if press_state.get(beach.id) == "closed"
                or press_dominant.get(beach.id) == "closure"
                else status.status.value,
                via="official",
                reported_at=status.reported_at,
                source_url=status.source_url,
                longitude=db.scalar(func.ST_X(beach.geom)),
                latitude=db.scalar(func.ST_Y(beach.geom)),
            )
        )

    # Prensa en playas sin alerta oficial vigente
    grace = datetime.now(timezone.utc) - PRESS_OPEN_GRACE
    for beach_id, state in press_state.items():
        if beach_id in alerted:
            continue
        if official.get(beach_id) == BeachState.open.value:
            # Sanidad dice abierta: gana salvo ventana de gracia, y
            # siempre que no haya cerrado un incidente tras la noticia
            # (cierre formal = reapertura probada)
            resolved = (
                db.query(func.max(BeachIncident.closed_at))
                .filter(
                    BeachIncident.beach_id == beach_id,
                    BeachIncident.closed_at.isnot(None),
                )
                .scalar()
            )
            when = press_when.get(beach_id)
            if resolved is not None and (
                when is None or resolved >= when.date()
            ):
                continue
            if when is None or when < grace:
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

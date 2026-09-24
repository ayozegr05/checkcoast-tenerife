from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from app.models import (
    Beach,
    BeachIncident,
    BeachMeasurement,
    BeachState,
    BeachStatus,
    NewsItem,
)

# Subconsulta: último estado reportado por playa
_latest = (
    select(
        BeachStatus.beach_id.label("beach_id"),
        func.max(BeachStatus.reported_at).label("latest_at"),
    )
    .group_by(BeachStatus.beach_id)
    .subquery()
)

_LatestStatus = aliased(BeachStatus)


def beaches_with_latest_status(db: Session):
    """Devuelve filas (Beach, BeachStatus|None) con el estado más reciente."""
    return (
        db.query(Beach, _LatestStatus)
        .outerjoin(_latest, _latest.c.beach_id == Beach.id)
        .outerjoin(
            _LatestStatus,
            (_LatestStatus.beach_id == Beach.id)
            & (_LatestStatus.reported_at == _latest.c.latest_at),
        )
    )


# Si la prensa lleva >3 semanas sin mencionar la playa, no afirmamos
# que siga cerrada (Los Cristianos: gasoil puntual de agosto)
PRESS_ALERT_MAX_AGE = timedelta(days=21)
# Ventana de gracia: un cierre de prensa fresco gana a un 'open' de
# Náyade porque los cierres municipales tardan en llegar a Sanidad;
# pasada la ventana sin seguimiento, gana Sanidad
PRESS_OPEN_GRACE = timedelta(days=14)
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def stale_official_ids(db: Session) -> set[int]:
    """Playas cuyo último estado oficial (closed/warning) está superado
    por una reapertura de prensa: TODA la evidencia oficial (incidencias
    abiertas + última medición) es anterior a la reapertura — mismo
    episodio que Náyade publica tarde, no una clausura nueva.

    Una incidencia formal ABIERTA exige corroboración (>=2 medios
    distintos reportando la reapertura): es un acto vigente de Sanidad
    y un solo titular mal clasificado no puede abrirla (caso Gaviotas:
    "obras PARA reabrir" interpretado como reapertura).

    Sirve para el estado efectivo (mapa, alertas, ficha): el dato oficial
    crudo no se toca y sigue visible en el historial de la playa."""
    rows = (
        db.query(
            NewsItem.beach_id, NewsItem.published_at, NewsItem.source
        )
        .filter(
            NewsItem.relevant.is_(True),
            NewsItem.beach_id.isnot(None),
            NewsItem.event_type == "reopening",
            NewsItem.published_at.isnot(None),
        )
        .all()
    )
    if not rows:
        return set()
    reopens: dict[int, datetime] = {}
    sources: dict[int, set] = {}
    for bid, pub, src in rows:
        if bid not in reopens or pub > reopens[bid]:
            reopens[bid] = pub
        if src:
            sources.setdefault(bid, set()).add(src)
    ids = list(reopens)
    # Si hay un cierre de prensa posterior a la reapertura, la
    # reapertura ya no es el último evento: no suprime nada
    last_closures = dict(
        db.query(NewsItem.beach_id, func.max(NewsItem.published_at))
        .filter(
            NewsItem.relevant.is_(True),
            NewsItem.beach_id.in_(ids),
            NewsItem.event_type == "closure",
            NewsItem.published_at.isnot(None),
        )
        .group_by(NewsItem.beach_id)
        .all()
    )
    open_incs: dict[int, list] = {}
    for bid, opened in db.query(
        BeachIncident.beach_id, BeachIncident.opened_at
    ).filter(
        BeachIncident.beach_id.in_(ids),
        BeachIncident.closed_at.is_(None),
    ).all():
        open_incs.setdefault(bid, []).append(opened)
    last_meas = dict(
        db.query(
            BeachMeasurement.beach_id,
            func.max(BeachMeasurement.sampled_at),
        )
        .filter(BeachMeasurement.beach_id.in_(ids))
        .group_by(BeachMeasurement.beach_id)
        .all()
    )
    stale = set()
    for bid, reopen in reopens.items():
        closure = last_closures.get(bid)
        if closure is not None and closure > reopen:
            continue
        evidence = list(open_incs.get(bid, []))
        if last_meas.get(bid):
            evidence.append(last_meas[bid])
        if not evidence or not all(d <= reopen.date() for d in evidence):
            continue
        # Incidencia abierta = acto vigente: solo la suprime una
        # reapertura corroborada por al menos 2 medios distintos
        if open_incs.get(bid) and len(sources.get(bid, set())) < 2:
            continue
        stale.add(bid)
    return stale


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


def effective_states(db: Session) -> dict[int, dict]:
    """Matriz de estado efectivo compartida por /alerts, /beaches y
    /beaches/{id}/status: qué ve el usuario en cada playa y con qué
    procedencia.

    - Estado oficial 'closed'/'warning' (Náyade) siempre alerta, salvo
      que una reapertura de prensa sea posterior a TODA la evidencia
      oficial (mismo episodio rezagado → efectivo 'open'). Si la prensa
      fresca confirma cierre, se muestra 'closed' (el cierre real puede
      no ser sanitario, p.ej. talud de Gaviotas).
    - Oficial 'open': gana Sanidad salvo ventana de gracia — un cierre
      de prensa <=14 días alerta porque los cierres municipales tardan
      en llegar a Náyade. Si Sanidad cerró formalmente un incidente o
      tomó una muestra después de la noticia, es reapertura probada y
      no hay alerta.
    - Sin dato oficial (OSM): la prensa decide; cobertura >21 días sin
      seguimiento no prueba el estado actual.

    Devuelve {beach_id: {status, via, alerted, reported_at,
    source_url}} para TODAS las playas (alerted=False = sin alerta
    vigente). `via` es 'official'|'press' cuando la prensa influye en
    lo mostrado; el estado oficial crudo nunca se altera."""
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

    stale_ids = stale_official_ids(db)

    result: dict[int, dict] = {}
    official: dict[int, str] = {}
    for beach, status in beaches_with_latest_status(db).all():
        if status is not None:
            official[beach.id] = status.status.value
        if status is None:
            result[beach.id] = {
                "status": "unknown",
                "via": "official",
                "alerted": False,
                "reported_at": None,
                "source_url": beach.source_url,
            }
            continue
        if status.status in (BeachState.closed, BeachState.warning):
            if beach.id in stale_ids:
                # Oficial rezagado del mismo episodio: reapertura de
                # prensa posterior a toda la evidencia → efectivo open
                result[beach.id] = {
                    "status": "open",
                    "via": "press",
                    "alerted": False,
                    "reported_at": status.reported_at,
                    "source_url": status.source_url,
                }
                continue
            result[beach.id] = {
                # warning oficial + prensa dice cerrada = closed
                "status": "closed"
                if press_state.get(beach.id) == "closed"
                or press_dominant.get(beach.id) == "closure"
                else status.status.value,
                "via": "official",
                "alerted": True,
                "reported_at": status.reported_at,
                "source_url": status.source_url,
            }
            continue
        result[beach.id] = {
            "status": status.status.value,
            "via": "official",
            "alerted": False,
            "reported_at": status.reported_at,
            "source_url": status.source_url,
        }

    # Prensa en playas sin alerta oficial vigente
    grace = datetime.now(timezone.utc) - PRESS_OPEN_GRACE
    for beach_id, state in press_state.items():
        if beach_id in result and result[beach_id]["alerted"]:
            continue
        if official.get(beach_id) == BeachState.open.value:
            # Sanidad dice abierta: gana salvo ventana de gracia, y
            # siempre que haya prueba oficial de reapertura posterior a
            # la noticia: incidencia cerrada o muestra tomada después
            # (si fuera mala, el estado sería closed y no llegaría aquí)
            resolved = (
                db.query(func.max(BeachIncident.closed_at))
                .filter(
                    BeachIncident.beach_id == beach_id,
                    BeachIncident.closed_at.isnot(None),
                )
                .scalar()
            )
            last_meas = db.query(func.max(BeachMeasurement.sampled_at)).filter(
                BeachMeasurement.beach_id == beach_id
            ).scalar()
            if last_meas is not None and (
                resolved is None or last_meas > resolved
            ):
                resolved = last_meas
            when = press_when.get(beach_id)
            if resolved is not None and (
                when is None or resolved >= when.date()
            ):
                continue
            if when is None or when < grace:
                continue
        result[beach_id] = {
            "status": state,
            "via": "press",
            "alerted": True,
            "reported_at": by_beach[beach_id][0].published_at,
            "source_url": None,
        }
    return result

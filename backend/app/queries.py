import unicodedata
from datetime import UTC, datetime, timedelta

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
# que siga en ese estado (Los Cristianos: gasoil puntual de agosto;
# Puertito: bacterias fecales de 2025 sin seguimiento en 15 meses) —
# salvo un cierre por causa estructural (ver _STRUCTURAL_CAUSES), que
# persiste hasta reapertura explícita (Benijo: ~2 años cerrada por
# desprendimientos, solo prensa administrativa esporádica)
PRESS_ALERT_MAX_AGE = timedelta(days=21)
# Ventana de gracia: un cierre de prensa fresco gana a un 'open' de
# Náyade porque los cierres municipales tardan en llegar a Sanidad;
# pasada la ventana sin seguimiento, gana Sanidad
PRESS_OPEN_GRACE = timedelta(days=14)
_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)

# Causas de titulares/observaciones → etiqueta corta para la UI.
# El LLM y Náyade escriben texto libre ("exceso de enterococos",
# "contaminación fecal", "riesgo de desprendimientos en la ladera"...);
# la lista de alertas solo quiere distinguir el tipo de problema.
# Pirámide de especificidad: la causa nombrada (parámetro, fuente o
# proceso concreto) manda; "calidad del agua"/"contaminación" a secas
# es el fondo genérico — solo se usa si no hay nada más específico.
# El orden del array fija la precedencia dentro de un mismo texto.
_CAUSE_RULES = [
    (
        # El mar socavando el terreno bajo el paseo (Punta Larga:
        # caverna bajo la avenida) no es un desprendimiento ni un
        # problema de agua — categoría propia, también estructural
        (
            "socav", "colaps", "cavern", "cavidad", "cueva",
            "hundim", "horad", "erosion",
        ),
        "Colapso del terreno",
    ),
    (
        ("desprend", "talud", "ladera", "derrumbe", "corrimiento"),
        "Desprendimientos",
    ),
    (
        # Parámetro medido nombrado explícitamente: nivel máximo de
        # especificidad — "E. coli >800 UFC" informa más que
        # "contaminación fecal" (variantes: e. coli, ecoli,
        # escherichia coli… el "coli" las cubre todas)
        ("coli", "escherichia"),
        "E. coli",
    ),
    (("enterococo", "enterococcus"), "Enterococos"),
    (
        # Familia fecal sin parámetro nombrado: mejor que
        # "Contaminación" a secas pero menos que el parámetro
        ("fecal", "residual", "bacteria", "depuradora"),
        "Contaminación fecal",
    ),
    (("gasoil", "hidrocarbur", "diesel", "fuel"), "Hidrocarburos"),
    (("alga",), "Algas"),
    (("obra",), "Obras"),
    (
        ("contamin", "vertido", "calidad del agua", "medusa"),
        "Contaminación",
    ),
]
# Sin categoría "Acceso" ni "Mar agitado": "acceso prohibido",
# "vallado", "oleaje", "temporal", "avance del mar"... describen el
# mecanismo o el desencadenante, no la razón → no computan como causa.

# Jerarquía entre categorías cuando un episodio tiene varias: gana la
# más específica; la mayoría solo desempata dentro del mismo nivel y
# el genérico ("Contaminación" por mala calidad del agua) va el último
_CAUSE_RANK = {
    "E. coli y enterococos": 0,
    "E. coli": 0,
    "Enterococos": 0,
    "Colapso del terreno": 0,
    "Desprendimientos": 0,
    "Hidrocarburos": 0,
    "Algas": 0,
    "Contaminación fecal": 1,
    "Obras": 1,
    "Contaminación": 2,
}

# Parámetros de laboratorio: cuando un episodio cita ambos (típico —
# la analítica mide los dos) la etiqueta los muestra juntos
_WATER_PARAMS = {
    "E. coli": ("coli", "escherichia"),
    "Enterococos": ("enterococo", "enterococcus"),
}

# Causas estructurales: no se resuelven solas (hace falta obra civil o
# el fin de una obra en marcha) → un cierre de prensa por esta causa
# sigue vigente aunque no se vuelva a hablar de la playa (Benijo:
# desprendimientos, ~2 años sin reapertura cubierta). El resto
# (contaminación, sin causa) es transitorio: se resuelve con el tiempo
# y el silencio de prensa sí es indicio de que ya pasó (Puertito:
# bacterias fecales de 2025, sin seguimiento en 15 meses).
_STRUCTURAL_CAUSES = {"Desprendimientos", "Obras", "Colapso del terreno"}

# Familia "agua": todo lo que Sanidad mide — para contar episodios de
# contaminación en /beaches/stats
CONTAMINATION_CAUSES = {
    "Contaminación",
    "Contaminación fecal",
    "Hidrocarburos",
    "Algas",
}


def _short_cause(text: str | None) -> str | None:
    """Texto libre de causa → categoría corta o None si no aporta."""
    if not text:
        return None
    t = "".join(
        c
        for c in unicodedata.normalize("NFD", text.lower())
        if unicodedata.category(c) != "Mn"
    )
    for keys, label in _CAUSE_RULES:
        if any(k in t for k in keys):
            return label
    return None


def is_ungraded_note(obs: str | None) -> bool:
    """Incidencia administrativa sin alerta real: "Sin Calificar" solo
    registra que Sanidad no pudo evaluar una muestra — no dice que el
    agua esté mal ni prohíbe nada. No genera aviso ni episodio (San
    Marcos: una muestra sin calificar dejaba "aviso de 57 días ·
    contaminación" sin que hubiera ningún incidente real)."""
    if not obs:
        return False
    t = "".join(
        c
        for c in unicodedata.normalize("NFD", obs.lower())
        if unicodedata.category(c) != "Mn"
    )
    return "sin calificar" in t and "prohib" not in t


def _params_in_text(text: str | None) -> set[str]:
    """Parámetros de laboratorio citados en un texto libre: una frase
    que dice "E. coli y enterococos" aporta AMBOS."""
    if not text:
        return set()
    t = "".join(
        c
        for c in unicodedata.normalize("NFD", text.lower())
        if unicodedata.category(c) != "Mn"
    )
    return {
        label
        for label, keys in _WATER_PARAMS.items()
        if any(k in t for k in keys)
    }


def _episode_params(its: list[NewsItem]) -> set[str]:
    """Parámetros citados por los titulares que cambian estado."""
    found: set[str] = set()
    for i in its:
        if i.event_type not in ("closure", "warning", "pollution"):
            continue
        found |= _params_in_text(i.cause)
    return found


def _press_cause(its: list[NewsItem]) -> str | None:
    """Causa ganadora (categoría) entre los titulares que cambian
    estado. Especificidad primero (_CAUSE_RANK): la mayoría solo
    desempata dentro del mismo nivel y, tras ella, el titular más
    reciente (items ordenados desc). Si el episodio cita los dos
    parámetros fecales se muestran juntos: "E. coli y enterococos"."""
    counts: dict[str, int] = {}
    for i in its:
        if i.event_type not in ("closure", "warning", "pollution"):
            continue
        c = _short_cause(i.cause)
        if c:
            counts[c] = counts.get(c, 0) + 1
    if not counts:
        return None
    if _episode_params(its) == {"E. coli", "Enterococos"}:
        return "E. coli y enterococos"
    return min(
        counts,
        key=lambda c: (_CAUSE_RANK.get(c, 9), -counts[c]),
    )


def _majority_cause(its: list[NewsItem]) -> str | None:
    """Categoría más citada entre los titulares que cambian estado.
    Distinto de _press_cause: aquí la MAYORÍA decide porque alimenta
    la persistencia estructural — una mención minoritaria de "obras"
    no debe eternizar un episodio de contaminación (Candelaria)."""
    counts: dict[str, int] = {}
    for i in its:
        if i.event_type not in ("closure", "warning", "pollution"):
            continue
        c = _short_cause(i.cause)
        if c:
            counts[c] = counts.get(c, 0) + 1
    if not counts:
        return None
    best = max(counts.values())
    return next(c for c in counts if counts[c] == best)


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
    - Sin dato oficial (OSM): decide la prensa. Un cierre por causa
      estructural (desprendimientos, obras) persiste sin caducar —
      nadie repite la misma noticia cada mes mientras dura; el resto
      (contaminación, mar agitado, avisos sin cierre confirmado) sí
      caduca a los 21 días sin seguimiento, sea o no monitorizada.

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

    # Estado según prensa solo con cobertura fresca — salvo un cierre
    # (no aviso) por causa estructural, que persiste sin caducar: ni
    # Sanidad ni la prensa repiten la misma noticia cada mes mientras
    # dura una obra o un desprendimiento
    cutoff = datetime.now(UTC) - PRESS_ALERT_MAX_AGE
    press_state: dict[int, str] = {}
    press_when: dict[int, datetime | None] = {}
    press_cause: dict[int, str | None] = {}
    press_dominant: dict[int, str] = {}
    for beach_id, its in by_beach.items():
        newest = its[0].published_at
        if newest is None:
            continue
        cause = _press_cause(its)
        ev = _press_event(its)
        persists = (
            ev is not None
            and ev.event_type == "closure"
            and _majority_cause(its) in _STRUCTURAL_CAUSES
        )
        if not persists and newest < cutoff:
            continue
        press_cause[beach_id] = cause
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
                "cause": None,
                "cause_via": None,
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
                    "cause": None,
                    "cause_via": None,
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
                "cause": None,  # se rellena abajo
                "cause_via": None,
            }
            continue
        result[beach.id] = {
            "status": status.status.value,
            "via": "official",
            "alerted": False,
            "reported_at": status.reported_at,
            "source_url": status.source_url,
            "cause": None,
            "cause_via": None,
        }

    # Prensa en playas sin alerta oficial vigente
    grace = datetime.now(UTC) - PRESS_OPEN_GRACE
    for beach_id, state in press_state.items():
        if beach_id in result and result[beach_id]["alerted"]:
            continue
        # Sanidad solo mide calidad de agua: un 'open' oficial no
        # contradice un cierre por causa estructural (no es su ámbito,
        # p.ej. desprendimientos) — la excepción de abajo no aplica.
        # La persistencia la decide la causa mayoritaria, no la
        # ganadora por especificidad: una mención suelta de "obras"
        # no eterniza un episodio
        structural = _majority_cause(by_beach[beach_id]) in (
            _STRUCTURAL_CAUSES
        )
        if official.get(beach_id) == BeachState.open.value and not structural:
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
            "cause": press_cause.get(beach_id),
            "cause_via": "press" if press_cause.get(beach_id) else None,
        }

    # Causa de alertas oficiales: observaciones de la incidencia abierta
    # o evaluación de la última medición; si no aportan ("Sin
    # Calificar"), cae a la causa dominante de la prensa (etiquetada)
    off_ids = [
        b
        for b, e in result.items()
        if e["via"] == "official" and e["alerted"]
    ]
    if off_ids:
        inc_obs: dict[int, str | None] = {}
        for bid, obs in (
            db.query(BeachIncident.beach_id, BeachIncident.observations)
            .filter(
                BeachIncident.beach_id.in_(off_ids),
                BeachIncident.closed_at.is_(None),
            )
            .order_by(BeachIncident.opened_at.desc())
            .all()
        ):
            inc_obs.setdefault(bid, obs)
        meas_ev: dict[int, str | None] = {}
        for bid, ev_txt in (
            db.query(
                BeachMeasurement.beach_id, BeachMeasurement.evaluation
            )
            .filter(BeachMeasurement.beach_id.in_(off_ids))
            .order_by(BeachMeasurement.sampled_at.desc())
            .all()
        ):
            meas_ev.setdefault(bid, ev_txt)
        for bid in off_ids:
            cause = _short_cause(inc_obs.get(bid)) or _short_cause(
                meas_ev.get(bid)
            )
            if cause:
                result[bid]["cause"] = cause
                result[bid]["cause_via"] = "official"
            elif press_cause.get(bid):
                result[bid]["cause"] = press_cause[bid]
                result[bid]["cause_via"] = "press"
    return result

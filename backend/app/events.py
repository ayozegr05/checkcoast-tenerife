"""Eventos reconstruidos: episodios de prohibición/cierre que existen
en los datos pero que Náyade no registró como incidencia formal.

Tres fuentes se cruzan por playa:

- Ventanas de analítica: rachas de mediciones con evaluación
  "prohibido" — la prohibición empieza en la primera muestra mala y
  termina en la primera apta posterior. Si ya hay una incidencia
  oficial solapada se descarta (no duplicar).
- Prensa: noticias `closure` casadas a la playa. Las que caen dentro
  de la ventana ampliada de una prohibición por analítica la
  corroboran (misma entrada, doble sello); las que caen dentro de una
  incidencia oficial se ignoran; el resto genera evento propio
  agrupado en clústeres temporales.
- Reaperturas de prensa: nunca generan evento propio — corroboran la
  ventana en la que caen o cierran el clúster de cierres anterior.

Todo es sintético y de solo lectura: nunca escribe en
`beach_incidents` ni alimenta el estado oficial.
"""

from dataclasses import dataclass, field
from datetime import date, timedelta

from app.models import Beach

# La prensa puede adelantarse a Náyade (cierre municipal no publicado)
# o contar la reapertura semanas después — ventana amplia a ambos lados
PRESS_FUZZ_BEFORE = timedelta(days=14)
PRESS_FUZZ_AFTER = timedelta(days=30)
# Cierres de prensa separados por más de este hueco son episodios
# distintos (Jardín acumula décadas de noticias)
PRESS_CLUSTER_GAP = timedelta(days=45)
# Mismo umbral que PRESS_ALERT_MAX_AGE en /alerts: un cierre de prensa
# sin reapertura ni mención reciente no se muestra como "activo"
PRESS_STALE = timedelta(days=21)
# Sin reapertura ni muestra apta, el "fin" de un cierre de prensa es
# incierto: usamos la última mención y lo declaramos en el texto


@dataclass
class SynthEvent:
    """Episodio reconstruido de una playa."""

    kind: str  # siempre "closure"
    opened_at: date
    closed_at: date | None
    via: str  # "measurement" | "press"
    press_confirmed: bool = False
    press_count: int = 0
    end_estimated: bool = False  # closed_at es la última mención
    sources: list[str] = field(default_factory=list)


def _bad(m) -> bool:
    return bool(m.evaluation and "prohib" in m.evaluation.lower())


def _overlaps(
    a_start: date, a_end: date | None, b_start: date, b_end: date | None
) -> bool:
    a_e = a_end or date.max
    b_e = b_end or date.max
    return a_start <= b_e and b_start <= a_e


def _in_window(
    pub: date, start: date, end: date | None, today: date
) -> bool:
    """Fecha de prensa dentro de la ventana ampliada del episodio."""
    return start - PRESS_FUZZ_BEFORE <= pub <= (
        end or today
    ) + PRESS_FUZZ_AFTER


def synthesize_events(beach: Beach, today: date | None = None) -> list[SynthEvent]:
    """Eventos reconstruidos de una playa (incidencias oficiales
    aparte — estas son las que faltan en Náyade)."""
    today = today or date.today()

    # 1. Ventanas de prohibición por analítica (rachas de "prohibido")
    ms = sorted(beach.measurements, key=lambda m: m.sampled_at)
    windows: list[tuple[date, date | None]] = []
    run_start: date | None = None
    for m in ms:
        if _bad(m):
            run_start = run_start or m.sampled_at
        elif run_start is not None:
            windows.append((run_start, m.sampled_at))
            run_start = None
    if run_start is not None:
        windows.append((run_start, None))  # prohibición viva

    # 2. Descartar ventanas ya cubiertas por incidencia oficial
    official = [(i.opened_at, i.closed_at) for i in beach.incidents]
    events = [
        SynthEvent(
            kind="closure", opened_at=s, closed_at=e, via="measurement"
        )
        for s, e in windows
        if not any(
            _overlaps(s, e, o_s, o_e) for o_s, o_e in official
        )
    ]

    # 3. Prensa: cierres corroboran ventanas o generan evento propio
    items = sorted(
        (
            n
            for n in beach.news_items
            if n.relevant and n.published_at and n.event_type
        ),
        key=lambda n: n.published_at,
    )
    closures = [n for n in items if n.event_type == "closure"]
    reopenings = [n for n in items if n.event_type == "reopening"]

    loose: list = []  # cierres de prensa no fusionados
    for n in closures:
        pub = n.published_at.date()
        hit = next(
            (
                ev
                for ev in events
                if _in_window(pub, ev.opened_at, ev.closed_at, today)
            ),
            None,
        )
        if hit is not None:
            hit.press_confirmed = True
            hit.press_count += 1
            if n.source and n.source not in hit.sources:
                hit.sources.append(n.source)
            continue
        # La noticia cubre una incidencia oficial: no duplicar
        if any(
            _in_window(pub, o_s, o_e, today) for o_s, o_e in official
        ):
            continue
        loose.append(n)

    # 4. Clústeres de cierres sueltos → un evento cada uno
    for n in loose:
        pub = n.published_at.date()
        cluster = next(
            (
                ev
                for ev in events
                if ev.via == "press"
                and pub - PRESS_CLUSTER_GAP <= ev.opened_at <= pub
            ),
            None,
        )
        if cluster is None:
            events.append(
                SynthEvent(
                    kind="closure",
                    opened_at=pub,
                    closed_at=None,
                    via="press",
                    press_confirmed=True,
                )
            )
            cluster = events[-1]
        else:
            cluster.opened_at = min(cluster.opened_at, pub)
        cluster.press_count += 1
        if n.source and n.source not in cluster.sources:
            cluster.sources.append(n.source)

    # 5. Reaperturas: corroboran la ventana en la que caen, o cierran
    # el clúster de prensa más reciente que las precede
    for n in reopenings:
        pub = n.published_at.date()
        for ev in events:
            if ev.via == "measurement" and _in_window(
                pub, ev.opened_at, ev.closed_at, today
            ):
                ev.press_confirmed = True
                ev.press_count += 1
                if n.source and n.source not in ev.sources:
                    ev.sources.append(n.source)
                break
        else:
            open_press = [
                ev
                for ev in events
                if ev.via == "press"
                and ev.closed_at is None
                and ev.opened_at <= pub
            ]
            if open_press:
                ev = max(open_press, key=lambda e: e.opened_at)
                ev.closed_at = pub
                ev.press_count += 1
                if n.source and n.source not in ev.sources:
                    ev.sources.append(n.source)

    # 6. Cierre de prensa sin reapertura: sigue "activo" si la
    # cobertura está fresca y el último cambio es un cierre — misma
    # regla que /alerts (_press_event + PRESS_ALERT_MAX_AGE), para que
    # la línea temporal no contradiga el banner. Ya frío, el fin es
    # incierto: usamos la última mención como cota y lo declaramos
    fresh = bool(items) and (
        items[-1].published_at.date() >= today - PRESS_STALE
    )
    latest_change = next(
        (
            n
            for n in reversed(items)
            if n.event_type in ("closure", "reopening")
        ),
        None,
    )
    still_closed = (
        fresh
        and latest_change is not None
        and latest_change.event_type == "closure"
    )
    # Solo el clúster de prensa más reciente puede seguir abierto
    open_candidates = [
        ev for ev in events if ev.via == "press" and ev.closed_at is None
    ]
    live = (
        max(open_candidates, key=lambda e: e.opened_at)
        if open_candidates and still_closed
        else None
    )
    for ev in open_candidates:
        if ev is live:
            continue
        last = max(
            (n.published_at.date() for n in closures
             if n.published_at.date() >= ev.opened_at),
            default=ev.opened_at,
        )
        ev.closed_at = last
        ev.end_estimated = True

    return sorted(events, key=lambda e: e.opened_at, reverse=True)

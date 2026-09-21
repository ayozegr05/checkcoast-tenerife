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
    # Último cierre de prensa del clúster: una reapertura solo cierra
    # el episodio si se publica después (las del LLM a veces son
    # "agilizan las obras" mal clasificadas)
    last_closure: date | None = None
    # Reaperturas anunciadas en prensa dentro de la ventana. La última
    # posterior a la última muestra mala es el cierre real (Náyade
    # muestrea cada ~14d y puede tardar meses en publicar la apta);
    # una reapertura anterior a una mala posterior quedó desmentida
    # por el laboratorio y solo se anota
    press_reopening: date | None = None  # última reapertura en ventana
    reopenings_in_window: list[date] = field(default_factory=list)
    end_from_press: bool = False


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
        cluster.last_closure = max(cluster.last_closure or pub, pub)
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
                ev.reopenings_in_window.append(pub)
                if n.source and n.source not in ev.sources:
                    ev.sources.append(n.source)
                break
        else:
            open_press = [
                ev
                for ev in events
                if ev.via == "press"
                and ev.closed_at is None
                and (ev.last_closure or ev.opened_at) <= pub
            ]
            if open_press:
                ev = max(open_press, key=lambda e: e.opened_at)
                ev.closed_at = pub
                ev.press_count += 1
                if n.source and n.source not in ev.sources:
                    ev.sources.append(n.source)

    # 5b. La última reapertura de prensa posterior a la última muestra
    # mala es el cierre real de la ventana (El Pris: reabierta 13-abr,
    # Náyade no publicó apta hasta el 25-may; La Pinta: reabierta 4-sep,
    # apta publicada el 16-sep). Si toda reapertura quedó desmentida por
    # una mala posterior, la ventana manda y solo se anota
    for ev in events:
        if ev.via != "measurement" or not ev.reopenings_in_window:
            continue
        last_bad = max(
            (
                m.sampled_at
                for m in ms
                if _bad(m)
                and ev.opened_at <= m.sampled_at <= (ev.closed_at or today)
            ),
            default=None,
        )
        candidates = [
            d for d in ev.reopenings_in_window
            if last_bad is None or d > last_bad
        ]
        ev.press_reopening = max(ev.reopenings_in_window)
        if candidates:
            ev.closed_at = max(candidates)
            ev.end_from_press = True

    # 6. Si la cobertura sigue fresca y el último cambio es un cierre,
    # la playa sigue cerrada según prensa (misma regla que /alerts):
    # todos los clústeres son UN solo episodio continuo — se fusionan
    # con la fecha más antigua (Benijo: cierre de 2024 con picos de
    # noticias en mayo y julio)
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
    press_evs = [ev for ev in events if ev.via == "press"]
    if still_closed and press_evs:
        merged = SynthEvent(
            kind="closure",
            opened_at=min(e.opened_at for e in press_evs),
            closed_at=None,
            via="press",
            press_confirmed=True,
            press_count=sum(e.press_count for e in press_evs),
            sources=sorted({s for e in press_evs for s in e.sources}),
        )
        events = [e for e in events if e.via != "press"] + [merged]
    else:
        # Cierre de prensa frío sin reapertura: el fin es incierto —
        # usamos la última mención como cota y lo declaramos
        for ev in press_evs:
            if ev.closed_at is not None:
                continue
            last = ev.last_closure or ev.opened_at
            if today - last > PRESS_STALE:
                ev.closed_at = last
                ev.end_estimated = True

    return sorted(events, key=lambda e: e.opened_at, reverse=True)


# ── Agrupación por episodio ──────────────────────────────────────────
# Una playa extensa tiene varios puntos de muestreo (PM1, PM4…): un
# mismo episodio real (vertido, analítica mala) aparece una vez por PM.
# Para la línea temporal y el ranking cuenta como UN incidente.

EPISODE_GAP = timedelta(days=14)


@dataclass
class Episode:
    """Una fila de línea temporal pre-agrupación."""

    beach_id: int
    base: str  # nombre de playa sin sufijo PMx
    municipality: str | None
    kind: str  # "closure" | "warning"
    start: date
    end: date | None
    via: str  # "official" | "measurement" | "press"
    ref_id: int  # id del BeachIncident oficial o negativo sintético
    obs: str | None
    press_count: int = 0
    end_estimated: bool = False


def base_name(name: str) -> str:
    """Nombre de playa sin el sufijo de punto de muestreo."""
    import re

    return re.sub(r"\s+PM\d+$", "", name)


def _near(a_end: date | None, b_start: date, today: date) -> bool:
    """Un episodio abierto absorbe todo lo posterior; si no, hueco ≤14d
    entre el fin de uno y el inicio del siguiente = mismo episodio."""
    return b_start <= (a_end or today) + EPISODE_GAP


def cluster_episodes(
    eps: list[Episode], today: date | None = None
) -> list[list[Episode]]:
    """Agrupa episodios de la misma playa (base+municipio) cuyas
    ventanas se solapan o distan ≤14 días. Devuelve grupos en el orden
    de llegada (eps ya deben venir ordenados por start asc)."""
    today = today or date.today()
    groups: list[list[Episode]] = []
    for ep in sorted(eps, key=lambda e: e.start):
        for g in groups:
            g0 = g[0]
            if (g0.municipality, g0.base) != (ep.municipality, ep.base):
                continue
            g_end = max(e.end or today for e in g)
            if ep.start <= g_end + EPISODE_GAP:
                g.append(ep)
                break
        else:
            groups.append([ep])
    return groups


def merged_episode(g: list[Episode]) -> Episode:
    """Una fila por episodio: playa base, ventana unión, via del mejor
    respaldo (official > measurement > press)."""
    via = (
        "official"
        if any(e.via == "official" for e in g)
        else "measurement"
        if any(e.via == "measurement" for e in g)
        else "press"
    )
    official_obs = next((e.obs for e in g if e.via == "official"), None)
    press_n = sum(e.press_count for e in g)
    if official_obs is not None:
        media = "noticia" if press_n == 1 else "noticias"
        obs = official_obs + (f" · {press_n} {media} en prensa" if press_n else "")
    else:
        # los eventos sintéticos ya llevan la mención a prensa en su obs
        obs = next((e.obs for e in g if e.obs), None)
    return Episode(
        beach_id=min(e.beach_id for e in g),
        base=g[0].base,
        municipality=g[0].municipality,
        kind="closure" if any(e.kind == "closure" for e in g) else "warning",
        start=min(e.start for e in g),
        end=None if any(e.end is None for e in g) else max(
            e.end for e in g if e.end
        ),
        via=via,
        ref_id=next(
            (e.ref_id for e in g if e.via == "official"), g[0].ref_id
        ),
        obs=obs,
        press_count=press_n,
        end_estimated=any(e.end_estimated for e in g),
    )

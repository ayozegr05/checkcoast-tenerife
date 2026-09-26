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

from collections import Counter
from dataclasses import dataclass, field
from datetime import date, timedelta

from app.models import Beach
from app.queries import _STRUCTURAL_CAUSES, _short_cause, is_ungraded_note

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
    # Inicio real según el texto de la noticia ("cerrada desde julio
    # de 2024" → "2024-07"), cuando adelanta a la fecha de publicación
    closed_since: str | None = None
    # Causas crudas de los titulares del clúster — la dominante decide
    # si el episodio es estructural (no caduca por silencio de prensa)
    causes: list[str] = field(default_factory=list)
    # Primera fecha de cobertura del clúster (primer titular) — opened_at
    # puede retroceder más allá por closed_since; necesario para recalcular
    # el inicio cuando gana un closed_since más preciso del mismo año
    first_pub: date | None = None


def _bad(m) -> bool:
    return bool(m.evaluation and "prohib" in m.evaluation.lower())


def _closed_since_date(raw: str | None) -> date | None:
    """ISO parcial ("2024", "2024-07", "2024-07-15") → la fecha más
    temprana compatible. None si falta o está mal formada."""
    if not raw:
        return None
    try:
        parts = [int(p) for p in raw.split("-")]
        if len(parts) == 1:
            return date(parts[0], 1, 1)
        if len(parts) == 2:
            return date(parts[0], parts[1], 1)
        return date(parts[0], parts[1], parts[2])
    except (TypeError, ValueError):
        return None


def _min_closed_since(vals) -> str | None:
    """El inicio real más antiguo afirmado por las fuentes; a igual año
    gana el más preciso ("2024-07" informa más que "2024")."""
    vals = [v for v in vals if v]
    return min(vals, key=lambda v: (v[:4], -len(v)), default=None)


def _is_structural(ev: "SynthEvent") -> bool:
    """El episodio es por causa estructural (desprendimientos, obras):
    no se resuelve solo — sin reapertura explícita sigue vigente aunque
    la prensa calle (misma regla que /alerts: Benijo ~2 años).

    La decide la causa DOMINANTE del clúster — la misma votación que la
    causa mostrada y que _press_cause en /alerts — no "cualquiera": un
    titular minoritario que mencione obras de pasada (Candelaria:
    "materiales de obra" en un vertido) no vuelve eterno el episodio."""
    cats = [c for c in (_short_cause(x) for x in ev.causes) if c]
    if not cats:
        return False
    return Counter(cats).most_common(1)[0][0] in _STRUCTURAL_CAUSES


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

    # 2. Descartar ventanas ya cubiertas por incidencia oficial. Las
    # notas "Sin Calificar" no son incidencias reales (registro de
    # muestra sin evaluar) — no cubren ventanas ni tragan prensa:
    # Gaviotas se cerró por el municipio el 3-jun y Náyade solo anotó
    # "sin calificar" el 8-jun → el episodio es el cierre de prensa
    official = [
        (i.opened_at, i.closed_at)
        for i in beach.incidents
        if not is_ungraded_note(i.observations)
    ]
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

    # 4. Clústeres de cierres sueltos → un evento cada uno. La
    # pertenencia se mide por la cobertura (última mención ≤45 días),
    # no por opened_at: `closed_since` puede retroceder el inicio del
    # episodio años atrás sin romper la agrupación
    for n in loose:
        pub = n.published_at.date()
        cluster = next(
            (
                ev
                for ev in events
                if ev.via == "press"
                and pub - PRESS_CLUSTER_GAP <= (ev.last_closure or pub)
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
                    first_pub=pub,
                )
            )
            cluster = events[-1]
        cluster.closed_since = _min_closed_since(
            [cluster.closed_since, n.closed_since]
        )
        # El inicio real es el del closed_since ganador (el más
        # preciso del año más antiguo: "2024-07" manda sobre "2024");
        # sin él, la primera fecha de cobertura
        cluster.opened_at = min(
            cluster.first_pub or pub,
            _closed_since_date(cluster.closed_since) or date.max,
        )
        cluster.press_count += 1
        cluster.last_closure = max(cluster.last_closure or pub, pub)
        if n.cause:
            cluster.causes.append(n.cause)
        if n.source and n.source not in cluster.sources:
            cluster.sources.append(n.source)

    # 5. Reaperturas: corroboran la ventana en la que caen, o cierran
    # el clúster de prensa más reciente que las precede. Una "ola" de
    # reaperturas (varios titulares del mismo suceso, hueco <=GAP)
    # cierra UN solo episodio — El Médano: 8 reaperturas del 25/09
    # resuelven el cierre del 23/09, no también el de julio, que
    # caducó sin cobertura y queda con fin estimado (paso 6)
    last_close_pub: date | None = None
    closed_ev: SynthEvent | None = None
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
            newer_ep = any(
                (ev.last_closure or ev.opened_at) > last_close_pub
                for ev in open_press
            ) if last_close_pub else False
            same_wave = (
                last_close_pub is not None
                and pub - last_close_pub <= PRESS_CLUSTER_GAP
                and not newer_ep
            )
            if same_wave:
                # Mismo suceso de reapertura: apoya al episodio ya
                # cerrado, no cierra uno más antiguo
                if closed_ev is not None:
                    closed_ev.press_count += 1
                    if n.source and n.source not in closed_ev.sources:
                        closed_ev.sources.append(n.source)
                continue
            if open_press:
                # Preferir el clúster cuya última mención de cierre
                # esté a <=GAP; sin cercanos, solo cerrar si es el
                # único abierto (un cierre estructural puede durar
                # años: Benijo). Con varios abiertos y reapertura
                # lejana, el viejo caducó en silencio
                near = [
                    ev
                    for ev in open_press
                    if pub - (ev.last_closure or ev.opened_at)
                    <= PRESS_CLUSTER_GAP
                ]
                pool = near or (
                    open_press if len(open_press) == 1 else []
                )
                if pool:
                    ev = max(pool, key=lambda e: e.opened_at)
                    ev.closed_at = pub
                    ev.press_count += 1
                    if n.source and n.source not in ev.sources:
                        ev.sources.append(n.source)
                    last_close_pub = pub
                    closed_ev = ev

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

    # 6. Si el último cambio es un cierre y la cobertura sigue fresca
    # —o el episodio abierto es de causa estructural, que no caduca
    # por silencio (misma regla que /alerts)— la playa sigue cerrada
    # según prensa: los clústeres abiertos son UN solo episodio
    # continuo — se fusionan con la fecha más antigua (Benijo: cierre
    # de jul-2024 con picos de noticias en mayo y julio de 2026)
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
    press_evs = [ev for ev in events if ev.via == "press"]
    open_press = [ev for ev in press_evs if ev.closed_at is None]
    structural = any(_is_structural(ev) for ev in open_press)
    still_closed = (
        latest_change is not None
        and latest_change.event_type == "closure"
        and bool(open_press)
        and (fresh or structural)
    )
    if still_closed:
        # También los ya "cerrados" por una reapertura: si la playa
        # sigue cerrada, esas reaperturas eran espurias ("agilizan las
        # obras" mal clasificadas) y el episodio nunca se interrumpió
        merged = SynthEvent(
            kind="closure",
            opened_at=date.max,  # se fija abajo desde closed_since
            closed_at=None,
            via="press",
            press_confirmed=True,
            press_count=sum(e.press_count for e in press_evs),
            sources=sorted({s for e in press_evs for s in e.sources}),
            closed_since=_min_closed_since(
                e.closed_since for e in press_evs
            ),
            causes=[c for e in press_evs for c in e.causes],
            first_pub=min(e.first_pub or e.opened_at for e in press_evs),
        )
        merged.opened_at = min(
            merged.first_pub or date.max,
            _closed_since_date(merged.closed_since) or date.max,
        )
        events = [e for e in events if e.via != "press"] + [merged]
    else:
        # Cierre de prensa frío sin reapertura: el fin es incierto —
        # usamos la última mención como cota y lo declaramos, salvo
        # causa estructural (sigue abierta aunque nadie lo repita)
        for ev in open_press:
            if _is_structural(ev):
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
    # Causa normalizada del episodio ("Contaminación",
    # "Desprendimientos"...) — la calcula quien lo construye
    cause: str | None = None


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
        # Causa dominante del episodio fusionado (la más frecuente
        # entre los miembros que la tienen)
        cause=(
            Counter(e.cause for e in g if e.cause).most_common(1)
            or [(None, 0)]
        )[0][0],
    )

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
from app.queries import (
    _CAUSE_RANK,
    _STRUCTURAL_CAUSES,
    _short_cause,
    is_ungraded_note,
)

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
# Una pieza retrospectiva sobre un episodio ya reabierto sale en los
# días siguientes a la reapertura (resúmenes, análisis); un cierre
# real "de nuevo" puede llegar con 1 solo medio — pasada esta ventana
# se respeta siempre como episodio nuevo aunque sea minoritario
RETRO_WINDOW = timedelta(days=7)
# Sin reapertura ni muestra apta, el "fin" de un cierre de prensa es
# incierto: usamos la última mención y lo declaramos en el texto
# Hueco entre muestras dentro de una racha de prohibido: Náyade deja
# de muestrear gran parte de la isla fuera de temporada (~36/mes vs
# ~120 en verano) — un hueco largo se anota en el episodio porque el
# cierre pudo interrumpirse sin muestra que lo acredite
SAMPLE_GAP_NOTE = timedelta(days=45)


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
    # Noticias que forman el episodio — la ficha las despliega como
    # evidencia bajo la fila del historial ("Ver titulares")
    press_items: list = field(default_factory=list)
    # Huecos >SAMPLE_GAP_NOTE entre muestras dentro de la ventana de
    # analítica (parada invernal): el episodio pudo interrumpirse sin
    # muestra que lo acredite — se declara en las observaciones
    sample_gaps: list[tuple[date, date]] = field(default_factory=list)


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
    gana el más preciso ("2024-07" informa más que "2024") y a igual
    precisión la fecha más antigua — sin el tercer criterio, `min`
    devolvía el PRIMER valor en orden de filas (el más reciente, ya
    que llegan DESC): Jardín oct-2026 afirmaba "desde el 07/10"
    teniendo "2026-09-29" en el pool."""
    vals = [v for v in vals if v]
    return min(vals, key=lambda v: (v[:4], -len(v), v), default=None)


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


def _in_window(pub: date, start: date, end: date | None, today: date) -> bool:
    """Fecha de prensa dentro de la ventana ampliada del episodio."""
    return (
        start - PRESS_FUZZ_BEFORE <= pub <= (end or today) + PRESS_FUZZ_AFTER
    )


def synthesize_events(
    beach: Beach, today: date | None = None
) -> list[SynthEvent]:
    """Eventos reconstruidos de una playa (incidencias oficiales
    aparte — estas son las que faltan en Náyade)."""
    today = today or date.today()

    # 1. Ventanas de prohibición por analítica (rachas de "prohibido")
    # — guardando las fechas de las malas para anotar huecos de
    # muestreo dentro de cada ventana (parada invernal)
    ms = sorted(beach.measurements, key=lambda m: m.sampled_at)
    windows: list[tuple[date, date | None, list[date]]] = []
    run_start: date | None = None
    run_bad: list[date] = []
    for m in ms:
        if _bad(m):
            if run_start is None:
                run_start = m.sampled_at
            run_bad.append(m.sampled_at)
        elif run_start is not None:
            windows.append((run_start, m.sampled_at, run_bad))
            run_start = None
            run_bad = []
    if run_start is not None:
        windows.append((run_start, None, run_bad))  # prohibición viva

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
            kind="closure",
            opened_at=s,
            closed_at=e,
            via="measurement",
            sample_gaps=[
                (a, b) for a, b in zip(rb, rb[1:]) if b - a > SAMPLE_GAP_NOTE
            ],
        )
        for s, e, rb in windows
        if not any(_overlaps(s, e, o_s, o_e) for o_s, o_e in official)
    ]

    # 3-5. Prensa en orden CRONOLÓGICO, cierres y reaperturas
    # entremezclados: un cierre se suma al clúster vigente (hueco ≤45 d
    # entre menciones de cierre) o abre episodio nuevo; una reapertura
    # corrobora la ventana de analítica o la incidencia oficial en la
    # que cae y, si no cae en ninguna, cierra el clúster vigente y hace
    # de FRONTERA — los cierres posteriores son otro episodio aunque el
    # hueco sea <GAP (Jardín: reabrió de verdad el 14-ago y el 4-sep —
    # los cierres del 30-sep no son "el mismo cierre de agosto")
    items = sorted(
        (
            n
            for n in beach.news_items
            if n.relevant and n.published_at and n.event_type
        ),
        key=lambda n: n.published_at,
    )

    def _add_press(ev: SynthEvent, n, pub: date) -> None:
        ev.press_count += 1
        ev.press_items.append(n)
        if n.source and n.source not in ev.sources:
            ev.sources.append(n.source)

    press_evs: list[SynthEvent] = []
    current: SynthEvent | None = None  # clúster de prensa abierto
    last_closed: SynthEvent | None = None  # para la "ola" de titulares
    boundary = False  # reapertura desde el último cierre
    # Medios que reportaron cierre cada día: un cierre post-reapertura
    # sin corroboración (1 medio, sin cuerpo verificado) suele ser una
    # retrospectiva del episodio resuelto, no un suceso nuevo
    outlets_by_day: dict[date, set] = {}
    for it0 in items:
        if it0.event_type == "closure" and it0.published_at:
            outlets_by_day.setdefault(it0.published_at.date(), set()).add(
                it0.source or ""
            )
    for n in items:
        pub = n.published_at.date()
        if n.event_type == "closure":
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
                _add_press(hit, n, pub)
                continue
            # La noticia cubre una incidencia oficial: no duplicar.
            # Una incidencia la "cubre" solo si su fin no precede al
            # inicio que afirma el texto: closed_since posterior al
            # closed_at oficial es un episodio NUEVO (Jardín PM4: la
            # incidencia cerró el 3-sep y la prensa del 30-sep grita
            # "cerrada desde el 29-sep", que es el cierre VIGENTE).
            # Y un clúster de prensa vivo absorbe la mención aunque
            # caiga dentro del fuzz de una incidencia vieja — pero
            # solo si la mención seguiría al clúster (hueco ≤GAP desde
            # su última cobertura): una mención más lejana ya no se
            # sumaría a él — crearía episodio nuevo — y dentro de una
            # ventana oficial es cobertura de ESE episodio, no un
            # clúster propio (El Médano: prensa del 23-sep dentro de
            # la incidencia oficial 21→24-sep con un clúster de julio
            # aún vivo — son episodios distintos)
            cs_d = _closed_since_date(n.closed_since)
            live = (
                current is not None
                and current.closed_at is None
                and pub - (current.last_closure or current.opened_at)
                <= PRESS_CLUSTER_GAP
            )
            covered = any(
                _in_window(pub, o_s, o_e, today)
                and (o_e is None or cs_d is None or cs_d <= o_e)
                for o_s, o_e in official
            )
            if covered and not live:
                continue
            # Retrospectiva: el titular sale DESPUÉS de la reapertura
            # pero relata el episodio ya resuelto. Lo delata su texto
            # (closed_since ≤ reapertura — estenerife: "amanecieron
            # cerradas este miércoles" publicado el viernes). Dentro de
            # la ventana retrospectiva un cierre sin closed_since solo
            # es episodio nuevo si varios medios lo cubrieron ese día:
            # una sola pieza de análisis no resucita lo cerrado. OJO:
            # body_verified aquí NO prueba suceso nuevo — solo dice que
            # la extracción leyó el cuerpo; la prueba es closed_since
            if boundary and last_closed is not None:
                retro_d = _closed_since_date(n.closed_since)
                is_new = (
                    retro_d is not None
                    and retro_d > (last_closed.closed_at or pub)
                ) or (
                    retro_d is None
                    and (
                        pub - (last_closed.closed_at or pub) > RETRO_WINDOW
                        or len(outlets_by_day.get(pub, set())) >= 2
                    )
                )
                if not is_new:
                    _add_press(last_closed, n, pub)
                    if n.cause:
                        last_closed.causes.append(n.cause)
                    continue
            # Un episodio ESTRUCTURAL abierto solo muere por reapertura
            # explícita (misma regla que la caducidad): si el clúster
            # vigente no se cerró, una mención de cierre a >GAP es la
            # misma obra que sigue sin terminar — Gaviotas siguió
            # cerrada de jun a sep sin noticias, y el titular del 14-sep
            # ("Costas autoriza obras para reabrir") es ese episodio,
            # no uno nuevo
            if (
                current is None
                or boundary
                or (
                    pub - (current.last_closure or current.opened_at)
                    > PRESS_CLUSTER_GAP
                    and not (
                        current.closed_at is None and _is_structural(current)
                    )
                )
            ):
                current = SynthEvent(
                    kind="closure",
                    opened_at=pub,
                    closed_at=None,
                    via="press",
                    press_confirmed=True,
                    first_pub=pub,
                )
                press_evs.append(current)
            boundary = False
            current.closed_since = _min_closed_since(
                [current.closed_since, n.closed_since]
            )
            # El inicio real es el del closed_since ganador (el más
            # preciso del año más antiguo: "2024-07" manda sobre
            # "2024"); sin él, la primera fecha de cobertura
            current.opened_at = min(
                current.first_pub or pub,
                _closed_since_date(current.closed_since) or date.max,
            )
            _add_press(current, n, pub)
            current.last_closure = max(current.last_closure or pub, pub)
            if n.cause:
                current.causes.append(n.cause)
        elif n.event_type == "reopening":
            # Toda reapertura marca frontera temporal: un cierre
            # posterior ya no es "la misma" cobertura aunque esta
            # reapertura resuelva una ventana oficial/analítica — salvo
            # que sea anterior a la última mención del clúster vigente
            # (noticia que relata una reapertura vieja en medio de la
            # cobertura del cierre)
            boundary = current is None or pub > (
                current.last_closure or current.opened_at
            )
            hit = next(
                (
                    ev
                    for ev in events
                    if ev.via == "measurement"
                    and _in_window(pub, ev.opened_at, ev.closed_at, today)
                ),
                None,
            )
            if hit is not None:
                hit.press_confirmed = True
                _add_press(hit, n, pub)
                hit.reopenings_in_window.append(pub)
                continue
            # Una reapertura dentro de la ventana de una incidencia
            # oficial resuelve ESE episodio: no cierra el clúster de
            # prensa vigente (El Médano: la ola del 25/09 resolvía la
            # incidencia oficial 21→24-sep, no un cierre añejo)
            if any(_in_window(pub, o_s, o_e, today) for o_s, o_e in official):
                continue
            if (
                current is not None
                and current.closed_at is None
                and (current.last_closure or current.opened_at) <= pub
            ):
                current.closed_at = pub
                _add_press(current, n, pub)
                last_closed = current
            elif (
                last_closed is not None
                and last_closed.closed_at is not None
                and pub - last_closed.closed_at <= PRESS_CLUSTER_GAP
            ):
                # Misma ola de reapertura (varios medios, mismo suceso):
                # apoya al episodio ya cerrado, no es frontera nueva
                _add_press(last_closed, n, pub)

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
            d
            for d in ev.reopenings_in_window
            if last_bad is None or d > last_bad
        ]
        ev.press_reopening = max(ev.reopenings_in_window)
        if candidates:
            ev.closed_at = max(candidates)
            ev.end_from_press = True

    # 6. Si el último cambio es un cierre y la cobertura sigue fresca
    # —o el episodio abierto es de causa estructural, que no caduca
    # por silencio (misma regla que /alerts)— la playa sigue cerrada
    # según prensa: los clústeres contiguos no separados por una
    # reapertura REAL se fusionan en un episodio continuo. La frontera
    # solo es real si la reapertura quedó corroborada — muestra apta
    # o incidencia oficial cerrada entre ella y el cierre siguiente,
    # o ≥2 medios distintos la recogieron (Jardín: apta el 17-ago tras
    # la reapertura del 14 → episodios distintos). Sin corroboración la
    # reapertura era ruido ("agilizan las obras" mal clasificadas) y el
    # episodio nunca se interrumpió (Benijo)
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
    open_press = [ev for ev in press_evs if ev.closed_at is None]
    structural = any(_is_structural(ev) for ev in open_press)
    still_closed = (
        latest_change is not None
        and latest_change.event_type == "closure"
        and bool(open_press)
        and (fresh or structural)
    )
    if still_closed:
        # Un clúster transitorio abierto tampoco puede absorber
        # episodios futuros: si lleva >PRESS_STALE sin mención se da
        # por terminado en su última mención (mismo criterio que el
        # caso frío). Sin esto un cierre viejo sin reapertura publicada
        # se fusiona con el episodio vivo y el "desde" miente años
        # atrás (Punta Larga: vertido ago-2021 ≠ socavación may-2026)
        for ev in press_evs:
            if ev.closed_at is None and not _is_structural(ev):
                last = ev.last_closure or ev.opened_at
                if today - last > PRESS_STALE:
                    ev.closed_at = last
                    ev.end_estimated = True

        def _reopen_confirmed(ev: SynthEvent, bound: date) -> bool:
            """La reapertura que cerró el episodio es real: hay prueba
            oficial (muestra apta o incidencia cerrada) entre ella y el
            siguiente cierre, o la cubrieron ≥2 medios distintos, o un
            medio solo pero con la extracción verificada contra el
            cuerpo del artículo (un titular ambiguo tipo "agilizan las
            obras" se desmonta leyendo el texto)."""
            if ev.closed_at is None:
                return False
            reopen_items = [
                i for i in ev.press_items if i.event_type == "reopening"
            ]
            reopen_press = {i.source for i in reopen_items if i.source}
            return (
                len(reopen_press) >= 2
                or any(i.body_verified for i in reopen_items)
                or any(
                    not _bad(m) and ev.closed_at <= m.sampled_at <= bound
                    for m in ms
                )
                or any(
                    o_e is not None
                    and ev.closed_at - PRESS_FUZZ_BEFORE <= o_e <= bound
                    for _o_s, o_e in official
                )
            )

        ordered = sorted(press_evs, key=lambda e: e.opened_at)
        runs: list[list[SynthEvent]] = [[ordered[0]]]
        for prev, ev in zip(ordered, ordered[1:]):
            # end_estimated también es frontera: el episodio transitorio
            # murió por silencio, el siguiente clúster es otro suceso
            if prev.end_estimated or _reopen_confirmed(
                prev, ev.first_pub or ev.opened_at
            ):
                runs.append([ev])
            else:
                runs[-1].append(ev)
        merged_evs = []
        for run in runs:
            merged = SynthEvent(
                kind="closure",
                opened_at=date.max,  # se fija abajo desde closed_since
                closed_at=run[-1].closed_at,
                via="press",
                press_confirmed=True,
                press_count=sum(e.press_count for e in run),
                sources=sorted({s for e in run for s in e.sources}),
                closed_since=_min_closed_since(e.closed_since for e in run),
                end_estimated=run[-1].end_estimated,
                causes=[c for e in run for c in e.causes],
                first_pub=min(e.first_pub or e.opened_at for e in run),
                press_items=[i for e in run for i in e.press_items],
            )
            merged.opened_at = min(
                merged.first_pub or date.max,
                _closed_since_date(merged.closed_since) or date.max,
            )
            merged_evs.append(merged)
        events += merged_evs
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
        events += press_evs

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
    # Inicio del último tramo de cierre dentro del episodio
    # fusionado — cuando el incidente oficial queda abierto meses
    # pero la prensa documenta cierres/reaperturas intermedios, el
    # tramo real del último cierre es lo que importa al bañista
    # (Jardín: incidente jun-oct, último tramo 7→9 oct)
    last_leg_start: date | None = None


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
        obs = official_obs + (
            f" · {press_n} {media} en prensa" if press_n else ""
        )
    else:
        # los eventos sintéticos ya llevan la mención a prensa en su obs
        obs = next((e.obs for e in g if e.obs), None)
    merged_end = (
        None
        if any(e.end is None for e in g)
        else max(e.end for e in g if e.end)
    )
    # Último tramo de cierre: el cierre más reciente del grupo que
    # no supera el fin del episodio — un incidente oficial abierto
    # 110 días con reaperturas de prensa dentro muestra el tramo
    # real del último cierre, no el rato administrativo de Náyade
    leg = max(
        (
            e
            for e in g
            if e.kind == "closure"
            and (merged_end is None or e.start <= merged_end)
        ),
        key=lambda e: e.start,
        default=None,
    )
    last_leg_start = leg.start if leg else None
    return Episode(
        # El PM representativo es el del último tramo: al abrir la
        # ficha desde la fila del episodio se ve la zona que cerró
        # por última vez, no un PM arbitrario del complejo
        beach_id=leg.beach_id if leg else min(e.beach_id for e in g),
        base=g[0].base,
        municipality=g[0].municipality,
        kind="closure" if any(e.kind == "closure" for e in g) else "warning",
        start=min(e.start for e in g),
        end=merged_end,
        via=via,
        ref_id=next((e.ref_id for e in g if e.via == "official"), g[0].ref_id),
        obs=obs,
        press_count=press_n,
        # El fin solo es estimado si la fecha que gana vino de la
        # última mención — un cierre oficial posterior lo invalida
        end_estimated=merged_end is not None
        and any(e.end_estimated and e.end == merged_end for e in g),
        # Etiqueta del episodio fusionado: la más específica
        # (_CAUSE_RANK); la mayoría solo desempata al mismo nivel —
        # los eventos de analítica inyectan "Contaminación" genérica
        # y no deben tapar el parámetro que nombró la prensa
        cause=min(
            (
                (c, n)
                for c, n in Counter(e.cause for e in g if e.cause).items()
            ),
            key=lambda cn: (_CAUSE_RANK.get(cn[0], 9), -cn[1]),
            default=(None, 0),
        )[0],
        last_leg_start=last_leg_start,
    )

"""Resumen de episodios de prensa de una playa (backend de
/beaches/{id}/news): la cadena de episodios extraída del router —
funciones puras sobre las filas de NewsItem + eventos sintetizados +
incidencias, testeables sin HTTP ni BD.

Contexto "según prensa": nunca altera el estado oficial, que solo
sale de Náyade.
"""

from dataclasses import dataclass, field
from datetime import UTC, date, datetime

from app.events import (
    PRESS_CLUSTER_GAP,
    RETRO_WINDOW,
    _closed_since_date,
    _corroborated_closed_since,
    _in_window,
    _is_structural,
)
from app.models import BeachIncident, NewsItem
from app.queries import (
    _episode_params,
    _press_cause,
    _short_cause,
    is_ungraded_note,
)


def _event_mode(items: list[NewsItem]) -> str | None:
    """Evento dominante: un cierre SIEMPRE gana — la reapertura es la
    resolución del episodio, no el evento (El Médano: 2 titulares de
    reapertura vs 1 de cierre, la noticia era el cierre)."""
    if any(it.event_type == "closure" for it in items):
        return "closure"
    return _news_mode(items, "event_type")


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


def _news_cause(items: list[NewsItem]) -> str | None:
    """Causa dominante para mostrar: votan solo categorías reales
    (_press_cause filtra mecanismos como "acceso prohibido" o la
    gestión posterior, "obras de emergencia"); el texto visible es el
    de la noticia más reciente de la categoría ganadora ("riesgo de
    desprendimientos" y no "Desprendimientos" a secas)."""
    cat = _press_cause(items)
    if cat is None:
        return None
    if cat == "E. coli y enterococos":
        # Etiqueta compuesta: muestra el texto del ítem que nombre los
        # dos parámetros (suele llevar la cifra, "E. coli >800 UFC…")
        for it in items:
            if _episode_params([it]) == {"E. coli", "Enterococos"}:
                return it.cause
        return cat
    for it in items:
        if _short_cause(it.cause) == cat:
            return it.cause
    return cat


@dataclass
class PressSummary:
    """Análisis de la cobertura de prensa de una playa. `since` y
    `closed_since` quedan expuestos como campos mutables: el ajuste del
    PM hermano (única parte del endpoint que consulta la BD) puede
    sobrescribirlos antes de serializar."""

    dominant: str | None
    cause: str | None
    since: datetime | None
    closed_since: str | None
    episode_items: list[NewsItem] = field(default_factory=list)
    still_open: bool = False


def press_episode_summary(
    rows: list[NewsItem],
    evs: list,
    incidents: list[BeachIncident],
    today: date,
) -> PressSummary:
    """Cadena de episodios de cobertura: evento/causa dominantes,
    inicio del episodio actual ("desde cuándo"), corroboración del
    "cerrada desde" y titulares del último episodio.

    `rows`: noticias relevantes de la playa, más reciente primero.
    `evs`: episodios sintetizados de la playa (`synthesize_events`).
    `incidents`: incidencias oficiales de la playa (`beach.incidents`).
    """
    dominant = _event_mode(rows)
    # Una reapertura real termina el episodio de cobertura: la
    # cadena no se encadena a través de ella aunque el hueco sea
    # <GAP (Jardín: cierres 12-ago→reapertura 4-sep→cierre 30-sep
    # son TRES episodios; el cierre de hoy no "viene del 12-ago")
    last_reopen = max(
        (
            d
            for r in rows
            if r.event_type == "reopening" and (d := r.published_at)
        ),
        default=None,
    )
    # "Desde cuándo": inicio del episodio ACTUAL, no del titular más
    # viejo — un hueco >PRESS_CLUSTER_GAP entre cierres separa
    # episodios (El Médano: cierres de julio + cierres de septiembre;
    # el banner debe anclar a septiembre, no a julio) y una reapertura
    # entre medios también rompe la cadena (Puertito: cierre 8-may →
    # reapertura 9-may → cierre 5-jun son dos episodios, el "desde" es
    # junio, no mayo)
    reopen_dates = sorted(
        d
        for r in rows
        if r.event_type == "reopening" and (d := r.published_at)
    )

    # Cierre "retrospectivo": publicado DESPUÉS de la reapertura pero
    # relata el episodio ya resuelto — lo delata su propio texto
    # (closed_since ≤ reapertura) o falta de corroboración como suceso
    # nuevo (un medio solo, sin cuerpo verificado). Un "cerrada de
    # nuevo" real llega con varios medios o con fecha propia — un
    # análisis tardío no puede resucitar el episodio (El Socorro:
    # pieza del 25-sep sobre el cierre del miércoles 23, publicada
    # tras la ola de reaperturas)
    closure_rows = [
        r for r in rows if r.event_type == "closure" and r.published_at
    ]
    outlets_by_day: dict[date, set] = {}
    for r in closure_rows:
        pub = r.published_at
        if pub is None:
            continue
        outlets_by_day.setdefault(pub.date(), set()).add(r.source or "")

    def _is_new_episode_closure(r: NewsItem) -> bool:
        pub = r.published_at
        if pub is None or last_reopen is None or pub <= last_reopen:
            return True
        cs = _closed_since_date(r.closed_since)
        if cs is not None:
            return cs > last_reopen.date()
        # Pasada la ventana retrospectiva, un cierre de 1 solo medio
        # es un suceso nuevo legítimo (Punta Larga). Dentro de ella,
        # sin closed_since que lo sitúe después, hace falta ola de
        # medios — body_verified solo dice que leyó el cuerpo, no que
        # el suceso sea nuevo
        return (
            pub - last_reopen > RETRO_WINDOW
            or len(outlets_by_day.get(pub.date(), set())) >= 2
        )

    dominant_rows = [
        r for r in rows if r.event_type == dominant and r.published_at
    ]
    dates = sorted(d for r in dominant_rows if (d := r.published_at))
    if dominant == "closure" and last_reopen is not None:
        post_reopen = [
            d
            for r in dominant_rows
            if (d := r.published_at) is not None
            and d > last_reopen
            and _is_new_episode_closure(r)
        ]
        if post_reopen:
            # dominant_rows viene del orden DESC de `rows`: sin
            # re-ordenar, `since` anclaría al titular más NUEVO del
            # episodio en vez del primero (Jardín oct-2026)
            dates = sorted(post_reopen)
    # Un episodio estructural ABIERTO no se parte por hueco de
    # cobertura: nadie repite la misma noticia mientras dura la obra
    # (Gaviotas: cierre jun-2026 y titular de sep es el mismo episodio
    # vivo, no uno nuevo). El hueco >GAP solo separa cuando la causa
    # es transitoria — ahí el silencio sí sugiere que reabrió sin
    # cobertura
    # Ventana de cobertura de cada episodio estructural ABIERTO: un
    # hueco >GAP dentro de su propia cobertura no parte el episodio
    # (Gaviotas: jun y sep-2026 son la misma obra) — pero el hueco
    # ENTRE un episodio muerto y el vivo sí separa (Punta Larga: el
    # vertido de 2021 no es la socavación de 2026)
    open_struct_spans = [
        (
            min(
                (p.date() for i in e.press_items if (p := i.published_at)),
                default=e.opened_at,
            ),
            e.last_closure or e.opened_at,
        )
        for e in evs
        if e.via == "press" and e.closed_at is None and _is_structural(e)
    ]
    since = None
    prev = None
    for d in dates:
        inside_open_struct = prev is not None and any(
            lo <= prev.date() <= hi and lo <= d.date() <= hi
            for lo, hi in open_struct_spans
        )
        boundary = prev is not None and (
            (d - prev > PRESS_CLUSTER_GAP and not inside_open_struct)
            or any(prev < r < d for r in reopen_dates)
        )
        if since is None or boundary:
            since = d
        prev = d
    coverage_since = since
    # El inicio del episodio es la evidencia MÁS ANTIGUA disponible:
    # si una incidencia oficial cubre la ventana, su opened_at manda
    # sobre la primera cobertura de prensa (El Socorro: Náyade dice
    # 21-sep aunque los titulares lleguen el 23 — la prensa llegó
    # tarde). Si la prensa se adelanta, vale su fecha
    official_start = None
    if since is not None:
        # La ventana se evalúa sobre el `since` ORIGINAL (ancla de
        # cobertura): mutarlo dentro del bucle permitía arrastrar
        # incidencias de episodios anteriores en cascada (Jardín PM4:
        # 30-sep → cubierto por la incidencia del 2-3 sep → y esa por
        # la del 11-ago → "desde el 11-ago" para el cierre actual)
        anchor = since.date()
        reopen_d = last_reopen.date() if last_reopen else None
        for inc in incidents:
            if is_ungraded_note(inc.observations):
                continue
            # Incidencia ya cerrada ANTES de la última reapertura:
            # pertenece al episodio anterior, no puede abrir este
            if (
                reopen_d is not None
                and inc.closed_at is not None
                and inc.closed_at <= reopen_d
            ):
                continue
            if _in_window(anchor, inc.opened_at, inc.closed_at, today):
                if official_start is None or inc.opened_at < official_start:
                    official_start = inc.opened_at
                opened = datetime.combine(
                    inc.opened_at, datetime.min.time(), tzinfo=UTC
                )
                if opened < since:
                    since = opened
    # closed_since: el propio texto puede afirmar un inicio real muy
    # anterior a la cobertura (Benijo: "cerrada desde julio de 2024"
    # aunque el titular sea de 2026). Si el episodio sigue abierto la
    # cadena de clústeres es una sola → miramos todos los cierres; si
    # ya se resolvió, solo el último clúster (el episodio del banner)
    closed_since = None
    still_open = dominant == "closure" and any(
        e.via == "press" and e.closed_at is None for e in evs
    )
    if dominant == "closure":
        if still_open:
            # Solo los cierres del episodio vivo: posteriores a la
            # última reapertura Y dentro de su cadena de cobertura —
            # Punta Larga: la socavación de 2026 no hereda el "desde
            # 2021" del vertido viejo; Jardín: el cierre de sep-2026 no
            # arrastra el "2024-07" del episodio ya reabierto
            pool = [
                r
                for r in rows
                if r.event_type == "closure"
                and r.published_at
                and (last_reopen is None or r.published_at > last_reopen)
                and (
                    coverage_since is None or r.published_at >= coverage_since
                )
            ]
        else:
            pool = [
                r
                for r in rows
                if r.event_type == "closure"
                and since is not None
                and r.published_at
                and r.published_at >= since
            ]
        # Solo gana el closed_since corroborado por >=2 medios: un
        # solo titular mal extraído no retrotrae el inicio (Gaviotas:
        # "desde jun-2024" de 1 medio vs jun-2026 de 6)
        closed_since = _corroborated_closed_since(pool)
        # Un "cerrada desde" anterior a la incidencia oficial que
        # cubre el episodio es imposible: el registro de Náyade
        # habría mostrado la playa cerrada. Es extracción errónea
        # (El Médano/El Socorro sep-2026: Gemini afirmó "2023-09-20"
        # — la playa SÍ cerró en 2023, pero este episodio era el
        # cierre temporal del 23-sep)
        if official_start is not None:
            cs_d = _closed_since_date(closed_since)
            if cs_d is not None and cs_d < official_start:
                closed_since = _corroborated_closed_since(
                    r
                    for r in pool
                    if (_d := _closed_since_date(r.closed_since)) is not None
                    and _d >= official_start
                )
    # Titulares del ÚLTIMO episodio de cobertura: clúster encadenado
    # por fecha (hueco >PRESS_CLUSTER_GAP rompe), con cualquier tipo
    # de evento — la reapertura forma parte del episodio que cierra.
    # El banner de la ficha despliega solo estos, no el saco de 30.
    # Si hay un evento nuevo DESPUÉS de la última reapertura, el
    # episodio actual empieza ahí — el clúster anterior ya se resolvió
    # La frontera del último episodio es la última reapertura ANTES
    # del último cierre/aviso: Puertito cerró 5-jun tras reabrir el
    # 9-may → su episodio actual son los titulares de junio; las
    # reaperturas del 6-jun que lo resolvieron también forman parte
    ep_pool = rows
    last_adverse = max(
        (
            r.published_at
            for r in rows
            if r.published_at
            and (
                r.event_type in ("warning", "pollution")
                or (r.event_type == "closure" and _is_new_episode_closure(r))
            )
        ),
        default=None,
    )
    if last_adverse is not None:
        ep_boundary = max(
            (r for r in reopen_dates if r < last_adverse), default=None
        )
        if ep_boundary is not None:
            ep_pool = [
                r
                for r in rows
                if r.published_at and r.published_at > ep_boundary
            ]
    ep_start = None
    prev_d = None
    for d in sorted(r.published_at for r in ep_pool if r.published_at):
        if (
            prev_d is not None
            and d - prev_d > PRESS_CLUSTER_GAP
            and not any(
                lo <= prev_d.date() <= hi and lo <= d.date() <= hi
                for lo, hi in open_struct_spans
            )
        ):
            ep_start = d
        elif ep_start is None:
            ep_start = d
        prev_d = d
    episode_items = [
        r
        for r in ep_pool
        if r.published_at
        and ep_start is not None
        and r.published_at >= ep_start
    ]
    return PressSummary(
        dominant=dominant,
        cause=_news_cause(rows),
        since=since,
        closed_since=closed_since,
        episode_items=episode_items,
        still_open=still_open,
    )

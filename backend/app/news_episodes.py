"""Resumen de episodios de prensa de una playa (backend de
/beaches/{id}/news): la cadena de episodios extraída del router —
funciones puras sobre las filas de NewsItem + eventos sintetizados +
incidencias, testeables sin HTTP ni BD.

Contexto "según prensa": nunca altera el estado oficial, que solo
sale de Náyade.
"""

from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import cast

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
    clean_cause_text,
    is_sea_state_cause,
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
        # dos parámetros (suele llevar la cifra — clean_cause_text la
        # quita: el valor exacto vive en la gráfica)
        for it in items:
            if _episode_params([it]) == {"E. coli", "Enterococos"}:
                return clean_cause_text(it.cause)
        return cat
    for it in items:
        if _short_cause(it.cause) == cat:
            return clean_cause_text(it.cause)
    return cat


def anchor_is_new_closure_wave(rows: list, anchor: date) -> bool:
    """¿La oleada de cierres publicada el día `anchor` documenta un
    episodio NUEVO corroborado?

    `anchor` es a la vez el `closed_at` de un acta oficial (día de
    reapertura) y el inicio del episodio de prensa. Misma regla de
    corroboración que `_is_new_episode_closure`: un `closed_since`
    posterior al día del ancla lo prueba solo; sin él hace falta ola
    de medios (>=2) — una pieza suelta publicada el día de la
    reapertura relata el episodio anterior, no uno nuevo. Las piezas
    con `closed_since` ANTERIOR al ancla son retrospectivas
    probadas y no corroboran (Jardín 07/10: Sanidad reabrió por la
    mañana y la recerraron por la tarde — el 4º cierre llegó con 5
    medios el mismo día)."""
    outlets: set[str] = set()
    for r in rows:
        if (
            r.event_type != "closure"
            or r.published_at is None
            or r.published_at.date() != anchor
        ):
            continue
        cs = _closed_since_date(r.closed_since)
        if cs is not None and cs > anchor:
            return True
        if (cs is None or cs == anchor) and r.source:
            outlets.add(r.source)
    return len(outlets) >= 2


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
    # Cierres preventivos por estado del mar (oleaje, temporal
    # marítimo) no narran este resumen — fuera del foco de la app,
    # mismo corte que en synthesize_events/effective_states
    rows = [r for r in rows if not is_sea_state_cause(r.cause)]
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

    def _is_new_episode_closure(
        r: NewsItem, reopen: datetime | None = None
    ) -> bool:
        reopen = last_reopen if reopen is None else reopen
        pub = r.published_at
        if pub is None or reopen is None or pub <= reopen:
            return True
        cs = _closed_since_date(r.closed_since)
        if cs is not None:
            # cs anterior a la reapertura → pieza retrospectiva del
            # episodio resuelto. cs POSTERIOR → episodio nuevo. cs del
            # MISMO día es ambiguo (Jardín: reabrió por la mañana y
            # cerró por la tarde — el 4º cierre era episodio nuevo) →
            # decide la corroboración de medios como si no hubiera cs
            if cs > reopen.date():
                return True
            if (
                cs == reopen.date()
                and len(outlets_by_day.get(pub.date(), set())) >= 2
            ):
                return True
            return False
        # Pasada la ventana retrospectiva, un cierre de 1 solo medio
        # es un suceso nuevo legítimo (Punta Larga). Dentro de ella,
        # sin closed_since que lo sitúe después, hace falta ola de
        # medios — body_verified solo dice que leyó el cuerpo, no que
        # el suceso sea nuevo
        return (
            pub - reopen > RETRO_WINDOW
            or len(outlets_by_day.get(pub.date(), set())) >= 2
        )

    dominant_rows = [
        r for r in rows if r.event_type == dominant and r.published_at
    ]
    dominant_items = sorted(
        dominant_rows, key=lambda r: cast(datetime, r.published_at)
    )
    if dominant == "closure" and last_reopen is not None:
        post_reopen = [
            r
            for r in dominant_items
            if r.published_at
            and r.published_at > last_reopen
            and _is_new_episode_closure(r)
        ]
        if post_reopen:
            dominant_items = post_reopen
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
            # La ventana cubre TODA la cobertura del episodio vivo:
            # sin ella el fallback a opened_at degeneraba el span a
            # su primer día y cualquier hueco >GAP partía el episodio
            # (Gaviotas: jun-16→sep-14 quedaba fuera → 1 titular)
            max(
                (p.date() for i in e.press_items if (p := i.published_at)),
                default=e.last_closure or e.opened_at,
            ),
        )
        for e in evs
        if e.via == "press" and e.closed_at is None and _is_structural(e)
    ]
    # Una reapertura intercalada solo corta la cadena si lo que la
    # sigue es un episodio NUEVO de verdad — misma regla que la cadena
    # de titulares: una pieza retrospectiva del episodio resuelto no
    # reabre el "desde" (Médano: los cierres de estenerife del 25-sep
    # salieron ENTRE reaperturas del mismo día; cortar ahí dejaba
    # since=25-sep aunque el episodio arrancaba el 23)
    since = None
    prev = None
    for item in dominant_items:
        d = cast(datetime, item.published_at)
        inside_open_struct = False
        boundary = False
        if prev is not None:
            p = prev
            inside_open_struct = any(
                lo <= p.date() <= hi and lo <= d.date() <= hi
                for lo, hi in open_struct_spans
            )
            boundary = (
                d - p > PRESS_CLUSTER_GAP and not inside_open_struct
            ) or any(
                p < rd < d
                and (
                    item.event_type != "closure"
                    or _is_new_episode_closure(item, rd)
                )
                for rd in reopen_dates
            )
        if since is None or boundary:
            since = d
        prev = d
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
    # Titulares del ÚLTIMO episodio de cobertura. Se camina hacia
    # atrás por la cadena de sucesos adversos (cierre/aviso/
    # contaminación): un hueco >PRESS_CLUSTER_GAP la rompe, y una
    # reapertura entre dos sucesos solo la rompe si el siguiente es
    # un episodio NUEVO de verdad — una pieza retrospectiva publicada
    # entre reaperturas sigue siendo cobertura del episodio resuelto
    # (Médano: las 2 piezas de cierre del 25-sep salieron a las 11:03
    # ENTRE reaperturas del 07:00 y 14:17; cortar ahí dejaba solo 6
    # titulares y escondía los 14 del 23-sep que narran el mismo
    # episodio). El banner despliega todo este episodio, no el saco
    # de 30 ni el último clúster.
    ep_chain_start = None
    prev_adv = None
    for r in sorted(
        (it for it in rows if it.published_at),
        key=lambda it: cast(datetime, it.published_at),
    ):
        if r.event_type not in ("closure", "warning", "pollution"):
            continue
        d = cast(datetime, r.published_at)
        if prev_adv is not None:
            pa = prev_adv
            cut = d - pa > PRESS_CLUSTER_GAP or any(
                pa < rd < d
                and (
                    r.event_type != "closure" or _is_new_episode_closure(r, rd)
                )
                for rd in reopen_dates
            )
            if cut:
                ep_chain_start = d
        elif ep_chain_start is None:
            ep_chain_start = d
        prev_adv = d
    # La frontera del episodio es la última reapertura ANTES de que
    # arranque su cadena de sucesos: Puertito cerró 5-jun tras
    # reabrir el 9-may → su episodio actual son los titulares de
    # junio; las reaperturas del 6-jun que lo resolvieron también
    # forman parte
    ep_pool = rows
    if ep_chain_start is not None:
        ep_boundary = max(
            (r for r in reopen_dates if r < ep_chain_start), default=None
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
    ep_items_full = [
        r
        for r in ep_pool
        if r.published_at
        and ep_start is not None
        and r.published_at >= ep_start
    ]
    # Los desplegables enseñan los hitos del episodio (cierre/
    # reapertura/aviso/contaminación): una pieza "other" es contexto
    # de la ola pero no narra el suceso ("Salud Pública estudia un
    # cierre prolongado" — Jardín oct-2026: el banner decía 15
    # titulares y la fila del episodio 14 hitos). Salvo que el
    # dominante sea "other": ahí la pieza de contexto ES el episodio
    # y quitarla vaciaría la lista
    episode_items = [
        r
        for r in ep_items_full
        if dominant == "other" or r.event_type != "other"
    ]
    # closed_since: el propio texto puede afirmar un inicio real muy
    # anterior a la cobertura (Benijo: "cerrada desde julio de 2024"
    # aunque el titular sea de 2026). El saco de afirmaciones son los
    # cierres del episodio que se narra (episode_items) — ni toda la
    # historia (arrastraría episodios viejos: el "desde 2021" de Punta
    # Larga) ni un recorte por fecha de cobertura (con el since viejo
    # el Médano solo metía las 2 piezas de estenerife del 25-sep →
    # 1 solo medio → el "desde el 23" real se perdía sin corroborar)
    closed_since = None
    still_open = dominant == "closure" and any(
        e.via == "press" and e.closed_at is None for e in evs
    )
    if dominant == "closure":
        pool = [r for r in episode_items if r.event_type == "closure"]
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
    return PressSummary(
        dominant=dominant,
        cause=_news_cause(ep_items_full or rows),
        since=since,
        closed_since=closed_since,
        episode_items=episode_items,
        still_open=still_open,
    )

"""Tests de press_episode_summary — cadena de episodios de prensa.

Función pura sobre objetos en memoria — no toca BD (antes vivía
dentro del handler de /beaches/{id}/news y solo era testeable vía
HTTP).
"""

from datetime import UTC, date, datetime
from types import SimpleNamespace

from app.events import SynthEvent
from app.news_episodes import press_episode_summary

TODAY = date(2026, 10, 18)


def news(
    day: date,
    event_type: str = "closure",
    source: str = "eldia",
    closed_since: str | None = None,
    cause: str | None = None,
    hour: int = 0,
):
    return SimpleNamespace(
        published_at=datetime(
            day.year, day.month, day.day, hour, tzinfo=UTC
        ),
        event_type=event_type,
        source=source,
        closed_since=closed_since,
        cause=cause,
    )


def inc(opened: date, closed: date | None = None, obs: str | None = None):
    return SimpleNamespace(
        opened_at=opened, closed_at=closed, observations=obs
    )


def press_ev(
    opened: date,
    closed: date | None = None,
    causes: list[str] | None = None,
    items: list | None = None,
    last_closure: date | None = None,
):
    return SynthEvent(
        kind="closure",
        opened_at=opened,
        closed_at=closed,
        via="press",
        last_closure=last_closure,
        causes=list(causes or []),
        press_items=list(items or []),
    )


def test_closure_always_beats_reopening_as_dominant():
    # El Médano: 2 titulares de reapertura vs 1 de cierre — la noticia
    # era el cierre, la reapertura es la resolución del episodio
    rows = [
        news(date(2026, 9, 20), "closure"),
        news(date(2026, 9, 25), "reopening"),
        news(date(2026, 9, 26), "reopening", source="otra"),
    ]
    s = press_episode_summary(rows, evs=[], incidents=[], today=TODAY)
    assert s.dominant == "closure"


def test_since_anchors_latest_cluster_not_oldest():
    # El Médano: hueco >45 días entre cierres de julio y septiembre —
    # el banner ancla al episodio de septiembre, no al de julio
    rows = [
        news(date(2026, 7, 1)),
        news(date(2026, 7, 3), source="otra"),
        news(date(2026, 9, 20)),
        news(date(2026, 9, 22), source="otra"),
    ]
    s = press_episode_summary(rows, evs=[], incidents=[], today=TODAY)
    assert s.since == datetime(2026, 9, 20, tzinfo=UTC)


def test_reopening_breaks_the_chain():
    # Puertito: cierre 8-may → reapertura 9-may → cierre 5-jun son
    # dos episodios; el "desde" es junio, no mayo
    rows = [
        news(date(2026, 5, 8)),
        news(date(2026, 5, 9), "reopening"),
        news(date(2026, 6, 5)),
    ]
    s = press_episode_summary(rows, evs=[], incidents=[], today=TODAY)
    assert s.since == datetime(2026, 6, 5, tzinfo=UTC)


def test_retro_closure_filtered_from_new_episode_pool():
    # El Socorro: cierre publicado DESPUÉS de la reapertura pero su
    # closed_since confiesa que relata el episodio ya resuelto — no
    # entra en el pool de episodio nuevo, aunque sí narra el actual.
    # Si el retro contara como nuevo, `since` anclaría a su fecha de
    # publicación (12-sep) en vez del cierre real de octubre
    rows = [
        news(date(2026, 8, 10)),
        news(date(2026, 9, 10), "reopening"),
        news(date(2026, 9, 12), closed_since="2026-08-05"),
        news(date(2026, 10, 5)),
    ]
    s = press_episode_summary(rows, evs=[], incidents=[], today=TODAY)
    assert s.since == datetime(2026, 10, 5, tzinfo=UTC)


def test_single_source_closed_since_does_not_win_over_corroborated():
    # Gaviotas: "desde jun-2024" lo decía UN solo medio contra 6 que
    # afirmaban jun-2026 — el corroborado gana
    rows = [
        news(date(2026, 6, 3), source="uno", closed_since="2024-06"),
        news(date(2026, 6, 5), source="dos", closed_since="2026-06"),
        news(date(2026, 6, 5), source="tres", closed_since="2026-06"),
    ]
    evs = [press_ev(date(2026, 6, 3), items=rows)]
    s = press_episode_summary(rows, evs, incidents=[], today=TODAY)
    assert s.closed_since == "2026-06"


def test_episode_items_only_last_coverage_cluster():
    # El banner despliega el último episodio, no el saco de titulares
    old = [news(date(2026, 6, 1)), news(date(2026, 6, 2), source="otra")]
    new = [
        news(date(2026, 9, 20)),
        news(date(2026, 9, 22), source="otra"),
        news(date(2026, 9, 25), "reopening", source="otra"),
    ]
    s = press_episode_summary(old + new, evs=[], incidents=[], today=TODAY)
    assert s.episode_items == new


def test_official_incident_pulls_since_earlier():
    # El Socorro: Náyade abrió la incidencia el 18-sep aunque la
    # prensa llegó el 20 — la evidencia oficial más antigua manda
    rows = [news(date(2026, 9, 20)), news(date(2026, 9, 22), source="x")]
    incidents = [inc(date(2026, 9, 18))]
    s = press_episode_summary(rows, evs=[], incidents=incidents, today=TODAY)
    assert s.since == datetime(2026, 9, 18, tzinfo=UTC)


def test_retro_closure_between_reopenings_stays_in_episode():
    # Médano sep-2026 (el "bocadillo"): las reaperturas del 25 a
    # primera hora NO parten el episodio — la pieza de cierre de
    # estenerife de las 11:03 (mismo día, closed_since=23, un solo
    # medio) es retrospectiva del episodio resuelto. Cortar ahí
    # dejaba since=25-sep y solo 6 titulares; el episodio completo
    # arranca el 23 y el banner enseña cierre + reapertura
    rows = [
        news(
            date(2026, 9, 23), "closure", "a", closed_since="2026-09-23"
        ),
        news(date(2026, 9, 23), "closure", "b"),
        news(date(2026, 9, 24), "closure", "a"),
        news(date(2026, 9, 25), "reopening", "x", hour=7),
        news(
            date(2026, 9, 25),
            "closure",
            "estenerife",
            closed_since="2026-09-23",
            hour=11,
        ),
        news(date(2026, 9, 25), "reopening", "y", hour=14),
    ]
    s = press_episode_summary(rows, evs=[], incidents=[], today=TODAY)
    assert s.since == datetime(2026, 9, 23, tzinfo=UTC)
    assert len(s.episode_items) == 6
    # "desde el 23" lo afirman dos medios del episodio → corrobora
    # (el saco de afirmaciones son los cierres del episodio, no un
    # recorte por fecha de cobertura)
    assert s.closed_since == "2026-09-23"


def test_same_day_closure_corroborated_is_new_episode():
    # Jardín oct-2026: reabrió por la mañana y volvió a cerrar por la
    # tarde del MISMO día (4º cierre del año) — un closed_since igual
    # al día de la reapertura es ambiguo y lo decide la ola de medios
    # (>=2 fuentes). El episodio nuevo arranca en los titulares de la
    # tarde, no en el cierre de septiembre
    rows = [
        news(date(2026, 9, 30), "closure", "a"),
        news(date(2026, 10, 7), "reopening", "x", hour=7),
        news(
            date(2026, 10, 7),
            "closure",
            "a",
            closed_since="2026-10-07",
            hour=17,
        ),
        news(
            date(2026, 10, 7),
            "closure",
            "b",
            closed_since="2026-10-07",
            hour=18,
        ),
        news(date(2026, 10, 9), "reopening", "x"),
    ]
    s = press_episode_summary(rows, evs=[], incidents=[], today=TODAY)
    assert s.since == datetime(2026, 10, 7, 17, tzinfo=UTC)
    assert [r.event_type for r in s.episode_items] == [
        "closure",
        "closure",
        "reopening",
    ]


def test_sea_state_items_do_not_narrate_episodes():
    # El estado del mar no es calidad del agua: los cierres por
    # oleaje/temporal quedan fuera del episodio, la causa y los
    # titulares — solo narra el de vertido. Y la causa vota sobre el
    # episodio, no sobre el saco entero
    rows = [
        news(date(2026, 10, 5), "closure", cause="mal estado del mar"),
        news(date(2026, 10, 6), "closure", "a", cause="oleaje fuerte"),
        news(
            date(2026, 10, 7),
            "closure",
            "b",
            cause="vertido de aguas residuales",
        ),
    ]
    s = press_episode_summary(rows, evs=[], incidents=[], today=TODAY)
    assert s.dominant == "closure"
    assert len(s.episode_items) == 1
    # los 2 ítems de mar ganarían la votación si no se filtrasen
    assert s.cause == "vertido de aguas residuales"


def test_open_structural_episode_survives_coverage_gap():
    # Gaviotas: titular de jun y titular de sep son la MISMA obra —
    # el hueco >GAP no parte un episodio estructural abierto
    rows = [news(date(2026, 6, 3)), news(date(2026, 9, 15))]
    evs = [
        press_ev(
            date(2026, 6, 3),
            causes=["Desprendimientos"],
            items=rows,
            last_closure=date(2026, 9, 15),
        )
    ]
    s = press_episode_summary(rows, evs, incidents=[], today=TODAY)
    assert s.since == datetime(2026, 6, 3, tzinfo=UTC)

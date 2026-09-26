"""Tests de la síntesis de eventos reconstruidos (analítica + prensa).

Función pura sobre objetos en memoria — no toca BD.
"""

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

from app.events import (
    Episode,
    cluster_episodes,
    merged_episode,
    synthesize_events,
)

TODAY = date(2026, 9, 21)

APT = "Zona Apta para el baño"
BAD = "Zona donde queda prohibido el baño temporalmente"


def meas(day: date, evaluation: str):
    return SimpleNamespace(sampled_at=day, evaluation=evaluation)


def inc(opened: date, closed: date | None = None, obs: str | None = None):
    return SimpleNamespace(
        opened_at=opened, closed_at=closed, observations=obs
    )


def news(
    day: date,
    event_type: str,
    source: str = "eldia",
    cause: str | None = None,
    closed_since: str | None = None,
):
    return SimpleNamespace(
        published_at=datetime(
            day.year, day.month, day.day, tzinfo=timezone.utc
        ),
        event_type=event_type,
        relevant=True,
        source=source,
        cause=cause,
        closed_since=closed_since,
    )


def beach(measurements=(), incidents=(), items=()):
    return SimpleNamespace(
        measurements=list(measurements),
        incidents=list(incidents),
        news_items=list(items),
    )


def test_bad_run_without_incident_makes_measurement_event():
    b = beach(
        measurements=[
            meas(date(2025, 9, 1), APT),
            meas(date(2025, 9, 15), BAD),
            meas(date(2025, 9, 22), BAD),
            meas(date(2025, 10, 6), APT),
        ]
    )
    (ev,) = synthesize_events(b, today=TODAY)
    assert ev.via == "measurement"
    assert ev.kind == "closure"
    # La prohibición va de la primera mala a la primera apta posterior
    assert ev.opened_at == date(2025, 9, 15)
    assert ev.closed_at == date(2025, 10, 6)


def test_bad_run_covered_by_incident_is_skipped():
    b = beach(
        measurements=[meas(date(2025, 9, 15), BAD)],
        incidents=[inc(date(2025, 9, 10), date(2025, 10, 1))],
    )
    assert synthesize_events(b, today=TODAY) == []


def test_open_bad_run_stays_active():
    b = beach(measurements=[meas(date(2026, 9, 10), BAD)])
    (ev,) = synthesize_events(b, today=TODAY)
    assert ev.closed_at is None


def test_press_inside_window_confirms_measurement():
    b = beach(
        measurements=[
            meas(date(2025, 9, 15), BAD),
            meas(date(2025, 10, 6), APT),
        ],
        items=[news(date(2025, 9, 20), "closure")],
    )
    (ev,) = synthesize_events(b, today=TODAY)
    assert ev.via == "measurement"
    assert ev.press_confirmed and ev.press_count == 1


def test_reopening_news_confirms_window_and_never_stands_alone():
    b = beach(
        measurements=[
            meas(date(2025, 9, 15), BAD),
            meas(date(2025, 10, 6), APT),
        ],
        items=[news(date(2025, 10, 10), "reopening")],
    )
    (ev,) = synthesize_events(b, today=TODAY)
    assert ev.press_confirmed and ev.press_count == 1


def test_press_reopening_inside_window_is_the_real_end():
    """El Pris: reabierta por el Ayuntamiento el 13-abr pero Náyade no
    publicó apta hasta mayo — el cierre es la fecha de prensa."""
    b = beach(
        measurements=[
            meas(date(2025, 9, 15), BAD),
            meas(date(2026, 5, 25), APT),
        ],
        items=[news(date(2026, 4, 13), "reopening")],
    )
    (ev,) = synthesize_events(b, today=TODAY)
    assert ev.closed_at == date(2026, 4, 13)
    assert ev.end_from_press


def test_press_reopening_loses_to_later_bad_sample():
    """Una reapertura desmentida por una muestra mala posterior no
    fija el cierre — la ventana de analítica manda."""
    b = beach(
        measurements=[
            meas(date(2024, 8, 19), BAD),
            meas(date(2024, 9, 2), BAD),
            meas(date(2024, 9, 16), APT),
        ],
        items=[news(date(2024, 8, 23), "reopening")],
    )
    (ev,) = synthesize_events(b, today=TODAY)
    assert ev.closed_at == date(2024, 9, 16)
    assert not ev.end_from_press
    assert ev.press_reopening == date(2024, 8, 23)


def test_last_reopening_after_last_bad_sample_is_the_end():
    """La Pinta real: reabrieron el 23-ago (mala el 2-sep) y el 4-sep
    (tras la última mala) — el cierre es el 4-sep, no la apta del 16."""
    b = beach(
        measurements=[
            meas(date(2024, 8, 19), BAD),
            meas(date(2024, 9, 2), BAD),
            meas(date(2024, 9, 16), APT),
        ],
        items=[
            news(date(2024, 8, 23), "reopening"),
            news(date(2024, 9, 4), "reopening"),
        ],
    )
    (ev,) = synthesize_events(b, today=TODAY)
    assert ev.closed_at == date(2024, 9, 4)
    assert ev.end_from_press


def test_press_closure_alone_makes_press_event():
    b = beach(
        items=[
            news(date(2026, 8, 1), "closure"),
            news(date(2026, 8, 3), "closure", source="cope"),
            news(date(2026, 8, 20), "reopening"),
        ]
    )
    (ev,) = synthesize_events(b, today=TODAY)
    assert ev.via == "press"
    assert ev.opened_at == date(2026, 8, 1)
    # La reapertura cierra el evento con su fecha de publicación
    assert ev.closed_at == date(2026, 8, 20)
    assert ev.press_count == 3
    assert not ev.end_estimated


def test_stale_press_closure_gets_estimated_end():
    b = beach(items=[news(date(2025, 5, 1), "closure")])
    (ev,) = synthesize_events(b, today=TODAY)
    assert ev.via == "press"
    assert ev.closed_at == date(2025, 5, 1)
    assert ev.end_estimated


def test_fresh_press_closure_stays_active():
    b = beach(items=[news(TODAY - timedelta(days=5), "closure")])
    (ev,) = synthesize_events(b, today=TODAY)
    assert ev.closed_at is None


def test_press_overlapping_official_incident_is_skipped():
    b = beach(
        incidents=[inc(date(2026, 8, 1), date(2026, 8, 20))],
        items=[news(date(2026, 8, 5), "closure")],
    )
    assert synthesize_events(b, today=TODAY) == []


def test_ungraded_incident_neither_covers_nor_swallows_press():
    """Gaviotas real: 'Sin Calificar' es solo el registro de una
    muestra sin evaluar — no cubre ventanas de analítica ni absorbe
    las noticias de cierre, que forman su propio episodio de prensa."""
    b = beach(
        measurements=[
            meas(date(2026, 6, 10), BAD),
            meas(date(2026, 6, 19), APT),
        ],
        incidents=[inc(date(2026, 6, 8), obs="Sin Calificar")],
        items=[
            # Fuera de la ventana ±14d de la analítica: cierre propio
            news(
                date(2026, 5, 20),
                "closure",
                cause="riesgo de desprendimientos",
            )
        ],
    )
    evs = synthesize_events(b, today=date(2026, 9, 26))
    # La ventana de analítica sobrevive (no la cubre la nota admin) y
    # el cierre de prensa genera su evento estructural propio
    assert len(evs) == 2
    press = next(e for e in evs if e.via == "press")
    meas_ev = next(e for e in evs if e.via == "measurement")
    assert press.closed_at is None  # estructural: no caduca
    assert meas_ev.closed_at == date(2026, 6, 19)


def test_separate_press_clusters_make_separate_events():
    b = beach(
        items=[
            news(date(2025, 3, 1), "closure"),
            news(date(2025, 3, 10), "reopening"),
            news(date(2025, 8, 1), "closure"),
            news(date(2025, 8, 15), "reopening"),
        ]
    )
    evs = synthesize_events(b, today=TODAY)
    assert len(evs) == 2
    assert all(e.via == "press" for e in evs)
    # Más reciente primero
    assert evs[0].opened_at == date(2025, 8, 1)


def test_still_closed_press_merges_all_clusters():
    """Benijo: cierre largo con picos de cobertura y reaperturas
    espurias del LLM — si el último cambio es un cierre y la cobertura
    sigue fresca, todo es UN episodio abierto desde la fecha más
    antigua."""
    b = beach(
        items=[
            news(date(2026, 5, 21), "closure"),
            news(date(2026, 5, 24), "reopening"),  # "agilizan obras"
            news(date(2026, 7, 24), "closure"),
            news(date(2026, 7, 31), "reopening"),
            news(TODAY - timedelta(days=3), "closure"),  # fresco
        ]
    )
    (ev,) = synthesize_events(b, today=TODAY)
    assert ev.via == "press"
    assert ev.opened_at == date(2026, 5, 21)
    assert ev.closed_at is None
    assert ev.press_count == 5


def test_reopening_wave_closes_only_its_episode():
    """El Médano real: cierres de julio (caducaron sin cobertura) +
    cierres del 23-sep + 8 titulares de reapertura del 25-sep. La ola
    de reaperturas resuelve SOLO el episodio de septiembre; el de
    julio queda con fin estimado, no "cerrado el 25/09"."""
    b = beach(
        items=[
            news(date(2026, 7, 7), "closure"),
            news(date(2026, 7, 8), "closure", source="diario"),
            news(date(2026, 9, 23), "closure"),
            news(date(2026, 9, 23), "closure", source="cope"),
            # La ola: varios medios cuentan la misma reapertura
            news(date(2026, 9, 25), "reopening"),
            news(date(2026, 9, 25), "reopening", source="cope"),
            news(date(2026, 9, 25), "reopening", source="diario"),
        ]
    )
    evs = synthesize_events(b, today=date(2026, 9, 26))
    assert len(evs) == 2
    sept = next(e for e in evs if e.opened_at == date(2026, 9, 23))
    july = next(e for e in evs if e.opened_at == date(2026, 7, 7))
    assert sept.closed_at == date(2026, 9, 25)
    assert not sept.end_estimated
    # Julio nunca tuvo reapertura cubierta: fin aproximado en su
    # última mención, no en la reapertura de septiembre
    assert july.closed_at == date(2026, 7, 8)
    assert july.end_estimated


def test_lone_old_cluster_still_closed_by_late_reopening():
    """Benijo: UN solo clúster abierto muy viejo + reapertura lejana —
    la reapertura sí lo cierra (un cierre estructural puede durar
    años y nadie repite la noticia)."""
    b = beach(
        items=[
            news(date(2024, 6, 10), "closure"),
            news(date(2024, 6, 12), "closure", source="cope"),
            news(date(2026, 9, 1), "reopening"),
        ]
    )
    (ev,) = synthesize_events(b, today=TODAY)
    assert ev.closed_at == date(2026, 9, 1)
    assert not ev.end_estimated


def test_stale_structural_closure_never_estimates_end():
    """Benijo real: cierres de prensa por desprendimientos en mayo y
    julio, ya sin cobertura fresca. La causa estructural no caduca por
    silencio — el episodio sigue abierto igual que en /alerts."""
    b = beach(
        items=[
            news(
                date(2026, 5, 21),
                "closure",
                cause="riesgo de desprendimientos en el talud",
            ),
            news(
                date(2026, 7, 31),
                "closure",
                source="diario",
                cause="desprendimientos",
            ),
        ]
    )
    (ev,) = synthesize_events(b, today=date(2026, 9, 26))
    assert ev.closed_at is None
    assert not ev.end_estimated
    assert ev.opened_at == date(2026, 5, 21)


def test_minority_structural_cause_does_not_persist():
    """Candelaria real: 4 titulares dicen "vertido" y 1 habla de
    "obstrucción por materiales de obra" — la causa dominante decide
    (Contaminación), así que el episodio caduca con fin estimado y no
    se queda abierto para siempre por un titular minoritario."""
    b = beach(
        items=[
            news(date(2025, 11, 6), "closure", cause="vertido"),
            news(
                date(2025, 11, 6),
                "closure",
                source="canal4",
                cause="obstrucción por materiales de obra en la red",
            ),
            news(
                date(2025, 11, 6),
                "closure",
                source="c7",
                cause="vertido de origen desconocido",
            ),
            news(
                date(2025, 11, 7),
                "closure",
                source="ayto",
                cause="vertido de aguas residuales",
            ),
        ]
    )
    (ev,) = synthesize_events(b, today=date(2026, 9, 26))
    assert ev.closed_at == date(2025, 11, 7)
    assert ev.end_estimated


def test_dominant_structural_cause_still_persists():
    """La votación no rompe Benijo: si la mayoría dice desprendimientos
    el episodio sigue abierto aunque haya un titular de "vertido"."""
    b = beach(
        items=[
            news(
                date(2026, 5, 21),
                "closure",
                cause="riesgo de desprendimientos",
            ),
            news(
                date(2026, 7, 31),
                "closure",
                source="diario",
                cause="desprendimientos en la ladera",
            ),
            news(
                date(2026, 8, 2),
                "closure",
                source="c7",
                cause="vertido",
            ),
        ]
    )
    (ev,) = synthesize_events(b, today=date(2026, 9, 26))
    assert ev.closed_at is None
    assert not ev.end_estimated


def test_closed_since_backdates_episode_start():
    """La guía de Benijo afirma "cerrada desde julio de 2024" aunque
    la ficha se actualizó en 2026: el inicio real manda sobre la fecha
    de publicación."""
    b = beach(
        items=[
            news(
                date(2026, 7, 31),
                "closure",
                cause="peligro de desprendimientos",
                closed_since="2024",
            ),
            news(
                date(2026, 9, 17),
                "closure",
                source="guia",
                cause="riesgo de desprendimientos",
                closed_since="2024-07",
            ),
        ]
    )
    (ev,) = synthesize_events(b, today=TODAY)
    # A igual año gana la fecha más precisa: jul-2024, no ene-2024
    assert ev.opened_at == date(2024, 7, 1)
    assert ev.closed_since == "2024-07"
    assert ev.closed_at is None


def ep(beach_id, base, start, end=None, via="official", kind="closure"):
    return Episode(
        beach_id=beach_id,
        base=base,
        municipality="M",
        kind=kind,
        start=start,
        end=end,
        via=via,
        ref_id=beach_id,
        obs=None,
    )


def test_cluster_episodes_merges_pms_same_window():
    eps = [
        ep(1, "PLAYA JARDIN", date(2026, 1, 10), date(2026, 1, 20)),
        ep(2, "PLAYA JARDIN", date(2026, 1, 12), date(2026, 1, 22)),
        ep(1, "PLAYA JARDIN", date(2026, 5, 1), date(2026, 5, 10)),
        ep(3, "PLAYA OTRA", date(2026, 1, 11), date(2026, 1, 21)),
    ]
    groups = cluster_episodes(eps, today=TODAY)
    assert len(groups) == 3  # ene fusionado, mayo aparte, otra playa
    merged = merged_episode(groups[0])
    assert merged.start == date(2026, 1, 10)
    assert merged.end == date(2026, 1, 22)
    assert merged.via == "official"
    assert merged.beach_id == 1


def test_cluster_episodes_merges_mixed_via_same_window():
    """Los Cristianos: cierre oficial en PM2 + prensa en PM4, misma
    ventana → un episodio oficial con mención a prensa."""
    eps = [
        Episode(
            beach_id=1,
            base="LOS CRISTIANOS",
            municipality="M",
            kind="closure",
            start=date(2026, 8, 24),
            end=date(2026, 8, 26),
            via="official",
            ref_id=10,
            obs="Baño prohibido",
        ),
        Episode(
            beach_id=2,
            base="LOS CRISTIANOS",
            municipality="M",
            kind="closure",
            start=date(2026, 8, 21),
            end=date(2026, 8, 21),
            via="press",
            ref_id=-1,
            obs="Cierre recogido solo en prensa",
            press_count=2,
        ),
    ]
    groups = cluster_episodes(eps, today=TODAY)
    assert len(groups) == 1
    m = merged_episode(groups[0])
    assert m.via == "official"
    assert m.start == date(2026, 8, 21)  # el más antiguo gana
    assert "2 noticias en prensa" in (m.obs or "")

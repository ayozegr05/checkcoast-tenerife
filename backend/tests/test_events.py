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


def inc(opened: date, closed: date | None = None):
    return SimpleNamespace(opened_at=opened, closed_at=closed)


def news(day: date, event_type: str, source: str = "eldia"):
    return SimpleNamespace(
        published_at=datetime(
            day.year, day.month, day.day, tzinfo=timezone.utc
        ),
        event_type=event_type,
        relevant=True,
        source=source,
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

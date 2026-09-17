"""Tests de la lógica de dedup de la ingesta OSM."""

from scripts.ingest_osm_beaches import _is_covered, _normalize

OFFICIALS = [
    (28.1397, -16.4357, _normalize("PLAYA JARDIN PM1")),
    (28.5690, -16.2520, _normalize("PLAYA TERESITAS (LAS) PM1")),
]


def test_normalize_strips_pm_and_accents():
    assert _normalize("Playa Jardín PM4") == "PLAYA JARDIN"
    assert _normalize("  Playa  de   la Viuda ") == "PLAYA DE LA VIUDA"


def test_covered_by_same_name():
    # Mismo nombre aunque esté lejos del punto de muestreo
    assert _is_covered(28.0, -16.5, "Playa Jardín", OFFICIALS)


def test_covered_by_distance():
    # Nombre distinto pero a ~50 m de un PM oficial
    assert _is_covered(28.5695, -16.2525, "Charco de Teresitas", OFFICIALS)


def test_not_covered_remote_beach():
    assert not _is_covered(28.0, -16.8, "Playa Remota", OFFICIALS)

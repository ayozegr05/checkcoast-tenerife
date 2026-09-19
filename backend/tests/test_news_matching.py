"""Tests del matching conservador artículo↔playa (Hito 8.5)."""

from types import SimpleNamespace

from app.news_llm import EventExtraction
from app.news_matching import match_beaches

BEACHES = [
    SimpleNamespace(
        id=1, name="PLAYA JARDIN PM1", municipality="Puerto de la Cruz"
    ),
    SimpleNamespace(
        id=3, name="BAJAMAR PM1", municipality="San Cristóbal de La Laguna"
    ),
    # Mismo nombre en dos municipios distintos (caso real: La Arena)
    SimpleNamespace(
        id=4, name="PLAYA DE LA ARENA PM1", municipality="Santiago del Teide"
    ),
    SimpleNamespace(
        id=5, name="PLAYA DE LA ARENA (MESA DEL MAR)", municipality="Tacoronte"
    ),
    # Dos "El Cabezo" reales en el censo MITECO (nombre invertido "(El)"),
    # y el de Güímar con dos puntos de muestreo (PM1, PM4)
    SimpleNamespace(
        id=6, name="PLAYA CABEZO (EL) PM1", municipality="Granadilla de Abona"
    ),
    SimpleNamespace(
        id=7,
        name="PLAYA CABEZO (EL)-PASEO DE LAS PALMERAS PM1",
        municipality="Güímar",
    ),
    SimpleNamespace(
        id=8,
        name="PLAYA CABEZO (EL)-PASEO DE LAS PALMERAS PM4",
        municipality="Güímar",
    ),
]


def ext(beach_name, municipality=None, **kw):
    return EventExtraction(
        relevant=True,
        confidence=0.9,
        beach_name=beach_name,
        municipality=municipality,
        event_type="closure",
        **kw,
    )


def ids(ext_obj, beaches=BEACHES):
    return sorted(b.id for b in match_beaches(ext_obj, beaches))


def test_exact_name_match_without_municipality():
    assert ids(ext("Playa Jardín")) == [1]


def test_containment_requires_municipality():
    # "Playa del Cabezo" contiene "CABEZO": sin municipio hay dos
    # municipios candidatos → no casa
    assert ids(ext("Playa del Cabezo")) == []
    assert ids(ext("Playa del Cabezo", "Güímar")) == [7, 8]


def test_multi_pm_same_beach_returns_all():
    # Misma playa con dos PMs: la noticia se sirve en ambas fichas
    assert ids(ext("El Cabezo", "Güímar")) == [7, 8]


def test_municipality_alias_la_laguna():
    assert ids(ext("Bajamar", "La Laguna")) == [3]


def test_contradictory_municipality_rejects():
    # La única Playa Jardín está en Puerto de la Cruz, no en Adeje
    assert ids(ext("Playa Jardín", "Adeje")) == []


def test_ambiguous_name_needs_municipality():
    # Dos playas llamadas "Playa de la Arena": sin municipio no casa
    assert ids(ext("Playa de la Arena")) == []
    assert ids(ext("Playa de la Arena", "Tacoronte")) == [5]


def test_inverted_mitec_name_matches():
    # "El Cabezo" en prensa ↔ "PLAYA CABEZO (EL) PM1" en el censo;
    # hay dos El Cabezo en municipios distintos → ambiguo sin municipio
    assert ids(ext("El Cabezo")) == []
    assert ids(ext("El Cabezo", "Granadilla de Abona")) == [6]


def test_no_beach_name_returns_none():
    assert ids(ext(None)) == []


def test_unknown_beach_returns_none():
    assert ids(ext("Playa de Benidorm", "Alicante")) == []


def test_short_generic_name_never_matches():
    assert ids(ext("Playa", "Adeje")) == []

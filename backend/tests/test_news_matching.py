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
    # El Médano: playa base + dos sub-playas del mismo municipio
    # (caso real: la prensa dice "la playa de El Médano" y el cierre
    # municipal cubre la principal)
    SimpleNamespace(
        id=30, name="PLAYA MEDANO (EL) PM3",
        municipality="Granadilla de Abona",
    ),
    SimpleNamespace(
        id=31, name="PLAYA MEDANO (EL)-CHICA PM1",
        municipality="Granadilla de Abona",
    ),
    SimpleNamespace(
        id=32, name="PLAYA MEDANO (EL)-LEOCADIO MACHADO PM1",
        municipality="Granadilla de Abona",
    ),
    SimpleNamespace(
        id=40, name="PLAYA SOCORRO (EL) PM1",
        municipality="Los Realejos",
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


def ids(ext_obj, beaches=BEACHES, title=""):
    return sorted(
        b.id for b in match_beaches(ext_obj, beaches, title=title)
    )


def test_exact_name_match_without_municipality():
    assert ids(ext("Playa Jardín")) == [1]


def test_containment_requires_municipality():
    # "Playa del Cabezo" contiene "CABEZO": sin municipio hay dos
    # municipios candidatos → no casa
    assert ids(ext("Playa del Cabezo")) == []
    # con municipio extraído hay que verlo en el titular: el LLM a
    # veces lo deduce mal
    assert ids(ext("Playa del Cabezo", "Güímar")) == []
    assert ids(
        ext("Playa del Cabezo", "Güímar"),
        title="Güímar reabre la playa de El Cabezo",
    ) == [7, 8]


def test_llm_wrong_municipality_rejected():
    # Regresión real: "Cierre de Playa del Cabezo y Paseo de las
    # Palmeras por aguas residuales" (Güímar) fue adjudicada a
    # Granadilla por deducción del LLM — el titular no lo nombra
    assert ids(
        ext("Playa del Cabezo", "Granadilla de Abona"),
        title="Cierre de Playa del Cabezo y Paseo de las Palmeras "
              "por aguas residuales",
    ) == []


def test_multi_pm_same_beach_returns_all():
    # Misma playa con dos PMs: la noticia se sirve en ambas fichas
    assert ids(
        ext("El Cabezo", "Güímar"),
        title="Güímar reabre la playa de El Cabezo",
    ) == [7, 8]


def test_municipality_alias_la_laguna():
    assert ids(ext("Bajamar", "La Laguna")) == [3]


def test_contradictory_municipality_rejects():
    # La única Playa Jardín está en Puerto de la Cruz, no en Adeje
    assert ids(ext("Playa Jardín", "Adeje")) == []


def test_ambiguous_name_needs_municipality():
    # Dos playas llamadas "Playa de la Arena": sin municipio no casa
    assert ids(ext("Playa de la Arena")) == []
    assert ids(
        ext("Playa de la Arena", "Tacoronte"),
        title="Cierre de La Arena en Tacoronte",
    ) == [5]


def test_inverted_mitec_name_matches():
    # "El Cabezo" en prensa ↔ "PLAYA CABEZO (EL) PM1" en el censo;
    # hay dos El Cabezo en municipios distintos → ambiguo sin municipio
    assert ids(ext("El Cabezo")) == []
    assert ids(
        ext("El Cabezo", "Granadilla de Abona"),
        title="Granadilla cierra la playa de El Cabezo, en El Médano",
    ) == [6]


def test_exact_key_beats_same_municipality_siblings():
    # "El Médano" casa con la playa base aunque existan sub-playas
    # con prefijo en el mismo municipio (sin él, 3 claves → ambiguo)
    assert ids(ext("El Médano")) == [30]
    assert ids(ext("El Médano", "Granadilla")) == [30]
    # La sub-playa nombrada explícita casa sola (julio: "Leocadio
    # Machado" en los titulares)
    assert ids(ext("Leocadio Machado", "Granadilla de Abona")) == [32]


def test_exact_key_loses_to_cross_municipality_ambiguity():
    # "El Cabezo" tiene match exacto en Granadilla pero la hermana
    # contenida está en Güímar → sigue ambiguo sin municipio
    assert ids(ext("El Cabezo")) == []


def test_multi_beach_headline_matches_each():
    # "El Médano y El Socorro cierran": el LLM extrae un solo nombre
    # conjunto; cada playa casa porque su clave sale literal en el
    # titular
    assert ids(
        ext("El Médano y El Socorro"),
        title="El Médano y El Socorro cierran temporalmente al baño",
    ) == [30, 40]
    # Sin el nombre literal en el titular no hay match
    assert ids(ext("El Médano y El Socorro"), title="") == []


def test_no_beach_name_returns_none():
    assert ids(ext(None)) == []


def test_unknown_beach_returns_none():
    assert ids(ext("Playa de Benidorm", "Alicante")) == []


def test_short_generic_name_never_matches():
    assert ids(ext("Playa", "Adeje")) == []


def test_ambiguous_name_flags_body_fetch():
    """Caso real El Médano jul-2026: el titular dice "una playa de El
    Médano" y casa PM3 por clave exacta, pero el cuerpo nombra Leocadio
    Machado — el nombre extraído es prefijo de una playa hermana, así
    que se considera ambiguo y se pide el cuerpo para desambiguar."""
    from scripts.ingest_news import _name_is_ambiguous

    e = ext("El Médano")
    hits = match_beaches(e, BEACHES)
    assert _name_is_ambiguous(e, hits, BEACHES) is True
    # "Leocadio Machado" con municipio ya casa la sub-playa exacta →
    # ninguna hermana queda por aclarar, no es ambiguo
    e2 = ext("Playa Leocadio Machado", "Granadilla de Abona")
    hits2 = match_beaches(e2, BEACHES)
    assert [b.id for b in hits2] == [32]
    assert _name_is_ambiguous(e2, hits2, BEACHES) is False

"""Segunda vía de extracción de infraestructura de vertido (Hito 11.2)."""

import json
from unittest.mock import patch

from app.news_infra import (
    INFRA_EVENT_TYPE,
    INFRA_RE,
    PROMPT_INFRA,
    extract_infra_event,
    infra_outfall_for_text,
    norm_txt,
    outfall_keys,
    outfall_named_patterns,
)
from app.news_llm import GeminiExtractor
from app.news_sources import _MUNI_BEACHY_RE, RawArticle


class _FakeOutfall:
    """ORM duck-typed: solo los campos que lee outfall_keys."""

    def __init__(
        self,
        id: int,
        name: str,
        municipality: str | None = None,
        location: str | None = None,
        origin: str | None = None,
    ):
        self.id = id
        self.name = name
        self.municipality = municipality
        self.location = location
        self.origin = origin


ARTICLE = RawArticle(
    title="Las obras en el emisario de Puerto de la Cruz se retrasan "
    "hasta 2027",
    url="https://news.google.com/rss/articles/xyz",
    source="Eldía",
    published_at=None,
)

EXTRACTION = {
    "relevant": True,
    "beach_name": "Punta Brava",
    "municipality": "Puerto de la Cruz",
    "event_type": "closure",  # el modelo se equivoca: extract_infra lo pisa
    "cause": "retraso en la reparación del emisario",
    "confidence": 0.9,
}


def _fake_resp(payload: dict, status: int = 200):
    class R:
        ok = status == 200
        status_code = status

        def json(self):
            return {
                "candidates": [
                    {"content": {"parts": [{"text": json.dumps(payload)}]}}
                ]
            }

    return R()


def test_infra_re_matches_infra_vocab():
    for title in (
        "Rotura del emisario de Punta Brava",
        "La depuradora de Valle Guerra vierte al mar",
        "El aliviadero de Bajamar rebosa con cada tormenta",
        "Avería en el bombeo de aguas residuales de Granadilla",
        "Obstrucción de una tubería causa un vertido en El Médano",
        "El colector se desbordó por las lluvias",
        "Denuncian un vertido ilegal en la costa de Radazul",
        "Fisura en la red de saneamiento del puerto",
        "La EDAR de Punta Larga supera su capacidad",
    ):
        assert INFRA_RE.search(title), title


def test_infra_re_ignores_beach_closures_and_lookalikes():
    for title in (
        # cierre de playa sin vocabulario de infra: es ruido para la
        # ficha del emisario, ya cubierto por la ficha de playa
        "Cierran Playa Jardín por contaminación fecal",
        "Detectan bacterias fecales en el agua de baño",
        "Obras en el paseo marítimo de Los Cristianos",
        # "quedará"/"cedará" contienen "edar" pero sin límites de
        # palabra no deben casar
        "El paseo quedará cerrado durante las obras",
    ):
        assert not INFRA_RE.search(title), title


def test_extract_infra_event_forces_infra_type():
    with patch(
        "app.news_llm.requests.post", return_value=_fake_resp(EXTRACTION)
    ) as post:
        ext = extract_infra_event(ARTICLE, GeminiExtractor("key", "model"))
    assert ext is not None
    assert ext.relevant is True
    assert ext.event_type == INFRA_EVENT_TYPE
    assert ext.beach_name == "Punta Brava"
    # el prompt que salió a la API es el de infra, no el de playas
    text = post.call_args.kwargs["json"]["contents"][0]["parts"][0]["text"]
    assert text.startswith(PROMPT_INFRA)


def test_extract_infra_event_non_relevant():
    with patch(
        "app.news_llm.requests.post",
        return_value=_fake_resp({"relevant": False, "confidence": 0.8}),
    ):
        ext = extract_infra_event(ARTICLE, GeminiExtractor("key", "model"))
    assert ext is not None and ext.relevant is False


def test_extract_infra_event_http_error_returns_none():
    with patch(
        "app.news_llm.requests.post",
        return_value=_fake_resp({}, status=400),
    ):
        assert (
            extract_infra_event(ARTICLE, GeminiExtractor("key", "model"))
            is None
        )


def test_muni_prefilter_accepts_infra_titles():
    for title in (
        "Avería en el bombeo de aguas residuales",
        "Obstrucción del colector de Valle Guerra",
        "El aliviadero de Bajamar rebosa",
    ):
        assert _MUNI_BEACHY_RE.search(title), title


# --- Atribución por topónimo (qué es "de este punto") ---


def test_outfall_keys_extract_toponyms():
    o = _FakeOutfall(
        62,
        "Emisario Submarino de Punta Brava - EDAR Valle de La Orotava",
        municipality="Puerto de la Cruz",
        location="Punta Brava",
        origin="EDAR Comarcal del Valle de la Orotava",
    )
    keys = outfall_keys(o)
    assert "punta brava" in keys
    assert "valle de la orotava" in keys
    # el municipio nunca es clave de atribución
    assert "puerto de la cruz" not in keys


def test_outfall_keys_ignore_census_jargon():
    o = _FakeOutfall(
        129,
        "Aliviadero EBAR Playa Jardín",
        municipality="Puerto de la Cruz",
        location="Playa Jardín",
        origin="EBAR Playa Jardín",
    )
    assert "playa jardin" in outfall_keys(o)


def test_named_patterns_attribute_unique_toponym():
    brava = _FakeOutfall(
        62,
        "Emisario Submarino de Punta Brava",
        municipality="Puerto de la Cruz",
        location="Punta Brava",
    )
    jardin = _FakeOutfall(
        129,
        "Aliviadero EBAR Playa Jardín",
        municipality="Puerto de la Cruz",
        location="Playa Jardín",
        origin="EBAR Playa Jardín",
    )
    text = norm_txt(
        "Las aguas fecales en la zona del emisario de Punta Brava "
        "multiplican por 48 los valores legales"
    )
    # en la ficha del emisario: named
    own, other = outfall_named_patterns(62, [brava, jardin])
    assert any(p.search(text) for p in own)
    assert not any(p.search(text) for p in other)
    # en la ficha del aliviadero vecino: nombra otro punto → oculta
    own, other = outfall_named_patterns(129, [brava, jardin])
    assert not any(p.search(text) for p in own)
    assert any(p.search(text) for p in other)


def test_beach_named_toponym_needs_facility_word():
    """'Playa Jardín cierra por vertido' nombra la PLAYA, no el
    aliviadero homónimo: sin palabra de instalación no hay named."""
    jardin = _FakeOutfall(
        129,
        "Aliviadero EBAR Playa Jardín",
        municipality="Puerto de la Cruz",
        location="Playa Jardín",
        origin="EBAR Playa Jardín",
    )
    own, _ = outfall_named_patterns(129, [jardin])
    assert not any(
        p.search(norm_txt("Cierran Playa Jardín por un vertido")) for p in own
    )
    assert any(
        p.search(norm_txt("Rotura del aliviadero de Playa Jardín"))
        for p in own
    )


def test_shared_toponym_never_attributes():
    """'Bajamar' lo comparten varios puntos del censo: la noticia no
    distingue y no se atribuye a ninguno (mejor zona que inventar)."""
    a = _FakeOutfall(1, "Aliviadero EBAR Norte", location="Bajamar")
    b = _FakeOutfall(2, "Emisario de emergencia", location="Bajamar")
    text = norm_txt("El aliviadero de Bajamar vierte al mar")
    own, other = outfall_named_patterns(1, [a, b])
    assert not any(p.search(text) for p in own)
    assert not any(p.search(text) for p in other)


# --- Escáner de cuerpo: qué punto nombra el texto (A) ---


def _cluster():
    return [
        _FakeOutfall(
            62,
            "Emisario Submarino de Punta Brava",
            municipality="Puerto de la Cruz",
            location="Punta Brava",
        ),
        _FakeOutfall(
            129,
            "Aliviadero EBAR Playa Jardín",
            municipality="Puerto de la Cruz",
            location="Playa Jardín",
            origin="EBAR Playa Jardín",
        ),
        _FakeOutfall(
            130,
            "Aliviadero EBAR San Telmo",
            municipality="Puerto de la Cruz",
            location="San Telmo",
        ),
    ]


def test_infra_outfall_for_text_body_names_point():
    """El caso del hito: titular de playa, cuerpo que cuenta qué
    instalación se rompió → atribuye ese punto, no los vecinos."""
    body = (
        "Cierran Playa Jardín por contaminación fecal. Fuentes "
        "municipales señalan una fisura en el emisario submarino de "
        "Punta Brava, que vierte aguas residuales sin tratar."
    )
    assert infra_outfall_for_text(body, _cluster()) == 62


def test_infra_outfall_for_text_none_when_generic():
    text = "La red de saneamiento de la costa colapsa con las lluvias"
    assert infra_outfall_for_text(text, _cluster()) is None


def test_infra_outfall_for_text_none_when_ambiguous():
    """Dos puntos distintos nombrados → ambiguo → sin atribución."""
    text = (
        "La fisura del emisario de Punta Brava coincide con un reboso "
        "del aliviadero de San Telmo"
    )
    assert infra_outfall_for_text(text, _cluster()) is None


def test_infra_outfall_for_text_toponym_alone_is_not_attribution():
    """'Playa Jardín' a secas nombra la playa, no el aliviadero:
    sin palabra de instalación no hay atribución."""
    text = "Cierran Playa Jardín hasta nuevo aviso"
    assert infra_outfall_for_text(text, _cluster()) is None

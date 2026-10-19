"""Segunda vía de extracción de infraestructura de vertido (Hito 11.2)."""

import json
from unittest.mock import patch

from app.news_infra import (
    INFRA_EVENT_TYPE,
    INFRA_RE,
    PROMPT_INFRA,
    extract_infra_event,
)
from app.news_llm import GeminiExtractor
from app.news_sources import _MUNI_BEACHY_RE, RawArticle

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

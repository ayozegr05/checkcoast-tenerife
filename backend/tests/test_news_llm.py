"""Tests del extractor LLM con la API mockeada (Hito 8.5)."""

import json
from unittest.mock import patch

from app.news_llm import GeminiExtractor, extract_event
from app.news_sources import RawArticle

ARTICLE = RawArticle(
    title="El Ayuntamiento de Güímar prohíbe el baño en la playa de El "
    "Cabezo por vertidos de aguas residuales",
    url="https://news.google.com/rss/articles/xyz",
    source="Eldía",
    published_at=None,
)

EXTRACTION = {
    "relevant": True,
    "beach_name": "playa de El Cabezo",
    "municipality": "Güímar",
    "event_type": "closure",
    "cause": "vertidos de aguas residuales",
    "confidence": 0.98,
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


def test_extract_parses_schema_json():
    with patch(
        "app.news_llm.requests.post", return_value=_fake_resp(EXTRACTION)
    ) as post:
        ext = extract_event(ARTICLE, GeminiExtractor("key", "model"))
    assert ext is not None
    assert ext.relevant is True
    assert ext.beach_name == "playa de El Cabezo"
    assert ext.municipality == "Güímar"
    assert ext.event_type == "closure"
    assert ext.cause == "vertidos de aguas residuales"
    # JSON forzado por esquema + thinking off
    cfg = post.call_args.kwargs["json"]["generationConfig"]
    assert cfg["responseMimeType"] == "application/json"
    assert cfg["thinkingConfig"]["thinkingBudget"] == 0


def test_extract_non_relevant():
    with patch(
        "app.news_llm.requests.post",
        return_value=_fake_resp({"relevant": False, "confidence": 0.9}),
    ):
        ext = extract_event(ARTICLE, GeminiExtractor("key", "model"))
    assert ext is not None and ext.relevant is False
    assert ext.beach_name is None


def test_extract_http_error_returns_none():
    with patch(
        "app.news_llm.requests.post", return_value=_fake_resp({}, status=400)
    ):
        assert extract_event(ARTICLE, GeminiExtractor("key", "model")) is None


def test_extract_malformed_json_returns_none():
    class BadJson:
        ok = True
        status_code = 200

        def json(self):
            return {"candidates": [{"content": {"parts": [{"text": "@@"}]}}]}

    with patch("app.news_llm.requests.post", return_value=BadJson()):
        assert extract_event(ARTICLE, GeminiExtractor("key", "model")) is None

"""Tests del extractor LLM con la API mockeada (Hito 8.5)."""

import json
from unittest.mock import patch

import pytest
import requests

from app.news_llm import (
    EventExtraction,
    GeminiExtractor,
    extract_event,
    literal_evidence,
    supported_event,
)
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
    "evidence_quote": ARTICLE.title,
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
    assert ext.evidence_quote == ARTICLE.title
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


@pytest.mark.parametrize(
    "failure",
    [
        requests.ReadTimeout(),
        _fake_resp({}, status=503),
        _fake_resp({}, status=429),
    ],
)
def test_transient_failure_uses_fallback(failure):
    ex = GeminiExtractor("secret-key", "primary", "fallback-lite")
    failures = (
        [failure]
        if getattr(failure, "status_code", None) == 429
        else [failure, failure]
    )
    with (
        patch("app.news_llm.time.sleep"),
        patch(
            "app.news_llm.requests.post",
            side_effect=[*failures, _fake_resp(EXTRACTION)],
        ) as post,
    ):
        assert ex.extract(ARTICLE).event_type == "closure"
    assert "fallback-lite" in post.call_args.args[0]
    assert "secret-key" not in post.call_args.args[0]
    assert ex.last_error is None


def test_failed_provider_is_visible_without_secret(caplog):
    ex = GeminiExtractor("secret-key", "primary", "fallback-lite")
    with patch("app.news_llm.requests.post", return_value=_fake_resp({}, 429)):
        assert ex.extract(ARTICLE) is None
    assert ex.failures == 1
    assert ex.last_error == "HTTP 429"
    assert "HTTP 429" in caplog.text
    assert "secret-key" not in caplog.text


def test_quote_must_be_literal_and_seen_by_model():
    assert literal_evidence(ARTICLE.title.replace(" ", "\n"), ARTICLE)
    assert (
        literal_evidence("El alcalde ha cerrado todas las playas", ARTICLE)
        is None
    )
    assert literal_evidence("cerrada", ARTICLE) is None
    assert literal_evidence(None, ARTICLE) is None
    art = RawArticle(
        title="Incidente",
        url="https://test/",
        source="test",
        published_at=None,
        body="x" * 6000 + " La playa permanece cerrada.",
    )
    assert literal_evidence("La playa permanece cerrada.", art) is None


def test_missing_quote_retains_context_without_state_vote():
    ext = EventExtraction(
        relevant=True,
        confidence=0.95,
        event_type="closure",
        scope="whole",
        closed_since="2026-10",
        cause="desprendimiento",
    )
    result = supported_event(ext)
    assert result.relevant
    assert result.event_type == "other"
    assert result.scope is None and result.closed_since is None
    assert ext.event_type == "closure"  # conserva la propuesta original


def test_body_rejecting_title_closure_does_not_keep_false_closure(monkeypatch):
    from app.ingest_news import _enrich_with_body

    ext = EventExtraction(
        relevant=True,
        confidence=0.9,
        event_type="closure",
        cause="desprendimiento",
        scope="whole",
        evidence_quote=ARTICLE.title,
    )
    monkeypatch.setattr(
        "app.ingest_news.resolve_and_fetch", lambda _: "No hubo cierre."
    )
    monkeypatch.setattr(
        "app.ingest_news.extract_event",
        lambda *a: EventExtraction(relevant=False, confidence=0.9),
    )
    monkeypatch.setattr("app.ingest_news.time.sleep", lambda _: None)
    result, _, used, verified, _ = _enrich_with_body(
        ARTICLE, ext, [object()], [], object()
    )
    assert used and not verified
    assert result.relevant and result.event_type == "other"


def test_literal_quote_alone_is_not_evidence_of_closure():
    ext = EventExtraction(
        relevant=True,
        confidence=0.95,
        event_type="closure",
        scope="whole",
        evidence_quote="La playa de Benijo encara ahora el camino de regreso.",
    )
    assert supported_event(ext).event_type == "other"

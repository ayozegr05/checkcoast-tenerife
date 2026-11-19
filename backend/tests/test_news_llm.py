"""Tests del extractor LLM con la API mockeada (Hito 8.5)."""

import json
from unittest.mock import patch

import pytest
import requests

from app.news_llm import (
    EventExtraction,
    GeminiExtractor,
    canonicalize_cause,
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
        lambda *a, **k: EventExtraction(relevant=False, confidence=0.9),
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


def test_title_supports_closure_when_quote_lacks_the_verb():
    ext = EventExtraction(
        relevant=True,
        confidence=0.95,
        event_type="closure",
        scope="whole",
        evidence_quote="Se tomaron muestras del agua esta mañana.",
    )
    assert (
        supported_event(
            ext, "Precintan la Playa de Los Guanches tras un vertido"
        ).event_type
        == "closure"
    )
    assert (
        supported_event(
            ext, "Un desprendimiento sin consecuencias en San Marcos"
        ).event_type
        == "other"
    )


def test_title_supports_reopening_variants():
    ext = EventExtraction(
        relevant=True,
        confidence=0.9,
        event_type="reopening",
        evidence_quote="Los resultados analíticos fueron favorables.",
    )
    assert (
        supported_event(
            ext, "Retirada la bandera roja en Valleseco"
        ).event_type
        == "reopening"
    )
    assert (
        supported_event(ext, "Abierta al baño el litoral").event_type
        == "reopening"
    )
    # "reapertura" (sustantivo) y "vuelve a abrir" también prueban —
    # AtlánticoHoy usaba esas dos formas y la reapertura se degradaba.
    assert (
        supported_event(
            ext, "Playa Jardín vuelve a abrir al baño tras otro episodio"
        ).event_type
        == "reopening"
    )
    assert (
        supported_event(
            ext,
            "La playa sigue cerrada",
            "el ayuntamiento anunció la reapertura al baño de la playa",
        ).event_type
        == "reopening"
    )
    # …pero estudiar o poder reaperturar sigue sin pruebas
    assert (
        supported_event(
            ext, "Salud Pública estudia la reapertura de la playa"
        ).event_type
        == "other"
    )
    assert supported_event(ext, "Balance del verano").event_type == "other"


def test_modal_or_future_marker_does_not_ground():
    closure = EventExtraction(
        relevant=True,
        confidence=0.9,
        event_type="closure",
        evidence_quote="Se estudia la situación.",
    )
    assert (
        supported_event(
            closure, "El Ayuntamiento estudia cerrar la playa"
        ).event_type
        == "other"
    )
    assert (
        supported_event(
            closure, "La playa podría cerrar por el temporal"
        ).event_type
        == "other"
    )
    assert (
        supported_event(
            EventExtraction(
                relevant=True,
                confidence=0.9,
                event_type="reopening",
            ),
            "La playa de Benijo reabrirá tras dos años cerrada",
        ).event_type
        == "other"
    )


def test_reverse_direction_marker_does_not_ground_closure():
    ext = EventExtraction(
        relevant=True,
        confidence=0.9,
        event_type="closure",
        evidence_quote="El incidente quedó resuelto.",
    )
    assert (
        supported_event(
            ext, "Retirada la bandera roja en Valleseco"
        ).event_type
        == "other"
    )
    assert (
        supported_event(
            ext, "Izan bandera roja en el litoral de Valleseco"
        ).event_type
        == "closure"
    )


def test_body_sentence_with_beach_reference_grounds_closure():
    ext = EventExtraction(
        relevant=True,
        confidence=0.9,
        event_type="closure",
        scope="whole",
        beach_name="Playa de Los Guanches",
        evidence_quote="Se tomaron muestras esta mañana.",
    )
    body = (
        "El vertido quedó detenido. "
        "La Playa de Los Guanches permanece cerrada por precaución. "
        "Las analíticas llegarán el lunes."
    )
    assert (
        supported_event(ext, "Vertido detenido en Candelaria", body).event_type
        == "closure"
    )


def test_body_closure_of_other_thing_does_not_ground():
    ext = EventExtraction(
        relevant=True,
        confidence=0.9,
        event_type="closure",
        scope="whole",
        beach_name="Playa de San Marcos",
        evidence_quote="Un desprendimiento sorprende a los vecinos.",
    )
    body = (
        "El derrumbe ocurrió junto a una pequeña avenida "
        "que ya se cerró al paso en el verano de 2023. "
        "No hubo heridos."
    )
    assert (
        supported_event(
            ext, "Un desprendimiento en la playa de San Marcos", body
        ).event_type
        == "other"
    )


def _beach(name, municipality="Garachico"):
    from app.models import Beach

    b = Beach()
    b.id = 1
    b.name = name
    b.municipality = municipality
    return b


def test_candidates_block_lists_census_points():
    """El prompt nombra los puntos del censo candidatos para que el
    modelo sepa que la piscina natural ES el punto monitorizado."""
    cands = [
        _beach("PISCINAS NATURALES DE BAJAMAR PM1", "La Laguna"),
        _beach("PLAYA DE BENIJO", "Taganana"),
    ]
    with patch(
        "app.news_llm.requests.post", return_value=_fake_resp(EXTRACTION)
    ) as post:
        extract_event(
            ARTICLE, GeminiExtractor("key", "model"), candidates=cands
        )
    text = post.call_args.kwargs["json"]["contents"][0]["parts"][0]["text"]
    assert "PISCINAS NATURALES DE BAJAMAR PM1" in text
    assert "PLAYA DE BENIJO" in text
    assert "La Laguna" in text
    assert "el punto ES la instalaci" in text  # flag piscina natural


def test_no_candidates_keeps_prompt_unchanged():
    with patch(
        "app.news_llm.requests.post", return_value=_fake_resp(EXTRACTION)
    ) as post:
        extract_event(ARTICLE, GeminiExtractor("key", "model"))
    text = post.call_args.kwargs["json"]["contents"][0]["parts"][0]["text"]
    assert "censo" not in text


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (None, None),
        ("", ""),
        ("vertido de aguas residuales", "vertido de aguas residuales"),
        # El parámetro, una sola grafía
        ("E. Coli", "E. coli"),
        ("E.Coli", "E. coli"),
        ("E-coli", "E. coli"),
        ("E.  coli", "E. coli"),
        ("Escherichia coli", "E. coli"),
        ("Escherichia coli (E. coli)", "E. coli"),
        ("Enterococos (enterococos)", "enterococos"),
        # Envoltura vacía colapsa solo si el organismo es todo lo que hay
        ("niveles de E. coli", "E. coli"),
        ("exceso de enterococos", "enterococos"),
        ("presencia de Escherichia coli", "E. coli"),
        ("índices de E-coli superiores", "índices de E. coli superiores"),
        ("enterococos", "enterococos"),
        ("enterococo", "enterococos"),
        ("Enterococos intestinales", "enterococos"),
        ("enterococcus faecalis", "enterococos faecalis"),
        ("bacterias fecales: enterococos", "bacterias fecales: enterococos"),
        # Unidades: el número se conserva, el formato se fija
        ("enterococos 210 ufc/100 ml", "enterococos 210 UFC/100 mL"),
        ("E. coli >800 UFC/100 mL", "E. coli >800 UFC/100 mL"),
        ("410 UFC/100 ml", "410 UFC/100 mL"),
        ("enterococos 310", "enterococos 310"),
        # Lista de organismos: se reordena y las etiquetas vacías caen
        ("Enterococos y E. coli", "E. coli y enterococos"),
        ("bacterias fecales, Enterococos y E. coli", "E. coli y enterococos"),
        ("bacterias Enterococos y E. coli", "E. coli y enterococos"),
        ("enterococos y escherichia coli", "E. coli y enterococos"),
        ("bacterias fecales (E. coli)", "E. coli"),
        # …pero solo si TODO son organismos o etiquetas
        (
            "E. coli en Troya I y enterococos en El Puertito",
            "E. coli en Troya I y enterococos en El Puertito",
        ),
        (
            "E. coli y vertido de aguas residuales",
            "E. coli y vertido de aguas residuales",
        ),
        ("bacterias", "bacterias"),
    ],
)
def test_canonicalize_cause(raw, expected):
    assert canonicalize_cause(raw) == expected


def test_canonicalize_cause_does_not_eat_other_words():
    # "the coli" no es "E. coli" — la frontera de palabra importa
    assert canonicalize_cause("the coli outbreak") == "the coli outbreak"

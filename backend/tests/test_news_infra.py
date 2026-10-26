"""Segunda vía de extracción de infraestructura de vertido (Hito 11.2)."""

import json
from unittest.mock import patch

from app.news_infra import (
    INFRA_EVENT_TYPE,
    INFRA_RE,
    PROMPT_INFRA,
    extract_infra_event,
    infra_outfall_for_text,
    news_by_year_family,
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


def test_civic_building_never_attributes():
    """'Ayuntamiento'/'aparcamiento' son edificios, no topónimos:
    "la depuradora del Ayuntamiento" habla del consistorio y no
    puede colgar del punto del censo (caso real: las noticias de
    El Médano se enlazaban al Aliviadero de Candelaria)."""
    o = _FakeOutfall(
        1, "Aliviadero EBAR Ayuntamiento - Aparcamiento"
    )
    assert "ayuntamiento" not in outfall_keys(o)
    assert "aparcamiento" not in outfall_keys(o)
    text = norm_txt("La depuradora del ayuntamiento vierte al mar")
    assert infra_outfall_for_text(text, [o]) is None


def test_prefix_toponym_never_attributes():
    """'Puertito' (El Puertito de Tabaiba) es prefijo de 'Puertito
    de Radazul': aunque solo lo tenga un punto, la prensa que dice
    "el emisario del Puertito" no distingue entre los Puertitos de
    la isla → sin atribución."""
    a = _FakeOutfall(
        1, "Conducción de desagüe de Tabaiba", location="El Puertito"
    )
    b = _FakeOutfall(2, "Aliviadero EBAR", location="Puertito de Radazul")
    text = norm_txt(
        "Cierran dos playas por problemas en el emisario del Puertito"
    )
    assert infra_outfall_for_text(text, [a, b]) is None


class _FakeNews:
    """ORM duck-typed para el agrupador: los campos que lee
    named_by_family/_infra_family."""

    def __init__(
        self,
        title: str,
        published_at=None,
        infra_cause: str | None = None,
        cause: str | None = None,
        event_type: str | None = None,
    ):
        self.title = title
        self.published_at = published_at
        self.infra_cause = infra_cause
        self.cause = cause
        self.event_type = event_type


def _dt(y: int, m: int = 1):
    from datetime import datetime

    return datetime(y, m, 15)


def test_news_by_year_family_groups_year_then_semantic_family():
    """Un solo bloque por año con TODAS las familias dentro; las
    réplicas de un mismo suceso se apilan bajo la misma familia."""
    named = [
        (
            _FakeNews(
                "Cierran la playa por contaminación",
                _dt(2026, 10),
                infra_cause="fisura en la conducción",
            ),
            None,
        ),
        (
            _FakeNews(
                "Licitado el arreglo de urgencia",
                _dt(2026, 5),
                infra_cause="reparación del emisario",
            ),
            None,
        ),
        (
            _FakeNews(
                "Rotura detectada en la tubería",
                _dt(2025, 8),
                infra_cause="rotura del emisario",
            ),
            None,
        ),
        (
            _FakeNews(
                "Otra fisura en el mismo tramo",
                _dt(2025, 2),
                infra_cause="fisura en el emisario",
            ),
            None,
        ),
    ]
    groups = news_by_year_family(named)
    # 2026 primero, 2025 después — un bloque por año; rotura y
    # reparación son UNA familia (lo que no se rompe no se repara)
    assert [g["year"] for g in groups] == [2026, 2025]
    assert [f["family"] for f in groups[0]["families"]] == [
        "Roturas y reparaciones",
    ]
    # las dos roturas de 2025 comparten familia pero son hechos
    # distintos: ítems planos ordenados por firma — el más reciente
    # de cada bloque primero
    rot25 = groups[1]["families"][0]
    assert rot25["family"] == "Roturas y reparaciones"
    assert rot25["count"] == 2
    assert len(rot25["items"]) == 2
    assert rot25["items"][0][0].infra_cause == "rotura del emisario"


def test_news_by_year_family_orders_same_fact_together():
    """El mismo hecho contado por varios medios queda contiguo: la
    firma semántica ordena las filas — las réplicas se leen como
    corroboración, no intercaladas con otros sucesos."""
    named = [
        (
            _FakeNews(
                "Rotura detectada en la tubería",
                _dt(2026, 9),
                infra_cause="rotura del emisario",
            ),
            None,
        ),
        (
            _FakeNews(
                "Fisura en la conducción",
                _dt(2026, 7),
                infra_cause="fisura del emisario",
            ),
            None,
        ),
        (
            _FakeNews(
                "Otra noticia de la rotura",
                _dt(2026, 5),
                infra_cause="rotura del emisario",
            ),
            None,
        ),
    ]
    groups = news_by_year_family(named)
    fam = groups[0]["families"][0]
    assert fam["count"] == 3
    # las dos roturas contiguas aunque la fisura se publicó en
    # medio: cada bloque de firma se ordena por su noticia más
    # reciente
    assert [n.infra_cause for n, _ in fam["items"]] == [
        "rotura del emisario",
        "rotura del emisario",
        "fisura del emisario",
    ]


def test_news_by_year_family_signature_groups_paraphrases():
    """La firma ignora la prosa: "vertido de aguas residuales",
    "contaminación por vertidos…" y "problemas de saneamiento" son
    la misma firma → se ordenan como un solo bloque contiguo."""
    named = [
        (
            _FakeNews(
                "Fisura en la conducción",
                _dt(2026, 8),
                infra_cause="fisura del emisario",
            ),
            None,
        ),
        (
            _FakeNews(
                "Cierre por contaminación",
                _dt(2026, 10),
                infra_cause="contaminación por vertidos de aguas residuales",
            ),
            None,
        ),
        (
            _FakeNews(
                "Cerrada por vertidos",
                _dt(2026, 5),
                infra_cause="vertido de aguas residuales",
            ),
            None,
        ),
        (
            _FakeNews(
                "El saneamiento sigue sin solución",
                _dt(2026, 3),
                infra_cause="problemas de saneamiento y vertidos",
            ),
            None,
        ),
    ]
    groups = news_by_year_family(named)
    # la fisura cae en Roturas; los tres vertidos-paráfrasis en Vertidos
    assert [f["family"] for f in groups[0]["families"]] == [
        "Roturas y reparaciones",
        "Vertidos",
    ]
    fam = groups[0]["families"][1]
    assert fam["count"] == 3
    # un solo bloque de firma: los tres quedan contiguos por recencia
    assert [n.published_at.month for n, _ in fam["items"]] == [10, 5, 3]


def test_news_by_year_family_denuncia_beats_vertido():
    """'Denuncia por vertidos' es una noticia de denuncia: el
    titular también cuenta — "La Fiscalía denuncia…" gana aunque el
    hecho extraído solo diga "vertido" (cajón final)."""
    groups = news_by_year_family(
        [
            (
                _FakeNews(
                    "La Fiscalía denuncia a seis cargos públicos",
                    _dt(2025),
                    infra_cause="vertido de aguas fecales",
                ),
                None,
            )
        ]
    )
    assert groups[0]["families"][0]["family"] == "Denuncias e investigaciones"


def test_news_by_year_family_ignores_playa_cause():
    """Un ítem dual (closure de playa) sin infra_cause: la causa de
    playa no decide la familia — cae el titular."""
    groups = news_by_year_family(
        [
            (
                _FakeNews(
                    "Cierran la playa por una tubería reventada",
                    _dt(2026),
                    cause="contaminación fecal",
                    event_type="closure",
                ),
                None,
            )
        ]
    )
    assert groups[0]["families"][0]["family"] == "Roturas y reparaciones"


def test_news_by_year_family_fallback_other_and_sin_fecha():
    groups = news_by_year_family(
        [
            (
                _FakeNews("La depuradora estará lista en 2030", None),
                None,
            )
        ]
    )
    assert groups[0]["year"] is None
    assert groups[0]["families"][0]["family"] == "Otros sucesos"

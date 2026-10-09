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
        id=30,
        name="PLAYA MEDANO (EL) PM3",
        municipality="Granadilla de Abona",
    ),
    SimpleNamespace(
        id=31,
        name="PLAYA MEDANO (EL)-CHICA PM1",
        municipality="Granadilla de Abona",
    ),
    SimpleNamespace(
        id=32,
        name="PLAYA MEDANO (EL)-LEOCADIO MACHADO PM1",
        municipality="Granadilla de Abona",
    ),
    SimpleNamespace(
        id=40,
        name="PLAYA SOCORRO (EL) PM1",
        municipality="Los Realejos",
    ),
    # Playa Jardín PM4/PM5 con aliases de prensa (caso real: "Playa
    # Grande" = PM4 y "El Charcón" = PM5 son puntos de muestreo del
    # complejo Jardín); y una "Playa Grande" real en OTRO municipio
    # para mantener la ambigüedad homónima
    SimpleNamespace(
        id=41,
        name="PLAYA JARDIN PM4",
        municipality="Puerto de la Cruz",
        press_aliases=["Playa Grande"],
    ),
    SimpleNamespace(
        id=42,
        name="PLAYA JARDIN PM5",
        municipality="Puerto de la Cruz",
        press_aliases=["Charcón"],
    ),
    SimpleNamespace(
        id=85,
        name="Playa Grande",
        municipality="Arico",
    ),
    # "El Charcón" real en otro municipio (homónimo del PM5 de Jardín)
    SimpleNamespace(
        id=86,
        name="PLAYA CHARCON (EL) PM1",
        municipality="La Guancha",
    ),
    # Playa de Masca (no monitorizada): el barranco homónimo es un
    # sendero, no la playa — y una playa que SÍ lleva "Barranco" en el
    # nombre para no vetar de más
    SimpleNamespace(
        id=90, name="Playa de Masca", municipality="Buenavista del Norte"
    ),
    SimpleNamespace(
        id=91,
        name="Playa del Barranco de Erques",
        municipality="Guía de Isora",
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
    return sorted(b.id for b in match_beaches(ext_obj, beaches, title=title))


def test_exact_name_match_without_municipality():
    # Jardín tiene 3 PMs en el mismo municipio: todos casan
    assert ids(ext("Playa Jardín")) == [1, 41, 42]


def test_containment_requires_municipality():
    # "Playa del Cabezo" contiene "CABEZO": sin municipio hay dos
    # municipios candidatos → no casa
    assert ids(ext("Playa del Cabezo")) == []
    # con municipio extraído desambigua aunque el titular no lo
    # nombre: solo se duda si el titular aporta contra-evidencia
    assert ids(ext("Playa del Cabezo", "Güímar")) == [7, 8]
    assert ids(
        ext("Playa del Cabezo", "Güímar"),
        title="Güímar reabre la playa de El Cabezo",
    ) == [7, 8]


def test_llm_wrong_municipality_rejected():
    # Regresión real: "Cierre de Playa del Cabezo y Paseo de las
    # Palmeras por aguas residuales" (Güímar) fue adjudicada a
    # Granadilla por deducción del LLM — el titular no lo nombra
    assert (
        ids(
            ext("Playa del Cabezo", "Granadilla de Abona"),
            title="Cierre de Playa del Cabezo y Paseo de las Palmeras "
            "por aguas residuales",
        )
        == []
    )


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
    # La extracción nombra las dos playas: casan aunque el titular
    # sea genérico (caso real: "Se cierran dos playas en Tenerife")
    assert ids(
        ext("El Socorro y El Médano"),
        title="Se cierran dos playas en Tenerife por contaminación fecal",
    ) == [30, 40]
    # Una parte ambigua entre municipios se descarta, la otra casa
    assert ids(
        ext("El Cabezo y El Médano"),
        title="Se cierran dos playas en Tenerife",
    ) == [30]


def test_title_scan_rescues_second_beach():
    # Caso real sep-2026: el LLM extrajo solo "El Médano" pero el
    # titular nombra también "El Socorro" — el escaneo de titular
    # contra todas las claves recupera la segunda playa
    assert ids(
        ext("El Médano", "Granadilla de Abona"),
        title="El Médano y El Socorro cierran temporalmente al baño",
    ) == [30, 40]


def test_alias_same_base_complex_matches_all_pms():
    # "Playa Grande y Charcón" en Puerto de la Cruz: dos alias
    # distintos del mismo complejo Jardín (PM4 y PM5) → casa ambos
    assert ids(
        ext("Playa Grande y Charcón", "Puerto de la Cruz"),
        title="Puerto de la Cruz vuelve a cerrar dos de sus playas "
        "por contaminación",
    ) == [41, 42]
    # Sin municipio la "Playa Grande" de Arico mantiene la
    # ambigüedad homónima → no casa
    assert ids(ext("Playa Grande y Charcón")) == []


def test_title_scan_rescues_real_name_inside_title():
    # "Playa Grande en Playa Jardín": el nombre popular no casa pero
    # el titular lleva el nombre real literal
    assert ids(
        ext("Playa Grande", "Puerto de la Cruz"),
        title="Cierre temporal al baño de Playa Grande en Playa "
        "Jardín, en Puerto de la Cruz",
    ) == [1, 41, 42]


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


def test_non_beach_geo_feature_never_matches():
    """Caso real oct-2024: "Cierran el Barranco de Masca por un
    desprendimiento de rocas" habla del sendero — casó con Playa de
    Masca por contención "MASCA" ⊂ "BARRANCO DE MASCA" y la caja de
    prensa mostró la playa cerrada años. El veto de accidente
    geográfico impide ambas vías (extracción y rescate por titular)."""
    title = "Cierran el Barranco de Masca por un desprendimiento"
    assert ids(ext("Barranco de Masca"), title=title) == []
    # ni siquiera la vía de rescate por nombre literal en el titular
    assert ids(ext(None), title=title) == []
    # el mismo sendero con municipio tampoco cuela
    assert (
        ids(ext("Barranco de Masca", "Buenavista del Norte"), title=title)
        == []
    )
    # pero una playa cuyo nombre real lleva "Barranco" sigue casando
    assert ids(
        ext("Barranco de Erques", "Guía de Isora"),
        title="Cierran la playa del Barranco de Erques",
    ) == [91]
    # y la playa de Masca nombrada como tal también
    assert ids(ext("Playa de Masca"), title="Cerrada la playa de Masca") == [
        90
    ]
    # el rescate por titular no cuela playas homónimas de OTRO
    # municipio: "El Barranco de Masca" (Buenavista) no es "Playa El
    # Barranco" de San Miguel de Abona
    beaches = [
        SimpleNamespace(
            id=154,
            name="Playa El Barranco",
            municipality="San Miguel de Abona",
        ),
        SimpleNamespace(
            id=90, name="Playa de Masca", municipality="Buenavista del Norte"
        ),
    ]
    assert (
        ids(
            ext("Barranco de Masca", "Buenavista del Norte"),
            beaches=beaches,
            title=title,
        )
        == []
    )


def test_rescue_does_not_use_municipality_name():
    """Regresión oct-2026: las noticias de 'playas de Candelaria' se
    pegaban a PLAYA CANDELARIA solo porque el titular menciona el
    pueblo — 'Los Guanches' y 'Olegario' son playas distintas."""
    beaches = [
        SimpleNamespace(
            id=23, name="PLAYA CANDELARIA PM4", municipality="Candelaria"
        )
    ]
    assert (
        ids(
            ext("Los Guanches", "Candelaria"),
            beaches=beaches,
            title="Cierra al baño la playa de Los Guanches en Candelaria",
        )
        == []
    )
    assert (
        ids(
            ext(None, "Candelaria"),
            beaches=beaches,
            title="Prohibido el baño en dos playas de Candelaria",
        )
        == []
    )
    # pero una extracción que sí nombra la playa sigue casando por
    # la vía normal
    assert ids(
        ext("Playa de Candelaria", "Candelaria"),
        beaches=beaches,
        title="Cierra la playa de Candelaria por vertido",
    ) == [23]


def test_press_key_keeps_initial_d():
    """Regresión oct-2026: "PLAYA DUQUE" perdia la D ("D\\s*" del
    prefijo genérico) → clave "EL UQUE" y "Playa del Duque" no casaba
    nunca. Igual "PLAYA DIEGO HERNANDEZ" → "IEGO…"."""
    beaches = [
        SimpleNamespace(
            id=5, name="PLAYA DUQUE (EL) PM3", municipality="Adeje"
        ),
        SimpleNamespace(
            id=6, name="PLAYA DUQUE (EL) PM4", municipality="Adeje"
        ),
        SimpleNamespace(
            id=114,
            name="Playa Diego Hernandez",
            municipality="Adeje",
        ),
    ]
    assert ids(
        ext("Playa del Duque", "Adeje"),
        beaches=beaches,
        title="Reabre Playa del Duque tras confirmarse que la calidad "
        "del agua es óptima",
    ) == [5, 6]
    assert ids(
        ext("Playa Diego Hernández", "Adeje"),
        beaches=beaches,
        title="Cierran la playa Diego Hernández por vertido",
    ) == [114]


def test_municipality_named_in_title_is_not_the_beach():
    """Caso real dic-2024: "El mar derrumba una casa en la playa La
    Viuda, en el municipio tinerfeño de Candelaria" casó con PLAYA
    CANDELARIA por el rescate de nombres literales del titular — la
    clave "CANDELARIA" aparece en el titular pero nombra el municipio."""
    beaches = [
        SimpleNamespace(
            id=23,
            name="PLAYA CANDELARIA PM4",
            municipality="Candelaria",
        ),
        SimpleNamespace(
            id=87,
            name="Playa de la Viuda (playa chica)",
            municipality="Candelaria",
        ),
    ]
    title = (
        "El mar derrumba una casa en la playa La Viuda, en el "
        "municipio tinerfeño de Candelaria"
    )
    # la extracción nombra La Viuda y el rescate por titular también
    # debe ignorar el "Candelaria" que solo es el municipio
    assert ids(
        ext("La Viuda", "Candelaria"), beaches=beaches, title=title
    ) == [87]
    # sin nombre extraído, el rescate literal no debe casar Candelaria
    assert ids(ext(None), beaches=beaches, title=title) == [87]


def test_flag_color_is_not_a_beach_name():
    """Caso real 2024: "…en Los Charcos, Valleseco (Santa Cruz), con
    bandera amarilla" casó también con Playa Amarilla (San Miguel de
    Abona) porque "AMARILLA" aparece literal tras "bandera"."""
    beaches = [
        SimpleNamespace(
            id=95, name="Playa Amarilla", municipality="San Miguel de Abona"
        ),
        SimpleNamespace(
            id=59,
            name="PLAYA VALLESECO PM1",
            municipality="Santa Cruz de Tenerife",
            press_aliases=["Los Charcos"],
        ),
    ]
    title = (
        "Reabierta el área de baño en Los Charcos, Valleseco (Santa "
        "Cruz), con bandera amarilla"
    )
    assert ids(ext("Los Charcos"), beaches=beaches, title=title) == [59]


def test_inner_preposition_variants():
    """La prensa añade/quita la preposición interior: "Punta del
    Hidalgo" debe casar con "… PISCINA NATURAL PUNTA HIDALGO", y el
    paréntesis no-artículo de OSM "(playa chica)" no debe impedir el
    match con el nombre popular."""
    beaches = [
        SimpleNamespace(
            id=48,
            name="PLAYA ARENISCO (EL) - PISCINA NATURAL PUNTA HIDALGO PM3",
            municipality="San Cristóbal de La Laguna",
        ),
        SimpleNamespace(
            id=51,
            name="PLAYA PISCINAS NATURALES DE BAJAMAR PM1",
            municipality="San Cristóbal de La Laguna",
        ),
        SimpleNamespace(
            id=52,
            name="PLAYA PISCINAS NATURALES DE BAJAMAR PM2",
            municipality="San Cristóbal de La Laguna",
        ),
        SimpleNamespace(
            id=87,
            name="Playa de la Viuda (playa chica)",
            municipality="Candelaria",
        ),
    ]
    assert ids(
        ext("Punta del Hidalgo", "La Laguna"),
        beaches=beaches,
        title="Cierran la piscina natural de Punta del Hidalgo",
    ) == [48]
    assert ids(
        ext("La Viuda", "Candelaria"),
        beaches=beaches,
        title="El mar derrumba una casa en la playa La Viuda",
    ) == [87]
    # La extracción solo devuelve "Bajamar" pero el titular enumera
    # las dos: la segunda playa debe sumarse aunque conserve el "del"
    assert ids(
        ext("Bajamar", "La Laguna"),
        beaches=beaches,
        title="El fuerte oleaje obliga a cerrar las piscinas naturales "
        "de Bajamar y Punta del Hidalgo",
    ) == [48, 51, 52]


def test_municipio_inventado_se_ignora():
    """El LLM extrae municipios que no existen ("Tenerife", un barrio)
    o se equivoca: si ningún candidato vive ahí se ignora y se resuelve
    por nombre/titular en vez de vetar el match."""
    # Regresión real: "Prohíben el baño en El Médano (Tenerife)"
    assert ids(ext("El Médano", "Tenerife")) == [30]
    # Municipio REAL pero erróneo sigue vetando (test existente:
    # puede ser un lugar homónimo que no es la playa)
    assert ids(ext("Playa del Cabezo", "Adeje")) == []
    # Inventado en playa ambigua: queda ambigua, no fuerza match
    assert ids(ext("El Cabezo", "Valleseco")) == []


def test_playa_del_prefix_matches_inverted_article():
    """Regresión auditoría: "playa del Bollullo" (prensa, sin artículo)
    no casaba con "PLAYA BOLLULLO (EL) PM1" — la clave contenida con
    artículo invertido moría en la puerta de exactitud."""
    beaches = [
        SimpleNamespace(
            id=40,
            name="PLAYA BOLLULLO (EL) PM1",
            municipality="La Orotava",
        )
    ]
    assert ids(
        ext("Playa del Bollullo"),
        beaches=beaches,
        title="Cierra la playa del Bollullo por contaminación",
    ) == [40]


def test_hyphen_tail_is_a_key():
    """Las calas censadas como "COMPLEJO- CALA" aportan la cola como
    clave propia: "El Bloque" casa "PLAYA VALLESECO- EL BLOQUE PM1"."""
    beaches = [
        SimpleNamespace(
            id=58,
            name="PLAYA VALLESECO- EL BLOQUE PM1",
            municipality="Santa Cruz de Tenerife",
        ),
        SimpleNamespace(
            id=59,
            name="PLAYA VALLESECO PM1",
            municipality="Santa Cruz de Tenerife",
        ),
    ]
    assert ids(
        ext("El Bloque"),
        beaches=beaches,
        title="Prohibido el baño en la zona de El Bloque, en Valleseco",
    ) == [58]


def test_numeral_list_expands():
    """Regresión auditoría: "Troya I y II" se troceaba en ["TROYA I",
    "II"] y la parte corta invalidaba el split entero — la pieza se
    quedaba con solo PM de Troya I o perdida."""
    beaches = BEACHES + [
        SimpleNamespace(
            id=12,
            name="PLAYA DE TROYA I PM1",
            municipality="Adeje",
        ),
        SimpleNamespace(
            id=13,
            name="PLAYA DE TROYA II PM1",
            municipality="Adeje",
        ),
    ]
    assert ids(
        ext("Troya I y II"),
        beaches=beaches,
        title="Cierran al baño las playas de Troya I y II en Adeje",
    ) == [12, 13]
    # la lista clásica de nombres completos sigue igual
    assert ids(
        ext("El Médano y El Socorro"),
        beaches=beaches,
        title="El Médano y El Socorro cierran temporalmente al baño",
    ) == [30, 40]


def test_municipio_disambigua_sin_confirmacion_en_titular():
    """Regresión auditoría: piezas de "El Cabezo" de Güímar con
    muni=Güímar extraído (por el cuerpo) se perdían porque el titular
    no nombraba Güímar. Ahora el municipio extraído desambigua salvo
    que el titular nombre otro municipio o una playa hermana."""
    # sin mención municipal ni de la hermana → confía en la extracción
    assert ids(
        ext("El Cabezo", "Güímar"),
        title="Cierran la playa de El Cabezo por aguas residuales",
    ) == [7, 8]
    # titular que nombra otro municipio de la isla → contradicción
    assert (
        ids(
            ext("El Cabezo", "Güímar"),
            title="Granadilla cierra la playa de El Cabezo",
        )
        == []
    )
    # titular que nombra la hermana de otro municipio → contra-evidencia
    assert (
        ids(
            ext("El Cabezo", "Granadilla de Abona"),
            title="Cierran El Cabezo y Paseo de las Palmeras",
        )
        == []
    )


def test_zone_alias_matches_complex_when_name_misses():
    """Regresión auditoría: extracción "Punta Brava" (nombre de cala
    del complejo Jardín, no del censo) no casaba nada — los alias de
    zona solo acotaban un complejo ya casado. Ahora un alias de zona
    que no colisiona con playas reales casa su PM."""
    # Punta Brava solo nombra la cala de PM4
    assert ids(
        ext("Punta Brava", "Puerto de la Cruz"),
        title="Cierran Punta Brava al baño por vertido",
    ) == [41]
    # María Jiménez (alias fuerte de PM4) igual
    assert ids(
        ext("Playa María Jiménez", "Puerto de la Cruz"),
        title="Cierre de María Jiménez",
    ) == [41]
    # pero "Playa Grande" extraído sigue yendo a la playa real de
    # Arico, no al alias de PM4 — el alias de zona no roba matches
    assert ids(ext("Playa Grande", "Arico")) == [85]


def test_multi_beach_toponym_prefers_context_municipality():
    """Regresión auditoría: "Almáciga y el Roque" casó también con
    Playa del Roque (Fasnia) cuando el Roque real es el de las
    Bodegas, en el mismo contexto Anaga/Santa Cruz que Almáciga.
    Claves que se contienen nombran el mismo topónimo y el contexto
    municipal del titular decide."""
    beaches = [
        SimpleNamespace(
            id=175,
            name="PLAYA ALMACIGA PM1",
            municipality="Santa Cruz de Tenerife",
        ),
        SimpleNamespace(
            id=172,
            name="ROQUE DE LAS BODEGAS",
            municipality="Santa Cruz de Tenerife",
            press_aliases=["El Roque"],
        ),
        SimpleNamespace(
            id=137,
            name="PLAYA DEL ROQUE",
            municipality="Fasnia",
        ),
    ]
    title = "Prohibido el baño en Almáciga y el Roque por contaminación"
    # extracción conjunta y solo del Roque: ambas resuelven por
    # contexto hacia las Bodegas (Santa Cruz), no Fasnia
    assert ids(ext("Almáciga y el Roque"), beaches=beaches, title=title) == [
        172,
        175,
    ]
    assert ids(ext("El Roque"), beaches=beaches, title=title) == [172]

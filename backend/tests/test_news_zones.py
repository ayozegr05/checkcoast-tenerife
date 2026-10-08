"""Tests del narrowing por cala/zona en complejos multi-PM.

Playa Jardín (Puerto de la Cruz): PM1=El Castillo/San Felipe (este),
PM5=El Charcón/Playa Chica (centro), PM4=Punta Brava/María Jiménez/
Playa Grande (oeste). Los bandos nombran calas, no PMs.
"""

from types import SimpleNamespace

from app.news_zones import narrow_hits_by_zone, zone_display_name

JARDIN = [
    SimpleNamespace(
        id=41, name="PLAYA JARDIN PM1", municipality="Puerto de la Cruz"
    ),
    SimpleNamespace(
        id=42, name="PLAYA JARDIN PM4", municipality="Puerto de la Cruz"
    ),
    SimpleNamespace(
        id=43, name="PLAYA JARDIN PM5", municipality="Puerto de la Cruz"
    ),
]

GUIMAR = [
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


def test_extracted_beach_names_a_zone():
    """extracted_beach="Playa Grande" → solo PM4, sin necesitar cuerpo."""
    hits = narrow_hits_by_zone(
        JARDIN, "Playa Grande", "Cierre en Playa Jardín"
    )
    assert [b.id for b in hits] == [42]


def test_title_names_two_zones():
    """ "restricciones en Playa Grande y Charcón" → PM4 + PM5."""
    hits = narrow_hits_by_zone(
        JARDIN,
        "Playa Jardín",
        "Levantadas las restricciones en Playa Grande y Charcón",
    )
    assert {b.id for b in hits} == {42, 43}


def test_zone_alias_in_body():
    """El titular es genérico pero el cuerpo cita el bando:
    "Charcón derecha" → solo PM5."""
    body = (
        "El bando municipal prohíbe el baño en la zona de Charcón "
        "derecha del complejo turístico de Playa Jardín."
    )
    hits = narrow_hits_by_zone(
        JARDIN, "Playa Jardín", "Cierran Playa Jardín", body=body
    )
    assert [b.id for b in hits] == [43]


def test_body_ignores_contextual_aliases():
    """ "Punta Brava" en el cuerpo suele ser el barrio/emisario, no la
    cala — alias débil: no cuenta en cuerpo, sí en titular."""
    body = (
        "El emisario de Punta Brava, gestionado por la EDAR de Valle "
        "de La Orotava, sigue vertiendo junto al complejo."
    )
    hits = narrow_hits_by_zone(
        JARDIN, "Playa Jardín", "Cerrada Playa Jardín", body=body
    )
    assert {b.id for b in hits} == {41, 42, 43}  # sin zona → todas
    # En el titular sí es la cala
    hits = narrow_hits_by_zone(
        JARDIN, "Punta Brava", "Cierre de la zona de baño de Punta Brava"
    )
    assert [b.id for b in hits] == [42]


def test_no_zone_mentioned_keeps_all_pms():
    """Sin cala nombrada: fallback conservador a todo el complejo."""
    hits = narrow_hits_by_zone(
        JARDIN, "Playa Jardín", "Cierre de Playa Jardín por contaminación"
    )
    assert {b.id for b in hits} == {41, 42, 43}


def test_aliases_of_siblings():
    """Los alias alternativos también casan: María Jiménez y Punta
    Brava son PM4; San Felipe y El Castillo son PM1."""
    assert [b.id for b in narrow_hits_by_zone(JARDIN, "María Jiménez")] == [42]
    assert [b.id for b in narrow_hits_by_zone(JARDIN, "Punta Brava")] == [42]
    assert [
        b.id for b in narrow_hits_by_zone(JARDIN, None, "playa de San Felipe")
    ] == [41]


def test_unmapped_multi_pm_group_untouched():
    """Un complejo multi-PM sin mapa de zonas no se altera."""
    hits = narrow_hits_by_zone(GUIMAR, "El Cabezo", "Cierre de El Cabezo")
    assert {b.id for b in hits} == {7, 8}


def test_single_hit_untouched():
    hits = narrow_hits_by_zone(JARDIN[:1], "Playa Grande")
    assert [b.id for b in hits] == [41]


def test_zone_display_name():
    assert zone_display_name(JARDIN[0]) == "El Castillo"
    assert zone_display_name(JARDIN[1]) == "Punta Brava"
    assert zone_display_name(JARDIN[2]) == "El Charcón"
    assert zone_display_name(GUIMAR[0]) is None

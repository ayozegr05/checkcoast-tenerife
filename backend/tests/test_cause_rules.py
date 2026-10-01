"""Reglas de normalización de causa (alertas con causa, 10.5).

El caso Benijo marcó la regla: titulares de prensa que describen el
mecanismo del cierre ("acceso prohibido") o la gestión posterior no son
una causa y no deben votar en la moda — la razón de fondo sí.
"""

from types import SimpleNamespace

from app.queries import _majority_cause, _press_cause, _short_cause


def _it(event_type: str, cause: str | None):
    return SimpleNamespace(event_type=event_type, cause=cause)


def test_mechanism_is_not_a_cause():
    assert _short_cause("acceso prohibido") is None
    assert _short_cause("cierre de acceso") is None
    assert _short_cause("seguridad y control de acceso") is None
    assert _short_cause("vallado preventivo") is None


def test_reasons_still_map():
    assert (
        _short_cause("vertido de aguas residuales")
        == "Contaminación fecal"
    )
    assert _short_cause("riesgo de desprendimientos") == "Desprendimientos"
    # mecanismo + razón en la misma frase: gana la razón
    assert _short_cause("vallado por desprendimientos") == "Desprendimientos"
    assert _short_cause("obras en la playa") == "Obras"


def test_socavacion_maps_to_ground_collapse():
    """Punta Larga: el mar horadó la base del paseo (caverna bajo la
    avenida) — socavación, no desprendimiento ni temporal."""
    assert (
        _short_cause("socavación del terreno bajo el paseo")
        == "Colapso del terreno"
    )
    assert (
        _short_cause("caverna bajo la avenida por el oleaje")
        == "Colapso del terreno"
    )
    assert (
        _short_cause("erosión de la base del talud") == "Colapso del terreno"
    )


def test_unknown_text_is_none():
    assert _short_cause(None) is None
    assert _short_cause("") is None
    assert _short_cause("la playa más querida del norte") is None


def test_sea_state_is_not_a_cause():
    # "Temporal", "oleaje", "mar agitado"... describen el
    # desencadenante, no la razón del cierre → no computan como causa
    assert _short_cause("temporal y mar de fondo") is None
    assert _short_cause("cerrada por temporal") is None
    assert _short_cause("el temporal dañó el acceso") is None
    assert _short_cause(
        "Zona donde queda prohibido el baño temporalmente"
    ) is None
    # pero un temporal que revela la causa sí la transmite
    assert (
        _short_cause("cierre temporal por vertido") == "Contaminación"
    )
    # y la jerarquía: la causa nombrada gana a la genérica
    assert (
        _short_cause("mala calidad del agua") == "Contaminación"
    )


def test_specific_cause_beats_generic_majority():
    """El Médano sep-2026: muchos titulares dicen solo "mala calidad
    del agua" pero unos pocos nombran enterococos — el parámetro
    nombrado es la etiqueta, no la mayoría genérica."""
    items = [
        _it("closure", "mala calidad del agua"),
        _it("closure", "mala calidad del agua"),
        _it("closure", "mala calidad del agua"),
        _it("closure", "exceso de enterococos"),
        _it("closure", "contaminación microbiológica"),
    ]
    assert _press_cause(items) == "Enterococos"


def test_majority_breaks_ties_within_same_level():
    items = [
        _it("closure", "vertido de gasoil"),
        _it("closure", "vertido de gasoil"),
        _it("closure", "mala calidad del agua"),
    ]
    assert _press_cause(items) == "Hidrocarburos"


def test_both_fecal_params_compose():
    """La analítica mide los dos parámetros — cuando el episodio cita
    ambos (aunque repartidos entre titulares o en la misma frase) la
    etiqueta los muestra juntos."""
    items = [
        _it("closure", "niveles de E. coli"),
        _it("closure", "exceso de enterococos"),
        _it("closure", "mala calidad del agua"),
    ]
    assert _press_cause(items) == "E. coli y enterococos"
    # y con un solo texto que cite los dos
    items2 = [_it("closure", "E. coli y enterococos >800 UFC")]
    assert _press_cause(items2) == "E. coli y enterococos"


def test_param_beats_fecal_family():
    """"contaminación fecal" es la FAMILIA — el parámetro nombrado
    (E. coli) tiene jerarquía superior aunque sea minoritario."""
    items = [
        _it("closure", "contaminación fecal"),
        _it("closure", "contaminación fecal"),
        _it("closure", "E. coli >800 UFC/100 mL"),
    ]
    assert _press_cause(items) == "E. coli"


def test_majority_cause_ignores_specificity():
    """Para la persistencia estructural decide la mayoría, no la
    especificidad: una mención suelta de "obras" no eterniza un
    episodio de contaminación."""
    items = [
        _it("closure", "vertido de aguas fecales"),
        _it("closure", "vertido de aguas fecales"),
        _it("closure", "obras de emergencia"),
    ]
    assert _majority_cause(items) == "Contaminación fecal"

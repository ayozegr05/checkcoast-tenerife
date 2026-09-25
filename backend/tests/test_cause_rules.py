"""Reglas de normalización de causa (alertas con causa, 10.5).

El caso Benijo marcó la regla: titulares de prensa que describen el
mecanismo del cierre ("acceso prohibido") o la gestión posterior no son
una causa y no deben votar en la moda — la razón de fondo sí.
"""

from app.queries import _short_cause


def test_mechanism_is_not_a_cause():
    assert _short_cause("acceso prohibido") is None
    assert _short_cause("cierre de acceso") is None
    assert _short_cause("seguridad y control de acceso") is None
    assert _short_cause("vallado preventivo") is None


def test_reasons_still_map():
    assert _short_cause("vertido de aguas residuales") == "Contaminación"
    assert _short_cause("riesgo de desprendimientos") == "Desprendimientos"
    # mecanismo + razón en la misma frase: gana la razón
    assert _short_cause("vallado por desprendimientos") == "Desprendimientos"
    assert _short_cause("obras en la playa") == "Obras"
    assert _short_cause("temporal y mar de fondo") == "Mar agitado"


def test_unknown_text_is_none():
    assert _short_cause(None) is None
    assert _short_cause("") is None
    assert _short_cause("la playa más querida del norte") is None

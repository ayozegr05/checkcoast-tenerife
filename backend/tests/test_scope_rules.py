"""Alcance del cierre (scope): un 'closure' de prensa no siempre
cierra la playa — Punta Larga marcó la regla: el Ayuntamiento valló
una escalera del último tramo y la app pintó toda la playa en rojo.

Reglas:
- 'whole' / NULL (conservador): closure → closed
- 'partial' (tramo acotado, playa usable): closure → warning
- 'access_point' (una entrada vallada, zona accesible): no vota estado
- 'facility' (charco/piscina/sendero anexo): no vota estado
"""

from datetime import UTC, datetime
from types import SimpleNamespace

from app.queries import _episode_items, _press_event, _voting_type


def _it(event_type: str, scope: str | None = None, days_ago: int = 0):
    from datetime import timedelta

    return SimpleNamespace(
        event_type=event_type,
        scope=scope,
        cause="riesgo de desprendimientos",
        published_at=datetime.now(UTC) - timedelta(days=days_ago),
    )


def test_voting_type_mapping():
    assert _voting_type(_it("closure")) == "closure"  # NULL = whole
    assert _voting_type(_it("closure", "whole")) == "closure"
    assert _voting_type(_it("closure", "partial")) == "warning"
    assert _voting_type(_it("closure", "access_point")) == "other"
    assert _voting_type(_it("closure", "facility")) == "other"
    # scope no afecta a otros event_type
    assert _voting_type(_it("warning", "partial")) == "warning"
    assert _voting_type(_it("reopening", "whole")) == "reopening"


def test_access_point_closure_decides_nothing():
    """Punta Larga: 'cierran el acceso a un tramo' con la playa abierta
    por otros lados no pinta la playa en rojo."""
    items = [_it("closure", "access_point", days_ago=1)]
    assert _press_event(items) is None


def test_partial_closure_is_warning_not_closed():
    items = [_it("closure", "partial", days_ago=1)]
    ev = _press_event(items)
    assert ev is not None
    assert _voting_type(ev) == "warning"


def test_whole_closure_still_closes():
    items = [_it("closure", "whole", days_ago=1)]
    ev = _press_event(items)
    assert ev is not None
    assert _voting_type(ev) == "closure"


def test_access_point_does_not_hide_older_whole_closure():
    """Un 'access_point' posterior no deshace un cierre total vigente."""
    items = [
        _it("closure", "access_point", days_ago=1),
        _it("closure", "whole", days_ago=30),
    ]
    ev = _press_event(items)
    assert ev is not None
    assert _voting_type(ev) == "closure"


def test_reopening_beats_access_point():
    items = [
        _it("closure", "access_point", days_ago=5),
        _it("reopening", days_ago=2),
    ]
    # la reapertura es el evento que manda; el access_point no es
    # warning ni closure — el último 'change' es la reapertura
    ev = _press_event(items)
    assert ev is None


def test_episode_items_treats_access_point_as_neutral():
    """En el episodio vigente, un access_point se conserva como
    contexto pero no arrastra la ventana ni corta episodios."""
    items = [
        _it("closure", "access_point", days_ago=1),
        _it("closure", "whole", days_ago=3),
    ]
    ep = _episode_items(items)
    assert len(ep) == 2


def test_effective_states_respects_scope(seed_data):
    """Integración con la matriz: playa no monitorizada (decide la
    prensa) — access_point no alerta, partial avisa, whole cierra."""
    from app.db import SessionLocal
    from app.models import NewsItem
    from app.queries import effective_states

    beach_id = seed_data["osm_beach_id"]
    db = SessionLocal()
    url_base = "https://news.google.com/rss/articles/pytest-scope"

    def _add(suffix: str, scope: str | None):
        it = NewsItem(
            url=f"{url_base}-{suffix}",
            title=f"Caso scope {scope}",
            source="Test Press",
            relevant=True,
            beach_id=beach_id,
            event_type="closure",
            cause="riesgo de desprendimientos",
            scope=scope,
            published_at=datetime.now(UTC),
        )
        db.add(it)
        db.commit()
        return it

    cases = [
        ("access_point", "unknown"),  # no alerta: estado oficial crudo
        ("facility", "unknown"),
        ("partial", "warning"),
        ("whole", "closed"),
    ]
    added = []
    try:
        for scope, expected in cases:
            added.append(_add(scope, scope))
            state = effective_states(db)[beach_id]
            assert state["status"] == expected, (
                f"scope={scope}: esperado {expected}, "
                f"obtenido {state['status']}"
            )
            # limpiar para el siguiente caso: un cierre whole
            # posterior taparía lo anterior
            for it in added:
                db.delete(it)
            added.clear()
            db.commit()
    finally:
        for it in added:
            db.delete(it)
        db.commit()
        db.close()

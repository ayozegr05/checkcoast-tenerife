"""Tests unitarios de los helpers de presentación de
`app/share_context.py` (antes solo cubiertos vía HTTP)."""

from datetime import UTC, datetime
from types import SimpleNamespace

from app.share_context import (
    _alert_when,
    _display_name,
    _display_state,
    _live_status_counts,
    _num,
    _qcolor,
)

NOW = datetime(2026, 10, 17, 12, 0, tzinfo=UTC)


def test_display_name_article_paren():
    assert _display_name("PLAYA GAVIOTAS (LAS) PM1") == "Playa de las Gaviotas"


def test_display_name_article_paren_no_playa():
    # Sin prefijo PLAYA: el artículo va delante ("Confital (El)" →
    # "El Confital") en vez de "de la/de las…"
    assert _display_name("CABEZO (EL) PM2") == "El Cabezo"


def test_display_name_accents():
    assert _display_name("PLAYA JAQUITA (LA) PM1") == "Playa de la Jaquita"


def test_alert_when_recent():
    assert _alert_when("cerrada", datetime(2026, 10, 15, tzinfo=UTC), NOW) == (
        "cerrada · hace 2 días"
    )
    assert _alert_when("cerrada", datetime(2026, 10, 17, tzinfo=UTC), NOW) == (
        "cerrada · hoy"
    )
    assert _alert_when("cerrada", datetime(2026, 10, 16, tzinfo=UTC), NOW) == (
        "cerrada · ayer"
    )


def test_alert_when_old():
    # >30 d: "hace 200 días" se lee rancio — "desde <mes> <año>"
    assert _alert_when("cerrada", datetime(2026, 2, 1, tzinfo=UTC), NOW) == (
        "cerrada desde feb 2026"
    )


def test_num():
    assert _num("9 UFC/100 mL") == 9.0
    assert _num("<10") == 10.0
    assert _num(">24000") == 24000.0
    assert _num(None) is None
    assert _num("sin datos") is None


def test_qcolor():
    # Umbrales RD 1341/2007 — ecoli: ≤250 excelente, ≤500 bueno
    assert _qcolor("ecoli", 100) == "#0d9488"
    assert _qcolor("ecoli", 300) == "#f9a825"
    assert _qcolor("ecoli", 600) == "#c62828"


def test_display_state():
    assert _display_state(None) == "unknown"
    assert _display_state({"status": "open"}) == "open"
    # El estructural se distingue del cierre rojo (granate en la landing)
    assert _display_state({"status": "closed", "structural": True}) == (
        "structural"
    )


def test_live_status_counts():
    # Ids fuera del censo → clave única por playa: cuentan por
    # separado (los grupos reales se prueban en test_…_grouped)
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        effs = {
            -1: {"status": "open"},
            -2: {"status": "closed"},
            -3: {"status": "closed"},
            -4: {"status": SimpleNamespace(value="warning")},
        }
        assert _live_status_counts(db, effs) == {
            "open": 1,
            "closed": 2,
            "warning": 1,
        }
    finally:
        db.close()


def test_live_status_counts_grouped(seed_data):
    """Dos PMs de la misma playa física cuentan UNA, como el banner
    de la app — Punta Larga PM1+PM2 cerradas = 1 cerrada, no 2."""
    from geoalchemy2.elements import WKTElement

    from app.db import SessionLocal
    from app.models import Beach

    db = SessionLocal()
    try:
        pm1 = Beach(
            external_id="ci-grp-pm1",
            name="PLAYA TEST GRUPO PM1",
            municipality="Test Muni",
            monitored=True,
            geom=WKTElement("POINT(-16.25 28.46)", srid=4326),
        )
        pm2 = Beach(
            external_id="ci-grp-pm2",
            name="PLAYA TEST GRUPO PM2",
            municipality="Test Muni",
            monitored=True,
            geom=WKTElement("POINT(-16.25 28.46)", srid=4326),
        )
        db.add_all([pm1, pm2])
        db.flush()
        effs = {
            pm1.id: {"status": "closed"},
            pm2.id: {"status": "closed"},
        }
        assert _live_status_counts(db, effs) == {"closed": 1}
        # El peor estado manda: cerrada + abierta = cerrada
        effs[pm2.id] = {"status": "open"}
        assert _live_status_counts(db, effs) == {"closed": 1}
        db.rollback()
    finally:
        db.close()

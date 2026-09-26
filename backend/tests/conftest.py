import pytest


@pytest.fixture(autouse=True)
def _no_real_push(monkeypatch):
    """Los tests jamás deben disparar push reales.

    `_send` es la única salida al Expo Push Service: con el bloqueada,
    los endpoints y el scraper pueden llamar a notify_* sin efecto
    real y los tests de notify pueden re-parchearla con un recorder."""
    import app.notify

    monkeypatch.setattr(app.notify, "_send", lambda *a, **k: 0)


@pytest.fixture(scope="session", autouse=True)
def seed_data():
    """Datos sintéticos mínimos para la suite de API.

    Sirven tanto en CI (PostGIS vacío tras `alembic upgrade head`) como en
    local sobre la BD de desarrollo: las filas se borran al terminar la
    sesión. Los tests deben usar estos ids en vez de ids/datos reales.
    """
    db = None
    ids = {}
    try:
        from geoalchemy2.elements import WKTElement

        from app.db import SessionLocal
        from app.models import (
            Beach,
            BeachState,
            BeachStatus,
            Outfall,
            OutfallStatus,
        )

        db = SessionLocal()
        beach = Beach(
            external_id="ci-seed-beach",
            name="PLAYA TEST CI (LA) PM1",
            municipality="Santa Cruz de Tenerife",
            monitored=True,
            geom=WKTElement("POINT(-16.25 28.46)", srid=4326),
        )
        osm_beach = Beach(
            external_id="ci-seed-osm",
            name="Cala Test CI",
            monitored=False,
            geom=WKTElement("POINT(-16.60 28.30)", srid=4326),
        )
        outfall = Outfall(
            external_id="ci-seed-outfall",
            name="Emisario Test CI",
            municipality="Santa Cruz de Tenerife",
            status=OutfallStatus.legal,
            geom=WKTElement("POINT(-16.25 28.45)", srid=4326),
        )
        db.add_all([beach, osm_beach, outfall])
        db.flush()
        db.add(BeachStatus(beach_id=beach.id, status=BeachState.open))
        db.commit()
        ids = {
            "beach_id": beach.id,
            "osm_beach_id": osm_beach.id,
            "outfall_id": outfall.id,
        }
    except Exception:
        # Sin BD: los tests que la usan fallarán por sí mismos con el
        # error de conexión correspondiente
        if db is not None:
            db.rollback()
    yield ids
    if db is not None:
        try:
            from app.models import Beach, Outfall

            db.query(Beach).filter(
                Beach.external_id.in_(["ci-seed-beach", "ci-seed-osm"])
            ).delete(synchronize_session=False)
            db.query(Outfall).filter(
                Outfall.external_id == "ci-seed-outfall"
            ).delete(synchronize_session=False)
            db.commit()
        finally:
            db.close()

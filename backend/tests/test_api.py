from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_outfalls_geojson():
    r = client.get("/outfalls")
    assert r.status_code == 200
    data = r.json()
    assert data["type"] == "FeatureCollection"
    assert len(data["features"]) > 0

    f = data["features"][0]
    assert f["type"] == "Feature"
    assert f["geometry"]["type"] == "Point"
    lon, lat = f["geometry"]["coordinates"]
    # Bounding box de Tenerife
    assert -17.0 <= lon <= -16.0
    assert 27.9 <= lat <= 28.7
    assert f["properties"]["status"] in ("legal", "illegal", "unknown")


def test_outfalls_status_filter():
    r = client.get("/outfalls", params={"status": "illegal"})
    assert r.status_code == 200
    for f in r.json()["features"]:
        assert f["properties"]["status"] == "illegal"


def test_outfalls_invalid_status_returns_422():
    r = client.get("/outfalls", params={"status": "bogus"})
    assert r.status_code == 422


def test_beaches_geojson():
    r = client.get("/beaches")
    assert r.status_code == 200
    data = r.json()
    assert data["type"] == "FeatureCollection"
    assert len(data["features"]) > 0


def test_beaches_include_status_and_municipality():
    features = client.get("/beaches").json()["features"]
    for f in features:
        assert f["properties"]["status"] in (
            "open", "closed", "warning", "unknown"
        )
    # La ingesta de Náyade rellena municipality en las playas casadas
    assert any(f["properties"]["municipality"] for f in features)


def test_beach_incidents(seed_data):
    beach_id = seed_data["beach_id"]
    r = client.get(f"/beaches/{beach_id}/incidents")
    assert r.status_code == 200
    for inc in r.json():
        assert inc["beach_id"] == beach_id
        assert inc["opened_at"]


def test_beach_incidents_not_found():
    r = client.get("/beaches/999999/incidents")
    assert r.status_code == 404


def test_beach_quality(seed_data):
    beach_id = seed_data["beach_id"]
    r = client.get(f"/beaches/{beach_id}/quality")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_beach_quality_not_found():
    r = client.get("/beaches/999999/quality")
    assert r.status_code == 404


def test_beach_status_known_id(seed_data):
    beach_id = seed_data["beach_id"]
    r = client.get(f"/beaches/{beach_id}/status")
    assert r.status_code == 200
    body = r.json()
    assert body["beach_id"] == beach_id
    assert body["status"] in ("open", "closed", "warning", "unknown")


def test_beach_status_not_found():
    r = client.get("/beaches/999999/status")
    assert r.status_code == 404


def test_alerts_is_list():
    r = client.get("/alerts")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_beach_news_returns_items(seed_data):
    from app.db import SessionLocal
    from app.models import NewsItem

    beach_id = seed_data["beach_id"]
    db = SessionLocal()
    item = NewsItem(
        url="https://news.google.com/rss/articles/pytest-item",
        title="Prohibido el baño en una playa por vertido",
        source="Test Press",
        relevant=True,
        beach_id=beach_id,
        event_type="closure",
        cause="vertido de aguas residuales",
    )
    noise = NewsItem(
        url="https://news.google.com/rss/articles/pytest-noise",
        title="Titular no relevante",
        relevant=False,
        beach_id=None,
    )
    db.add_all([item, noise])
    db.commit()
    try:
        r = client.get(f"/beaches/{beach_id}/news")
        assert r.status_code == 200
        body = r.json()
        titles = [n["title"] for n in body["items"]]
        assert item.title in titles
        # Los no relevantes/no casados no se sirven
        assert noise.title not in titles
        n = next(n for n in body["items"] if n["title"] == item.title)
        assert n["beach_id"] == beach_id
        assert n["event_type"] == "closure"
        assert n["source"] == "Test Press"
        # El resumen agrega lo extraído (puede haber otras noticias reales)
        assert body["summary"]["items_count"] == len(body["items"])
        assert body["summary"]["outlets_count"] >= 1
    finally:
        db.delete(item)
        db.delete(noise)
        db.commit()
        db.close()


def test_beach_news_not_found():
    r = client.get("/beaches/999999/news")
    assert r.status_code == 404


def test_press_closure_enters_alerts(seed_data):
    """Una playa sin alerta oficial pero cerrada según prensa (último
    evento que cambia estado = closure) entra en /alerts con via='press'."""
    from datetime import datetime, timezone

    from app.db import SessionLocal
    from app.models import NewsItem

    osm_id = seed_data["osm_beach_id"]  # sin estado oficial
    mon_id = seed_data["beach_id"]      # monitorizada con oficial 'open'
    db = SessionLocal()
    item = NewsItem(
        url="https://news.google.com/rss/articles/pytest-press-alert",
        title="Cierran la playa por desprendimientos",
        source="Test Press",
        relevant=True,
        beach_id=osm_id,
        event_type="closure",
        cause="desprendimientos",
        published_at=datetime.now(timezone.utc),
    )
    # Ventana de gracia: playa monitorizada con oficial 'open' + cierre
    # de prensa fresco -> alerta igualmente, porque Náyade tarda en
    # registrar cierres municipales
    item_open = NewsItem(
        url="https://news.google.com/rss/articles/pytest-press-grace",
        title="Cierran la playa por vertido",
        source="Test Press",
        relevant=True,
        beach_id=mon_id,
        event_type="closure",
        cause="vertido",
        published_at=datetime.now(timezone.utc),
    )
    db.add_all([item, item_open])
    db.commit()
    try:
        alerts = client.get("/alerts").json()
        hit = next((a for a in alerts if a["beach_id"] == osm_id), None)
        assert hit is not None
        assert hit["status"] == "closed"
        assert hit["via"] == "press"
        hit_open = next(
            (a for a in alerts if a["beach_id"] == mon_id), None
        )
        assert hit_open is not None
        assert hit_open["via"] == "press"
    finally:
        db.delete(item)
        db.delete(item_open)
        db.commit()
        db.close()


def test_set_beach_status_flow(seed_data):
    from sqlalchemy import func

    from app.db import SessionLocal
    from app.models import BeachStatus

    beach_id = seed_data["beach_id"]

    db = SessionLocal()
    last_id = db.query(func.max(BeachStatus.id)).scalar() or 0
    try:
        r = client.post(
            f"/beaches/{beach_id}/status", json={"status": "closed"}
        )
        assert r.status_code == 201
        assert r.json()["status"] == "closed"

        alerts = client.get("/alerts").json()
        assert any(a["beach_id"] == beach_id for a in alerts)

        # Restaurar a abierta
        r = client.post(
            f"/beaches/{beach_id}/status", json={"status": "open"}
        )
        assert r.status_code == 201
        alerts = client.get("/alerts").json()
        assert all(a["beach_id"] != beach_id for a in alerts)
    finally:
        # no dejar historial basura
        db.query(BeachStatus).filter(BeachStatus.id > last_id).delete()
        db.commit()
        db.close()


def test_set_beach_status_not_found():
    r = client.post("/beaches/999999/status", json={"status": "closed"})
    assert r.status_code == 404


def test_set_beach_status_invalid(seed_data):
    r = client.post(
        f"/beaches/{seed_data['beach_id']}/status",
        json={"status": "bogus"},
    )
    assert r.status_code == 422


def test_register_device_idempotent():
    from app.db import SessionLocal
    from app.models import DeviceToken

    token = "ExponentPushToken[pytest-test-token]"
    try:
        r = client.post(
            "/devices", json={"token": token, "platform": "android"}
        )
        assert r.status_code == 201
        assert r.json()["ok"] is True
        # Idempotente: mismo token no duplica
        r = client.post("/devices", json={"token": token})
        assert r.status_code == 201
        db = SessionLocal()
        assert db.query(DeviceToken).filter_by(token=token).count() == 1
        db.close()
    finally:
        db = SessionLocal()
        db.query(DeviceToken).filter_by(token=token).delete()
        db.commit()
        db.close()


def test_register_device_invalid_token():
    r = client.post("/devices", json={"token": "not-an-expo-token"})
    assert r.status_code == 400

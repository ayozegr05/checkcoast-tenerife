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


def test_beach_incidents():
    beaches = client.get("/beaches").json()["features"]
    beach_id = beaches[0]["id"]
    r = client.get(f"/beaches/{beach_id}/incidents")
    assert r.status_code == 200
    for inc in r.json():
        assert inc["beach_id"] == beach_id
        assert inc["opened_at"]


def test_beach_incidents_not_found():
    r = client.get("/beaches/999999/incidents")
    assert r.status_code == 404


def test_beach_status_known_id():
    beaches = client.get("/beaches").json()["features"]
    beach_id = beaches[0]["id"]
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


def test_set_beach_status_flow():
    beaches = client.get("/beaches").json()["features"]
    beach_id = beaches[0]["id"]

    r = client.post(f"/beaches/{beach_id}/status", json={"status": "closed"})
    assert r.status_code == 201
    assert r.json()["status"] == "closed"

    alerts = client.get("/alerts").json()
    assert any(a["beach_id"] == beach_id for a in alerts)

    # Restaurar a abierta
    r = client.post(f"/beaches/{beach_id}/status", json={"status": "open"})
    assert r.status_code == 201
    alerts = client.get("/alerts").json()
    assert all(a["beach_id"] != beach_id for a in alerts)


def test_set_beach_status_not_found():
    r = client.post("/beaches/999999/status", json={"status": "closed"})
    assert r.status_code == 404


def test_set_beach_status_invalid():
    beaches = client.get("/beaches").json()["features"]
    r = client.post(
        f"/beaches/{beaches[0]['id']}/status", json={"status": "bogus"}
    )
    assert r.status_code == 422

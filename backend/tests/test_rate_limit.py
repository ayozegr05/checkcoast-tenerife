"""Rate limiting por IP en los endpoints write-only sin auth."""

from fastapi.testclient import TestClient

from app.main import app
from app.rate_limit import RateLimiter, devices_limiter, events_limiter

TOKEN = "ExponentPushToken[test-rate-limit]"
EVENT = {"kind": "rate_limit_test", "platform": "test", "message": "x"}


def _clear():
    devices_limiter._hits.clear()
    events_limiter._hits.clear()


def test_limiter_unit():
    limiter = RateLimiter(max_per_window=2)
    assert limiter.limited("1.1.1.1") is False
    assert limiter.limited("1.1.1.1") is False
    assert limiter.limited("1.1.1.1") is True
    # Otra IP no comparte el cupo
    assert limiter.limited("2.2.2.2") is False


def test_devices_rate_limited_same_ip():
    _clear()
    client = TestClient(app, client=("10.9.9.9", 10000))
    last = None
    for _ in range(devices_limiter.max_per_window):
        last = client.post("/devices", json={"token": TOKEN})
        assert last.status_code == 201
    r = client.post("/devices", json={"token": TOKEN})
    assert r.status_code == 429


def test_devices_limit_is_per_ip():
    _clear()
    client_a = TestClient(app, client=("10.9.9.8", 10000))
    for _ in range(devices_limiter.max_per_window):
        client_a.post("/devices", json={"token": TOKEN})
    # Una IP distinta sigue pudiendo registrar
    client_b = TestClient(app, client=("10.9.9.7", 10000))
    r = client_b.post("/devices", json={"token": TOKEN})
    assert r.status_code == 201


def test_client_events_rate_limited():
    _clear()
    client = TestClient(app, client=("10.9.9.6", 10000))
    for _ in range(events_limiter.max_per_window):
        r = client.post("/client-events", json=EVENT)
        assert r.status_code == 201
    r = client.post("/client-events", json=EVENT)
    assert r.status_code == 429

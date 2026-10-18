"""App Check en modo monitor: cuenta veredictos, nunca rechaza.

El verificador firebase se sustituye por fakes — la suite no tiene
credenciales ni sale a Google.
"""

import pytest
from fastapi.testclient import TestClient

import app.app_check as ac
from app.main import app


@pytest.fixture(autouse=True)
def _fresh_stats(monkeypatch):
    """Contadores aislados por test + init firebase reseteado."""
    monkeypatch.setattr(ac, "stats", {"missing": 0, "valid": 0, "invalid": 0})
    monkeypatch.setattr(ac, "_init_done", False)
    monkeypatch.setattr(ac, "_app", None)
    return ac.stats


def _fake_firebase(valid: bool):
    """Sustituye _firebase_app por un objeto cuyo verify_token
    acierta/falla según `valid`."""
    fake = object()

    def fake_verify(token, app=None):  # noqa: ARG001 — firma firebase
        if not valid:
            raise ValueError("bad token")

    import firebase_admin.app_check as fb_check

    return fake, fake_verify, fb_check


def test_missing_header_counts_and_passes():
    ac.monitor(None)
    ac.monitor("")
    assert ac.stats["missing"] == 2
    assert ac.stats["valid"] == 0


def test_token_without_verifier_is_inert(monkeypatch):
    """Sin credenciales firebase el monitor no decide: no cuenta
    valid ni invalid (modo monitor nunca tumba ni falsifica datos)."""
    monkeypatch.setattr(ac, "_firebase_app", lambda: None)
    ac.monitor("some-token")
    assert ac.stats["missing"] == 0
    assert ac.stats["valid"] == 0
    assert ac.stats["invalid"] == 0


def test_valid_token_counts(monkeypatch):
    fake, fake_verify, fb_check = _fake_firebase(valid=True)
    monkeypatch.setattr(ac, "_firebase_app", lambda: fake)
    monkeypatch.setattr(fb_check, "verify_token", fake_verify)
    ac.monitor("good-token")
    assert ac.stats["valid"] == 1


def test_invalid_token_counts_and_never_raises(monkeypatch):
    fake, fake_verify, fb_check = _fake_firebase(valid=False)
    monkeypatch.setattr(ac, "_firebase_app", lambda: fake)
    monkeypatch.setattr(fb_check, "verify_token", fake_verify)
    ac.monitor("forged-token")
    assert ac.stats["invalid"] == 1


def test_endpoints_work_without_header(seed_data):
    """Modo monitor: los clientes viejos sin el módulo nativo siguen
    registrando tokens y eventos — nada de 401/403."""
    client = TestClient(app)
    r = client.post(
        "/devices", json={"token": "ExponentPushToken[ac1]", "platform": "android"}
    )
    assert r.status_code == 201
    r = client.post(
        "/client-events", json={"kind": "app_check_test", "platform": "android"}
    )
    assert r.status_code == 201
    assert ac.stats["missing"] >= 2

"""Tests de `require_admin`: la puerta de escritura debe fallar cerrada.

El endpoint `POST /beaches/{id}/status` altera el estado público y puede
disparar push — estas pruebas fijan que sin credencial válida nadie pasa.
"""

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

client = TestClient(app)

_BEACH_STATUS_URL = "/beaches/1/status"
_PAYLOAD = {"status": "closed"}


def test_admin_disabled_without_configured_key(monkeypatch):
    """Sin ADMIN_API_KEY configurada el endpoint queda deshabilitado
    (503), nunca abierto — la ausencia de config no debe ser un bypass."""
    monkeypatch.setattr(settings, "admin_api_key", None)
    r = client.post(
        _BEACH_STATUS_URL, json=_PAYLOAD, headers={"X-Admin-Key": "whatever"}
    )
    assert r.status_code == 503


def test_admin_rejects_missing_header(admin):
    r = client.post(_BEACH_STATUS_URL, json=_PAYLOAD)
    assert r.status_code == 401


def test_admin_rejects_wrong_key(admin):
    r = client.post(
        _BEACH_STATUS_URL,
        json=_PAYLOAD,
        headers={"X-Admin-Key": "wrong-key"},
    )
    assert r.status_code == 401

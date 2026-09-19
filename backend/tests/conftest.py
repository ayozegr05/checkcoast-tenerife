import pytest


@pytest.fixture(autouse=True)
def _no_real_push(monkeypatch):
    """Los tests corren contra la BD real: jamás deben disparar push.

    El endpoint y el scraper importan `notify_beach_status` dentro de la
    función, así que parchear el atributo del módulo basta."""
    import app.notify

    monkeypatch.setattr(app.notify, "notify_beach_status", lambda *a, **k: None)

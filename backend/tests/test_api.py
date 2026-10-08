from datetime import UTC, date

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert data["db"] == "ok"
    # Sin job_runs registrados los syncs figuran stale → "degraded" es
    # un estado legítimo en la DB de tests; lo que importa es la forma
    assert data["status"] in ("ok", "degraded")
    for job in ("nayade-sync", "news-sync"):
        assert job in data["jobs"]
        assert "stale" in data["jobs"][job]
    assert set(data["errors_24h"]) == {"llm", "job_runs", "client"}


def test_client_events():
    r = client.post(
        "/client-events",
        json={
            "kind": "push_register_failed",
            "platform": "android",
            "message": "test",
        },
    )
    assert r.status_code == 201
    data = client.get("/health").json()
    assert data["errors_24h"]["client"] >= 1


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
            "open",
            "closed",
            "warning",
            "unknown",
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
    from datetime import datetime

    from app.db import SessionLocal
    from app.models import NewsItem

    osm_id = seed_data["osm_beach_id"]  # sin estado oficial
    mon_id = seed_data["beach_id"]  # monitorizada con oficial 'open'
    db = SessionLocal()
    item = NewsItem(
        url="https://news.google.com/rss/articles/pytest-press-alert",
        title="Cierran la playa por desprendimientos",
        source="Test Press",
        relevant=True,
        beach_id=osm_id,
        event_type="closure",
        cause="desprendimientos",
        published_at=datetime.now(UTC),
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
        published_at=datetime.now(UTC),
    )
    db.add_all([item, item_open])
    db.commit()
    try:
        alerts = client.get("/alerts").json()
        hit = next((a for a in alerts if a["beach_id"] == osm_id), None)
        assert hit is not None
        assert hit["status"] == "closed"
        assert hit["via"] == "press"
        hit_open = next((a for a in alerts if a["beach_id"] == mon_id), None)
        assert hit_open is not None
        assert hit_open["via"] == "press"
    finally:
        db.delete(item)
        db.delete(item_open)
        db.commit()
        db.close()


def test_press_closure_persistence_by_cause(seed_data):
    """La caducidad de un cierre de prensa depende de la CAUSA, no de
    si la playa está monitorizada (Sanidad no contradice causas
    estructurales como desprendimientos/obras, solo calidad de agua):
    - cierre por causa estructural (desprendimientos) -> persiste,
      monitorizada o no (Benijo, Gaviotas)
    - cierre por causa transitoria (bacterias/vertido) -> caduca a los
      21 días aunque sea un cierre confirmado (caso Puertito: bacterias
      fecales de 2025 sin seguimiento en 15 meses)
    """
    from datetime import datetime, timedelta

    from app.db import SessionLocal
    from app.models import NewsItem

    osm_id = seed_data["osm_beach_id"]  # sin estado oficial
    mon_id = seed_data["beach_id"]  # monitorizada con oficial 'open'
    db = SessionLocal()
    old = datetime.now(UTC) - timedelta(days=30)
    item_structural = NewsItem(
        url="https://news.google.com/rss/articles/pytest-old-structural",
        title="La playa sigue cerrada por desprendimientos",
        source="Test Press",
        relevant=True,
        beach_id=osm_id,
        event_type="closure",
        cause="desprendimientos",
        published_at=old,
    )
    item_structural_mon = NewsItem(
        url="https://news.google.com/rss/articles/pytest-old-structural-mon",
        title="Obras bloquean la reapertura de la playa",
        source="Test Press",
        relevant=True,
        beach_id=mon_id,
        event_type="closure",
        cause="obras",
        published_at=old,
    )
    item_transient = NewsItem(
        url="https://news.google.com/rss/articles/pytest-old-transient",
        title="Cierran la playa por bacterias fecales",
        source="Test Press",
        relevant=True,
        beach_id=osm_id,
        event_type="closure",
        cause="bacterias fecales",
        published_at=old - timedelta(days=1),  # más vieja: no manda
    )
    db.add_all([item_structural, item_structural_mon])
    db.commit()
    try:
        alerts = client.get("/alerts").json()
        hit = next((a for a in alerts if a["beach_id"] == osm_id), None)
        assert hit is not None and hit["status"] == "closed"
        hit_mon = next((a for a in alerts if a["beach_id"] == mon_id), None)
        assert hit_mon is not None and hit_mon["status"] == "closed"
    finally:
        db.delete(item_structural)
        db.delete(item_structural_mon)
        db.commit()

    # Ahora solo la causa transitoria, vieja: debe caducar (sin alerta)
    db.add(item_transient)
    db.commit()
    try:
        alerts = client.get("/alerts").json()
        assert all(a["beach_id"] != osm_id for a in alerts)
    finally:
        db.delete(item_transient)
        db.commit()
        db.close()


def test_effective_status_suppresses_stale_official(seed_data):
    """Estado efectivo: un oficial 'closed' derivado de evidencia
    anterior a una reapertura de prensa (mismo episodio que Náyade
    publica tarde) se muestra como 'open' en mapa y ficha, y no
    alerta. El BeachStatus crudo se conserva."""
    from datetime import date, datetime, timedelta

    from app.db import SessionLocal
    from app.models import (
        BeachMeasurement,
        BeachState,
        BeachStatus,
        NewsItem,
    )

    beach_id = seed_data["beach_id"]
    db = SessionLocal()
    now = datetime.now(UTC)
    status = BeachStatus(
        beach_id=beach_id,
        status=BeachState.closed,
        reported_at=now,
    )
    meas = BeachMeasurement(
        beach_id=beach_id,
        sampled_at=date.today() - timedelta(days=4),
        evaluation="Zona No Apta para el baño",
    )
    reopen = NewsItem(
        url="https://news.google.com/rss/articles/pytest-reopen",
        title="Reabren la playa",
        source="Test Press",
        relevant=True,
        beach_id=beach_id,
        event_type="reopening",
        published_at=now - timedelta(days=2),
    )
    db.add_all([status, meas, reopen])
    db.commit()
    try:
        # Mapa: pin efectivo 'open' aunque el último status es 'closed'
        features = client.get("/beaches").json()["features"]
        feat = next(f for f in features if f["id"] == beach_id)
        assert feat["properties"]["status"] == "open"
        # Ficha: mismo estado efectivo
        body = client.get(f"/beaches/{beach_id}/status").json()
        assert body["status"] == "open"
        # Alertas: sin alerta oficial para esta playa
        alerts = client.get("/alerts").json()
        hit = next(
            (
                a
                for a in alerts
                if a["beach_id"] == beach_id and a["via"] == "official"
            ),
            None,
        )
        assert hit is None
        # El dato crudo sigue en la BD
        raw = db.get(BeachStatus, status.id)
        assert raw.status == BeachState.closed
    finally:
        db.delete(status)
        db.delete(meas)
        db.delete(reopen)
        db.commit()
        db.close()


def test_effective_status_keeps_new_official_closure(seed_data):
    """Si la evidencia oficial (medición) es POSTERIOR a la reapertura
    de prensa, es un evento nuevo: el estado efectivo sigue 'closed'
    y la playa alerta via='official'."""
    from datetime import date, datetime, timedelta

    from app.db import SessionLocal
    from app.models import (
        BeachMeasurement,
        BeachState,
        BeachStatus,
        NewsItem,
    )

    beach_id = seed_data["beach_id"]
    db = SessionLocal()
    now = datetime.now(UTC)
    status = BeachStatus(
        beach_id=beach_id,
        status=BeachState.closed,
        reported_at=now,
    )
    meas = BeachMeasurement(
        beach_id=beach_id,
        sampled_at=date.today(),  # posterior a la reapertura
        evaluation="Zona No Apta para el baño",
    )
    reopen = NewsItem(
        url="https://news.google.com/rss/articles/pytest-reopen-new",
        title="Reabren la playa",
        source="Test Press",
        relevant=True,
        beach_id=beach_id,
        event_type="reopening",
        published_at=now - timedelta(days=2),
    )
    db.add_all([status, meas, reopen])
    db.commit()
    try:
        features = client.get("/beaches").json()["features"]
        feat = next(f for f in features if f["id"] == beach_id)
        assert feat["properties"]["status"] == "closed"
        body = client.get(f"/beaches/{beach_id}/status").json()
        assert body["status"] == "closed"
        alerts = client.get("/alerts").json()
        hit = next(
            (
                a
                for a in alerts
                if a["beach_id"] == beach_id and a["via"] == "official"
            ),
            None,
        )
        assert hit is not None
        assert hit["status"] == "closed"
    finally:
        db.delete(status)
        db.delete(meas)
        db.delete(reopen)
        db.commit()
        db.close()


def test_open_incident_needs_corroborated_reopening(seed_data):
    """Incidencia formal ABIERTA + reapertura de prensa de UNA sola
    fuente: no basta para abrirla (caso Gaviotas). Con >=2 medios
    distintos la reapertura está corroborada y el efectivo es 'open'."""
    from datetime import date, datetime, timedelta

    from app.db import SessionLocal
    from app.models import (
        BeachIncident,
        BeachState,
        BeachStatus,
        NewsItem,
    )

    beach_id = seed_data["beach_id"]
    db = SessionLocal()
    now = datetime.now(UTC)
    status = BeachStatus(
        beach_id=beach_id,
        status=BeachState.closed,
        reported_at=now,
    )
    inc = BeachIncident(
        beach_id=beach_id,
        opened_at=date.today() - timedelta(days=10),
        closed_at=None,
    )
    reopen1 = NewsItem(
        url="https://news.google.com/rss/articles/pytest-reopen-a",
        title="Reabren la playa",
        source="Test Press",
        relevant=True,
        beach_id=beach_id,
        event_type="reopening",
        published_at=now - timedelta(days=2),
    )
    db.add_all([status, inc, reopen1])
    db.commit()
    try:
        # Una sola fuente no tumba una incidencia abierta
        body = client.get(f"/beaches/{beach_id}/status").json()
        assert body["status"] == "closed"
        # Con un segundo medio distinto, la reapertura está corroborada
        reopen2 = NewsItem(
            url="https://news.google.com/rss/articles/pytest-reopen-b",
            title="La playa vuelve a abrir",
            source="Otro Medio",
            relevant=True,
            beach_id=beach_id,
            event_type="reopening",
            published_at=now - timedelta(days=1),
        )
        db.add(reopen2)
        db.commit()
        body = client.get(f"/beaches/{beach_id}/status").json()
        assert body["status"] == "open"
        db.delete(reopen2)
        db.commit()
    finally:
        db.delete(status)
        db.delete(inc)
        db.delete(reopen1)
        db.commit()
        db.close()


def test_set_beach_status_flow(seed_data, admin):
    from sqlalchemy import func

    from app.db import SessionLocal
    from app.models import BeachStatus

    beach_id = seed_data["beach_id"]

    db = SessionLocal()
    last_id = db.query(func.max(BeachStatus.id)).scalar() or 0
    try:
        r = client.post(
            f"/beaches/{beach_id}/status",
            json={"status": "closed"},
            headers=admin,
        )
        assert r.status_code == 201
        assert r.json()["status"] == "closed"

        alerts = client.get("/alerts").json()
        assert any(a["beach_id"] == beach_id for a in alerts)

        # Restaurar a abierta
        r = client.post(
            f"/beaches/{beach_id}/status",
            json={"status": "open"},
            headers=admin,
        )
        assert r.status_code == 201
        alerts = client.get("/alerts").json()
        assert all(a["beach_id"] != beach_id for a in alerts)
    finally:
        # no dejar historial basura
        db.query(BeachStatus).filter(BeachStatus.id > last_id).delete()
        db.commit()
        db.close()


def test_set_beach_status_not_found(admin):
    r = client.post(
        "/beaches/999999/status", json={"status": "closed"}, headers=admin
    )
    assert r.status_code == 404


def test_set_beach_status_invalid(seed_data, admin):
    r = client.post(
        f"/beaches/{seed_data['beach_id']}/status",
        json={"status": "bogus"},
        headers=admin,
    )
    assert r.status_code == 422


@pytest.mark.parametrize("headers", [{}, {"X-Admin-Key": "wrong"}])
def test_set_beach_status_requires_admin_key(seed_data, admin, headers):
    r = client.post(
        f"/beaches/{seed_data['beach_id']}/status",
        json={"status": "closed"},
        headers=headers,
    )
    assert r.status_code == 401


def test_set_beach_status_disabled_without_key(seed_data, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "admin_api_key", None)
    r = client.post(
        f"/beaches/{seed_data['beach_id']}/status",
        json={"status": "closed"},
        headers={"X-Admin-Key": ""},
    )
    assert r.status_code == 503


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


def test_beach_news_since_anchors_latest_cluster(seed_data):
    """`summary.since` es el inicio del ÚLTIMO episodio de cierres, no
    el titular más viejo — un hueco >45 días separa episodios (caso El
    Médano: cierres de julio + septiembre; el banner debe decir 23/09,
    no 07/07)."""
    from datetime import datetime, timedelta

    from app.db import SessionLocal
    from app.models import NewsItem

    beach_id = seed_data["beach_id"]
    db = SessionLocal()
    now = datetime.now(UTC)
    old_ep = NewsItem(
        url="https://news.google.com/rss/articles/pytest-cluster-old",
        title="Cierran la playa por vertido",
        source="Test Press",
        relevant=True,
        beach_id=beach_id,
        event_type="closure",
        published_at=now - timedelta(days=80),
    )
    new_ep1 = NewsItem(
        url="https://news.google.com/rss/articles/pytest-cluster-new1",
        title="Cierran la playa por vertido",
        source="Test Press",
        relevant=True,
        beach_id=beach_id,
        event_type="closure",
        published_at=now - timedelta(days=2),
    )
    new_ep2 = NewsItem(
        url="https://news.google.com/rss/articles/pytest-cluster-new2",
        title="Sigue cerrada la playa",
        source="Otro Medio",
        relevant=True,
        beach_id=beach_id,
        event_type="closure",
        published_at=now - timedelta(days=1),
    )
    db.add_all([old_ep, new_ep1, new_ep2])
    db.commit()
    try:
        body = client.get(f"/beaches/{beach_id}/news").json()
        since = body["summary"]["since"]
        assert since is not None
        # Ancla al cluster reciente, no al titular de hace 80 días
        assert since[:10] == (now - timedelta(days=2)).date().isoformat()
    finally:
        for it in (old_ep, new_ep1, new_ep2):
            db.delete(it)
        db.commit()
        db.close()


def test_incident_press_items_and_episode_items(seed_data):
    """La ficha liga titulares a su episodio:

    - Una incidencia oficial con prensa en su ventana ±7 d la lleva
      en `press_items` (corroboración).
    - Un cierre solo de prensa fuera de toda ventana genera fila
      `via=press` con sus propios titulares.
    - `/news.episode_items` = último clúster de cobertura, no el saco
      completo (el banner enseña solo el episodio que narra).
    """
    from datetime import date, datetime, timedelta

    from app.db import SessionLocal
    from app.models import BeachIncident, NewsItem

    beach_id = seed_data["beach_id"]
    db = SessionLocal()
    now = datetime.now(UTC)
    today = date.today()
    inc = BeachIncident(
        beach_id=beach_id,
        opened_at=today - timedelta(days=10),
        closed_at=today - timedelta(days=5),
        observations="Zona donde queda prohibido el baño temporalmente",
    )
    near = NewsItem(
        url="https://news.google.com/rss/articles/pytest-ep-near",
        title="Cierran la playa por vertido",
        source="Test Press",
        relevant=True,
        beach_id=beach_id,
        event_type="closure",
        published_at=now - timedelta(days=8),
    )
    old = NewsItem(
        url="https://news.google.com/rss/articles/pytest-ep-old",
        title="La playa lleva cerrada semanas",
        source="Otro Medio",
        relevant=True,
        beach_id=beach_id,
        event_type="closure",
        published_at=now - timedelta(days=80),
    )
    db.add_all([inc, near, old])
    db.commit()
    try:
        rows = client.get(f"/beaches/{beach_id}/incidents").json()
        official = next(r for r in rows if r["via"] == "official")
        assert [n["title"] for n in official["press_items"]] == [near.title]
        press_rows = [r for r in rows if r["via"] == "press"]
        assert len(press_rows) == 1
        assert [n["title"] for n in press_rows[0]["press_items"]] == [
            old.title
        ]

        body = client.get(f"/beaches/{beach_id}/news").json()
        ep_titles = [n["title"] for n in body["episode_items"]]
        # Último episodio = el clúster reciente; el de hace 80 días
        # es otro episodio y no entra en el banner
        assert near.title in ep_titles
        assert old.title not in ep_titles
    finally:
        db.delete(inc)
        db.delete(near)
        db.delete(old)
        db.commit()
        db.close()


def test_beach_news_ignores_closed_since_before_official_incident(
    seed_data,
):
    """Un closed_since de prensa anterior a la incidencia oficial que
    cubre el episodio es imposible — el registro habría mostrado la
    playa cerrada. Caso real El Médano sep-2026: Gemini extrajo
    "2023-09-20" en un cierre temporal de 3 días (la playa sí había
    cerrado en 2023, pero ese episodio era otro)."""
    from datetime import date, datetime, timedelta

    from app.db import SessionLocal
    from app.models import BeachIncident, NewsItem

    beach_id = seed_data["beach_id"]
    db = SessionLocal()
    now = datetime.now(UTC)
    today = date.today()
    inc = BeachIncident(
        beach_id=beach_id,
        opened_at=today - timedelta(days=10),
        closed_at=today - timedelta(days=5),
        observations="Zona donde queda prohibido el baño temporalmente",
    )
    wild = NewsItem(
        url="https://news.google.com/rss/articles/pytest-cs-wild",
        title="Cerrada temporalmente la playa",
        source="Test Press",
        relevant=True,
        beach_id=beach_id,
        event_type="closure",
        published_at=now - timedelta(days=8),
        closed_since="2023-09-20",
    )
    honest = NewsItem(
        url="https://news.google.com/rss/articles/pytest-cs-honest",
        title="El ayuntamiento cierra la playa",
        source="Otro Medio",
        relevant=True,
        beach_id=beach_id,
        event_type="closure",
        published_at=now - timedelta(days=8),
        closed_since=(today - timedelta(days=8)).isoformat(),
    )
    db.add_all([inc, wild, honest])
    db.commit()
    try:
        body = client.get(f"/beaches/{beach_id}/news").json()
        assert (
            body["summary"]["closed_since"]
            == (today - timedelta(days=8)).isoformat()
        )
    finally:
        db.delete(inc)
        db.delete(wild)
        db.delete(honest)
        db.commit()
        db.close()


def test_send_push_tolerates_bad_expo_response(monkeypatch):
    """Un 502 con HTML de Expo (json() revienta) no debe propagarse:
    devuelve 0 y la ingesta sigue con el resto de playas."""
    import importlib

    import requests

    from app import notify

    # conftest parchea `_send` a noop — recargar recupera la real
    real_send = importlib.reload(notify)._send

    class BadResp:
        def raise_for_status(self):
            pass

        def json(self):
            raise ValueError("No JSON object could be decoded")

    monkeypatch.setattr(requests, "post", lambda *a, **k: BadResp())
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        assert real_send(db, ["ExponentPushToken[x]"], [{}]) == 0
    finally:
        db.close()


def test_push_aggregates_many_closures(monkeypatch):
    """≥4 cambios del mismo tipo en una pasada → un único push
    agregado ("5 cierres de baño"), no un bombardeo por playa;
    los cambios de otro tipo con ≤3 van individuales."""
    from app import notify
    from app.db import SessionLocal
    from app.models import Beach, BeachState, DeviceToken

    token = "ExponentPushToken[pytest-batch]"
    db = SessionLocal()
    db.add(DeviceToken(token=token, platform="android"))
    db.commit()

    batches = []
    individual = []

    def _beach(i):
        b = Beach(name=f"PLAYA TEST BATCH {i}", municipality="Santa Cruz")
        b.id = 9000 + i
        return b

    monkeypatch.setattr(
        notify,
        "_send",
        lambda db_, toks, msgs: batches.append(msgs) or len(msgs),
    )
    monkeypatch.setattr(
        notify,
        "notify_beach_status",
        lambda db_, b, s: individual.append(s) or 1,
    )

    changes = [(_beach(i), BeachState.closed) for i in range(5)]
    changes.append((_beach(9), BeachState.open))  # reapertura suelta
    try:
        notify.notify_beach_states(db, changes)
        assert len(batches) == 1  # un solo POST agregado
        msgs = batches[0]
        assert msgs and all(m["title"] == "5 cierres de baño" for m in msgs)
        assert "Playa Test Batch 0" in msgs[0]["body"]
        assert "Playa Test Batch 4" in msgs[0]["body"]
        assert msgs[0]["data"] == {"kind": "batch", "state": "closed"}
        assert individual == [BeachState.open]  # la suelta va aparte
    finally:
        db.query(DeviceToken).filter_by(token=token).delete()
        db.commit()
        db.close()


def test_push_few_changes_stay_individual(monkeypatch):
    """≤3 cambios del mismo tipo → push individual por playa."""
    from app import notify
    from app.db import SessionLocal
    from app.models import Beach, BeachState

    individual = []
    monkeypatch.setattr(
        notify,
        "notify_beach_status",
        lambda db_, b, s: individual.append(s) or 1,
    )
    db = SessionLocal()
    try:
        b = Beach(name="PLAYA TEST SOLO", municipality="M")
        notify.notify_beach_states(db, [(b, BeachState.closed)] * 3)
        assert individual == [BeachState.closed] * 3
    finally:
        db.close()


def test_island_episodes(seed_data):
    """`/episodes` agrega episodios de toda la isla: incidencias
    oficiales + reconstruidos (prensa), una fila por episodio."""
    from datetime import datetime, timedelta

    from app.db import SessionLocal
    from app.models import NewsItem

    osm_id = seed_data["osm_beach_id"]
    db = SessionLocal()
    now = datetime.now(UTC)
    # Episodio solo-prensa resuelto hace 3 días tras 2 cerrada
    item_c = NewsItem(
        url="https://news.google.com/rss/articles/pytest-ep-c",
        title="Cierran la playa por vertido",
        source="Test Press",
        relevant=True,
        beach_id=osm_id,
        event_type="closure",
        published_at=now - timedelta(days=5),
    )
    item_r = NewsItem(
        url="https://news.google.com/rss/articles/pytest-ep-r",
        title="Reabren la playa",
        source="Test Press",
        relevant=True,
        beach_id=osm_id,
        event_type="reopening",
        published_at=now - timedelta(days=3),
    )
    db.add_all([item_c, item_r])
    db.commit()
    try:
        r = client.get("/episodes")
        assert r.status_code == 200
        rows = r.json()
        ep = next((x for x in rows if x["beach_id"] == osm_id), None)
        assert ep is not None
        assert ep["via"] == "press"
        assert ep["closed_at"] == (now - timedelta(days=3)).date().isoformat()
    finally:
        db.delete(item_c)
        db.delete(item_r)
        db.commit()
        db.close()


def _news(beach_id, event_type, published_at, url, title="Titular de test"):
    from app.models import NewsItem

    return NewsItem(
        url=url,
        title=title,
        source="Test Press",
        relevant=True,
        beach_id=beach_id,
        event_type=event_type,
        published_at=published_at,
    )


def test_press_episode_since_anchors_episode_start(seed_data):
    """Bug: `post_reopen` heredaba el orden DESC de `rows` y `since`
    anclaba al titular más nuevo del episodio en vez del primero
    (Jardín oct-2026: el banner decía "desde el 7-oct" siendo 30-sep)."""
    from datetime import datetime

    from app.db import SessionLocal

    beach_id = seed_data["beach_id"]
    db = SessionLocal()
    items = [
        _news(
            beach_id,
            "reopening",
            datetime(2026, 9, 4, tzinfo=UTC),
            "https://news.test/since-reopen",
            "Reabre la playa",
        ),
        _news(
            beach_id,
            "closure",
            datetime(2026, 9, 30, tzinfo=UTC),
            "https://news.test/since-close-1",
            "Cierran la playa",
        ),
        _news(
            beach_id,
            "closure",
            datetime(2026, 10, 7, tzinfo=UTC),
            "https://news.test/since-close-2",
            "Sigue cerrada la playa",
        ),
    ]
    db.add_all(items)
    db.commit()
    try:
        r = client.get(f"/beaches/{beach_id}/news")
        assert r.status_code == 200
        since = r.json()["summary"]["since"]
        # El episodio empieza con el PRIMER cierre post-reapertura,
        # no con el último titular de la ola
        assert since is not None and since.startswith("2026-09-30")
    finally:
        for it in items:
            db.delete(it)
        db.commit()
        db.close()


def test_press_general_closure_not_attributed_to_sibling(seed_data):
    """Cierre general de prensa (replicado a todos los PM): un punto
    con episodio VIVO narra su propio episodio — `attributed_pm` solo
    informa de la zona hermana cuando este punto ya resolvió la suya
    (Jardín oct-2026: PM1/PM5 decían "la zona 4 sigue cerrada" estando
    ellos mismos marcados cerrados por prensa)."""
    from datetime import datetime

    from geoalchemy2.elements import WKTElement

    from app.db import SessionLocal
    from app.models import Beach, BeachIncident

    beach_id = seed_data["beach_id"]  # PLAYA TEST CI (LA) PM1
    db = SessionLocal()
    sibling = Beach(
        external_id="ci-seed-beach-pm2",
        name="PLAYA TEST CI (LA) PM2",
        municipality="Santa Cruz de Tenerife",
        monitored=True,
        geom=WKTElement("POINT(-16.26 28.46)", srid=4326),
    )
    db.add(sibling)
    db.flush()
    # La hermana tiene evidencia oficial del mismo episodio
    sib_inc = BeachIncident(
        beach_id=sibling.id,
        opened_at=date(2026, 9, 30),
        closed_at=None,
        observations="Prohibido el baño",
    )
    items = [
        _news(
            beach_id,
            "closure",
            datetime(2026, 9, 30, tzinfo=UTC),
            "https://news.test/gen-close-1",
            "Cierran la playa",
        ),
        _news(
            beach_id,
            "closure",
            datetime(2026, 10, 7, tzinfo=UTC),
            "https://news.test/gen-close-2",
            "Sigue cerrada la playa",
        ),
    ]
    db.add(sib_inc)
    db.add_all(items)
    db.commit()
    try:
        # Episodio propio vivo -> NO se atribuye a la hermana
        r = client.get(f"/beaches/{beach_id}/news")
        assert r.status_code == 200
        assert r.json()["summary"]["attributed_pm"] is None
        # El historial tampoco lo presenta como "ocurrió en la zona 2"
        incs = client.get(f"/beaches/{beach_id}/incidents").json()
        press = [i for i in incs if i["via"] == "press"]
        assert press and all(i["attributed_pm"] is None for i in press)
    finally:
        for it in items:
            db.delete(it)
        db.delete(sibling)
        db.commit()
        db.close()


def test_press_episode_attributed_when_own_episode_resolved(seed_data):
    """El caso inverso sigue funcionando: si el episodio de este punto
    ya se resolvió pero el de la hermana sigue abierto, la ficha sí
    nombra a la zona hermana."""
    from datetime import datetime

    from geoalchemy2.elements import WKTElement

    from app.db import SessionLocal
    from app.models import Beach, BeachIncident

    beach_id = seed_data["beach_id"]
    db = SessionLocal()
    sibling = Beach(
        external_id="ci-seed-beach-pm3",
        name="PLAYA TEST CI (LA) PM3",
        municipality="Santa Cruz de Tenerife",
        monitored=True,
        geom=WKTElement("POINT(-16.27 28.46)", srid=4326),
    )
    db.add(sibling)
    db.flush()
    # La hermana sigue oficialmente cerrada hoy
    sib_inc = BeachIncident(
        beach_id=sibling.id,
        opened_at=date(2026, 9, 25),
        closed_at=None,
        observations="Prohibido el baño",
    )
    items = [
        _news(
            beach_id,
            "closure",
            datetime(2026, 9, 20, tzinfo=UTC),
            "https://news.test/res-close",
            "Cierran la playa",
        ),
        _news(
            beach_id,
            "reopening",
            datetime(2026, 9, 28, tzinfo=UTC),
            "https://news.test/res-reopen",
            "Reabre la playa",
        ),
    ]
    db.add(sib_inc)
    db.add_all(items)
    db.commit()
    try:
        r = client.get(f"/beaches/{beach_id}/news")
        assert r.status_code == 200
        summary = r.json()["summary"]
        assert summary["attributed_pm"] == "PM3"
        # El "desde" del banner es el inicio del episodio de la
        # hermana (su incidencia abierta del 25-sep), no el del
        # episodio ya resuelto de este punto (cierre del 20-sep)
        assert summary["since"].startswith("2026-09-25")
    finally:
        for it in items:
            db.delete(it)
        db.delete(sibling)
        db.commit()
        db.close()


def test_press_episode_overlapping_official_incident_not_duplicated(
    seed_data,
):
    """Un episodio de prensa que solapa una incidencia oficial de la
    MISMA playa es el mismo suceso real: una sola fila, la oficial, con
    los titulares embebidos (Jardín PM5: dos filas el 22/06)."""
    from datetime import datetime

    from app.db import SessionLocal
    from app.models import BeachIncident

    beach_id = seed_data["beach_id"]
    db = SessionLocal()
    inc = BeachIncident(
        beach_id=beach_id,
        opened_at=date(2026, 6, 22),
        closed_at=date(2026, 6, 24),
        observations="Prohibido el baño",
    )
    items = [
        _news(
            beach_id,
            "closure",
            datetime(2026, 6, 22, tzinfo=UTC),
            "https://news.test/dup-close",
            "Cierran la playa por bacterias",
        ),
        _news(
            beach_id,
            "reopening",
            datetime(2026, 8, 14, tzinfo=UTC),
            "https://news.test/dup-reopen",
            "Reabre la playa",
        ),
    ]
    db.add(inc)
    db.add_all(items)
    db.commit()
    try:
        r = client.get(f"/beaches/{beach_id}/incidents")
        assert r.status_code == 200
        rows = r.json()
        # Solo UNA fila para el episodio de junio: la oficial
        june = [i for i in rows if i["opened_at"].startswith("2026-06-22")]
        assert len(june) == 1
        assert june[0]["via"] == "official"
        # Y los titulares quedan embebidos como corroboración
        titles = [p["title"] for p in june[0].get("press_items", [])]
        assert "Cierran la playa por bacterias" in titles
    finally:
        for it in items:
            db.delete(it)
        db.delete(inc)
        db.commit()
        db.close()


def test_official_incident_of_previous_episode_does_not_drag_since(
    seed_data,
):
    """Bug en cascada: el bucle de official_start mutaba `since` y lo
    reevaluaba → incidencias cerradas ANTES de la última reapertura
    (episodio anterior) arrastraban el inicio hacia atrás
    (Jardín PM4: 30-sep → 2-sep → 11-ago)."""
    from datetime import datetime

    from app.db import SessionLocal
    from app.models import BeachIncident

    beach_id = seed_data["beach_id"]
    db = SessionLocal()
    # Episodio anterior ya resuelto antes de la reapertura
    inc = BeachIncident(
        beach_id=beach_id,
        opened_at=date(2026, 9, 2),
        closed_at=date(2026, 9, 3),
        observations="Prohibido el baño",
    )
    items = [
        _news(
            beach_id,
            "reopening",
            datetime(2026, 9, 4, tzinfo=UTC),
            "https://news.test/prev-reopen",
            "Reabre la playa",
        ),
        _news(
            beach_id,
            "closure",
            datetime(2026, 9, 30, tzinfo=UTC),
            "https://news.test/prev-close",
            "Cierran la playa",
        ),
    ]
    db.add(inc)
    db.add_all(items)
    db.commit()
    try:
        r = client.get(f"/beaches/{beach_id}/news")
        assert r.status_code == 200
        since = r.json()["summary"]["since"]
        # El episodio actual empieza el 30-sep; la incidencia de
        # 2-3 sep (cerrada antes de la reapertura del 4-sep) no lo
        # arranca pese a caer en la ventana ±30d
        assert since is not None and since.startswith("2026-09-30")
    finally:
        for it in items:
            db.delete(it)
        db.delete(inc)
        db.commit()
        db.close()

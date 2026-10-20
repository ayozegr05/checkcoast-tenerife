"""Tests de caracterización de las páginas públicas (`share.py`).

Fijan lo que ven los mensajeros y el navegador al abrir un enlace
compartido: código, cabeceras, Open Graph y escape de HTML de las
plantillas Jinja2."""

import io
import re

import pytest
from fastapi.testclient import TestClient
from geoalchemy2.elements import WKTElement
from PIL import Image

from app import share_context
from app.main import app
from app.routers import share

client = TestClient(app)


def _meta(html: str, prop: str) -> str:
    m = re.search(rf'<meta property="{prop}"\s+content="([^"]*)"', html)
    assert m, f"falta {prop}"
    return m.group(1)


def test_share_beach_open_graph(seed_data):
    beach_id = seed_data["beach_id"]
    r = client.get(f"/b/{beach_id}")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    assert r.headers["cache-control"] == "no-cache"
    html = r.text
    assert _meta(html, "og:title").endswith("· Santa Cruz de Tenerife")
    assert (
        _meta(html, "og:description") == "Estado: Apta — CheckCoast Tenerife"
    )
    assert _meta(html, "og:image").endswith(f"/b/{beach_id}/og.jpg")
    assert f"checkcoast://beach/{beach_id}" in html


def test_share_beach_not_found():
    assert client.get("/b/999999").status_code == 404
    assert client.get("/b/999999/og.jpg").status_code == 404


@pytest.fixture
def outfall_with_news(seed_data):
    """Emisario residual + noticia de infra que lo nombra — para la
    sección "En la prensa" de la landing /o/{id}."""
    from app.db import SessionLocal
    from app.models import NewsItem, Outfall, OutfallStatus

    with SessionLocal() as db:
        o = Outfall(
            external_id="ci-share-outfall-news",
            name="Emisario Submarino de Punta Share",
            municipality="Santa Cruz de Tenerife",
            status=OutfallStatus.legal,
            nature="Agua residual urbana",
            location="Punta Share",
            geom=WKTElement("POINT(-16.25 28.46)", srid=4326),
        )
        db.add(o)
        db.flush()
        n = NewsItem(
            url="https://news.google.com/rss/articles/pytest-share-news",
            title="Rotura del emisario de Punta Share",
            source="Test Press",
            relevant=True,
            beach_id=seed_data["beach_id"],
            event_type="infra",
        )
        db.add(n)
        db.commit()
        oid = o.id
    yield oid
    with SessionLocal() as db:
        db.query(NewsItem).filter(
            NewsItem.url.like("%pytest-share-news%")
        ).delete()
        db.query(Outfall).filter(Outfall.id == oid).delete()
        db.commit()


def test_share_outfall_news_section(outfall_with_news):
    html = client.get(f"/o/{outfall_with_news}").text
    assert "En la prensa" in html
    assert "De este punto" in html
    assert "Rotura del emisario de Punta Share" in html
    assert "Test Press" in html
    assert "no implica" in html


def test_share_outfall_no_news_section(seed_data):
    # El outfall semilla no es residual → la landing no lleva sección
    html = client.get(f"/o/{seed_data['outfall_id']}").text
    assert "En la prensa" not in html


@pytest.fixture
def hostile_beach():
    from app.db import SessionLocal
    from app.models import Beach

    with SessionLocal() as db:
        b = Beach(
            external_id="ci-share-xss",
            name="Playa <script>alert(1)</script>",
            municipality='Arona "&" <b>',
            monitored=False,
            geom=WKTElement("POINT(-16.70 28.05)", srid=4326),
        )
        db.add(b)
        db.commit()
        beach_id = b.id
    yield beach_id
    with SessionLocal() as db:
        db.query(Beach).filter(Beach.id == beach_id).delete()
        db.commit()


def test_share_beach_escapes_html(hostile_beach):
    html = client.get(f"/b/{hostile_beach}").text
    # El nombre se capitaliza ("<Script>"): se compara en minúsculas
    low = html.lower()
    assert "<script>alert(1)" not in low
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in low
    assert "Arona &#34;&amp;&#34; &lt;b&gt;" in html


def test_share_og_image_without_network(seed_data, monkeypatch):
    def offline(*a, **k):
        raise OSError("sin red en tests")

    monkeypatch.setattr(share_context.httpx, "get", offline)
    monkeypatch.setattr(share, "_og_cache", {})
    r = client.get(f"/b/{seed_data['beach_id']}/og.jpg")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    assert Image.open(io.BytesIO(r.content)).size == (1200, 630)


def test_home_page():
    r = client.get("/")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-cache"
    assert _meta(r.text, "og:title") == "CheckCoast Tenerife"
    assert "<title>CheckCoast Tenerife" in r.text


def test_privacy_page():
    r = client.get("/privacy")
    assert r.status_code == 200
    assert "<title>Privacidad — CheckCoast Tenerife</title>" in r.text


def test_assetlinks(monkeypatch):
    assert client.get("/.well-known/assetlinks.json").json() == []
    monkeypatch.setattr(share.settings, "android_cert_sha256", "AA:BB")
    [link] = client.get("/.well-known/assetlinks.json").json()
    assert link["target"]["package_name"] == "com.checkcoast.tenerife"
    assert link["target"]["sha256_cert_fingerprints"] == ["AA:BB"]

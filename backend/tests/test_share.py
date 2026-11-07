"""Tests de caracterización de las páginas públicas (`share.py`).

Fijan lo que ven los mensajeros y el navegador al abrir un enlace
compartido: código, cabeceras, Open Graph y escape de HTML de las
plantillas Jinja2."""

import io
import re
from datetime import datetime

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
    assert "De este emisario" in html
    assert "Rotura del emisario de Punta Share" in html
    assert "Test Press" in html
    assert "no implica" in html


def test_share_outfall_no_news_section(seed_data):
    # El outfall semilla no es residual → la landing no lleva sección
    html = client.get(f"/o/{seed_data['outfall_id']}").text
    assert "En la prensa" not in html


@pytest.fixture
def make_outfall():
    """Emisario residual parametrizable + noticias opcionales.

    `news` = lista de kwargs para NewsItem; `infra_outfall_id="self"`
    se resuelve al id del emisario creado. `**kw` se pasa al Outfall
    (nature, kind, shore_m, outfall_depth, origin…).
    """
    created = 0

    def _make(news=None, **kw):
        nonlocal created
        created += 1
        from app.db import SessionLocal
        from app.models import NewsItem, Outfall, OutfallStatus

        with SessionLocal() as db:
            o = Outfall(
                external_id=f"ci-share-o-{created}",
                name="Emisario Submarino de Punta Share",
                municipality="Santa Cruz de Tenerife",
                status=OutfallStatus.legal,
                geom=WKTElement("POINT(-16.25 28.46)", srid=4326),
                **{"nature": "Agua residual urbana", **kw},
            )
            db.add(o)
            db.flush()
            for i, nk in enumerate(news or []):
                nk = {k: (o.id if v == "self" else v) for k, v in nk.items()}
                db.add(
                    NewsItem(
                        url=(f"https://news.example/pytest-share-{o.id}-{i}"),
                        source="Test Press",
                        relevant=True,
                        **nk,
                    )
                )
            db.commit()
            return o.id

    yield _make
    from app.db import SessionLocal
    from app.models import NewsItem, Outfall

    with SessionLocal() as db:
        db.query(NewsItem).filter(
            NewsItem.url.like("%pytest-share-%")
        ).delete()
        db.query(Outfall).filter(
            Outfall.external_id.like("ci-share-o-%")
        ).delete()
        db.commit()


def test_share_outfall_kpi_tiles(make_outfall):
    """Orilla + profundidad sumergida → tiles KPI sustituyen a la
    frase narrativa (el dato no se enseña dos veces)."""
    oid = make_outfall(
        kind="Emisario submarino", shore_m=922, outfall_depth=-41
    )
    html = client.get(f"/o/{oid}").text
    # tiles estilo app: lead "vierte a" por tile, "bajo el mar" como
    # etiqueta de la sumergida
    assert "vierte a" in html
    assert "922 m" in html and "de la orilla" in html
    assert "41 m" in html and "bajo el mar" in html
    # la frase espejo no se renderiza en modo tiles
    assert "que vierte a" not in html


def test_share_outfall_kpi_surface_tile(make_outfall):
    """Vertido a ras de mar (depth=0): lleva tile '0 m / a ras de
    mar' — la gramática numérica se mantiene sin fingir una
    profundidad (misma regla que la app)."""
    oid = make_outfall(kind="Emisario submarino", shore_m=100, outfall_depth=0)
    html = client.get(f"/o/{oid}").text
    assert "0 m" in html and "a ras de mar" in html
    assert "que vierte a" not in html


def test_share_outfall_kpi_height(make_outfall):
    """Desemboca elevado (depth>0): la altura va en tile honesta —
    '20 m sobre el mar', no una profundidad inventada."""
    oid = make_outfall(kind="Conducción", shore_m=300, outfall_depth=20)
    html = client.get(f"/o/{oid}").text
    assert "vierte a" in html
    assert "20 m" in html and "sobre el mar" in html
    assert "cae sobre la superficie" not in html


def test_share_outfall_fact_lead_and_dup(make_outfall):
    """El hecho de infra va de lead sobre el titular; si el hecho ES
    el titular no se escribe dos veces."""
    oid = make_outfall(
        news=[
            dict(
                title="Licitado el arreglo urgente en Punta Share",
                infra_outfall_id="self",
                infra_cause="fisura del emisario",
                published_at=datetime(2026, 5, 28),
            ),
            dict(
                title="Rotura del emisario de Punta Share",
                infra_outfall_id="self",
                infra_cause="rotura del emisario",
                published_at=datetime(2026, 5, 27),
            ),
        ]
    )
    html = client.get(f"/o/{oid}").text
    # hecho ≠ titular → lead + titular
    assert "fisura del emisario" in html
    assert "Licitado el arreglo urgente en Punta Share" in html
    # hecho == titular → el texto solo aparece una vez
    assert html.count("Rotura del emisario") == 1


def test_share_outfall_two_per_family(make_outfall):
    """Máx. 2 fuentes visibles por familia + 'Ver N más' con el
    resto; la cabecera cuenta todas las de este punto."""
    news = [
        dict(
            title=f"Vertido en Punta Share, pieza {i}",
            infra_cause="vertido de aguas residuales",
            published_at=datetime(2026, 5, 10 + i),
        )
        for i in range(4)
    ]
    for nk in news:
        nk["infra_outfall_id"] = "self"
    oid = make_outfall(news=news)
    html = client.get(f"/o/{oid}").text
    assert re.search(r"· 4\s*noticias", html)
    assert re.search(r"Ver\s+2\s+más", html)
    assert "Vertidos" in html
    # disclaimer editorial al pie de la card
    assert "la proximidad no implica causalidad" in html


def test_share_outfall_zone_news(make_outfall, seed_data):
    """Cuerpo escaneado sin punto concreto + titular de infra →
    'En la zona' como contexto, nunca 'De este emisario'."""
    oid = make_outfall(
        news=[
            dict(
                title="Rotura de un emisario en el norte de Tenerife",
                beach_id=seed_data["beach_id"],
                infra_checked_at=datetime(2026, 5, 20),
                published_at=datetime(2026, 5, 19),
            )
        ]
    )
    html = client.get(f"/o/{oid}").text
    assert "En la zona" in html
    assert "Rotura de un emisario en el norte de Tenerife" in html
    assert "De este emisario" not in html


def test_share_outfall_excludes_other_named(make_outfall, seed_data):
    """Una noticia atribuida a OTRO punto no aparece en esta ficha
    aunque la playa casada esté cerca — cada ficha habla de lo suyo."""
    own = make_outfall()
    other = make_outfall()
    from app.db import SessionLocal
    from app.models import NewsItem

    with SessionLocal() as db:
        db.add(
            NewsItem(
                url="https://news.example/pytest-share-other-1",
                title="Rotura del emisario de Punta Ajena",
                source="Test Press",
                relevant=True,
                beach_id=seed_data["beach_id"],
                infra_outfall_id=other,
                published_at=datetime(2026, 5, 15),
            )
        )
        db.commit()
    html_own = client.get(f"/o/{own}").text
    assert "Rotura del emisario de Punta Ajena" not in html_own
    html_other = client.get(f"/o/{other}").text
    assert "Rotura del emisario de Punta Ajena" in html_other


def test_share_outfall_nature_lead(make_outfall):
    """Una sola sustancia → lead comunicativo 'Depuradora: vierte X',
    sin titular gigante ni 'Depuradora' repetido."""
    oid = make_outfall(origin="EDAR PUNTA SHARE")
    html = client.get(f"/o/{oid}").text
    assert "Depuradora" in html
    assert "vierte" in html
    assert "agua residual urbana" in html
    assert 'class="hval"' not in html


def test_share_outfall_nature_multipart(make_outfall):
    """Dos sustancias → desglose por líneas (formato hval/hnote),
    no el lead único."""
    oid = make_outfall(
        nature="Agua residual urbana + salmuera", origin="EDAR X + EDAM Y"
    )
    html = client.get(f"/o/{oid}").text
    assert 'class="hval"' in html
    assert "salmuera" in html


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


def test_home_legend_closure_causes():
    # Las 3 causas de cierre llevan etiqueta propia (.ldt — el CSS
    # las muestra solo en móvil) + el hint de capas por defecto
    html = client.get("/").text
    assert 'class="lrow lrow-b"' in html
    for cause in ("contaminación", "fauna marina", "desprendimientos"):
        assert f"Cerrada · {cause}" in html
    assert "Solo alertas por defecto" in html


def test_home_structure():
    # L7 — smoke estructural de la home: anclas estables (ids,
    # textos de sección, vars JS) que un ajuste visual no rompe
    html = client.get("/").text
    # La tira de estado: frase + buscador con su desplegable
    assert 'class="stat"' in html and 'class="stxt"' in html
    assert 'id="bq"' in html and 'id="bres"' in html
    # Mapa interactivo y sus datos de pines
    assert 'id="lmap"' in html and "window.MAP_DOTS" in html
    # Secciones siempre presentes + CTA de descarga
    for sec in (
        "Cómo funciona",
        "Llévala en el bolsillo",
        "Descargar para Android",
    ):
        assert sec in html
    assert "/img/qr-github.png" in html


def test_home_stat_strip_never_zero():
    # La frase de estado filtra los segmentos a cero — nunca pinta
    # un «0» como contador, haya o no haya incidencias ambientales
    html = client.get("/").text
    stxt = re.search(r'class="stxt">(.*?)</span>', html, re.S)
    assert stxt, "falta la frase de estado"
    assert not re.search(r">\s*0\s*<", stxt.group(1))


def test_home_stat_strip_counts_closure(seed_data):
    # Un cierre oficial se refleja en la frase («N cerradas») —
    # vale en CI (BD vacía + seed) y en local (datos reales: ya
    # habrá cerradas, el assert sigue cumpliéndose)
    from app.db import SessionLocal
    from app.models import BeachState, BeachStatus

    with SessionLocal() as db:
        db.add(
            BeachStatus(
                beach_id=seed_data["beach_id"], status=BeachState.closed
            )
        )
        db.commit()
        try:
            html = client.get("/").text
        finally:
            db.query(BeachStatus).filter(
                BeachStatus.beach_id == seed_data["beach_id"],
                BeachStatus.status == BeachState.closed,
            ).delete()
            db.commit()
    stxt = re.search(r'class="stxt">(.*?)</span>', html, re.S)
    assert "cerrada" in stxt.group(1)


def test_robots_and_sitemap(seed_data):
    # Indexación: rastreo libre + sitemap con portada y las fichas
    r = client.get("/robots.txt")
    assert r.status_code == 200
    assert "Allow: /" in r.text and "sitemap.xml" in r.text

    r = client.get("/sitemap.xml")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/xml")
    assert "<urlset" in r.text
    assert f"/b/{seed_data['beach_id']}" in r.text
    assert f"/o/{seed_data['outfall_id']}" in r.text


def test_beach_sheet_satellite_starts_mid(seed_data):
    # La ficha abre en el nivel medio de zoom — ni el más lejano
    # ni el más pegado; los otros dos niveles van ocultos
    html = client.get(f"/b/{seed_data['beach_id']}").text
    assert "var z = 1;" in html
    assert 'id="dots-1" class=""' in html
    assert 'id="dots-0" class="hidden"' in html
    assert 'id="dots-2" class="hidden"' in html


def test_outfall_sheet_satellite_starts_far(seed_data):
    # El emisario sigue abriendo en el nivel más lejano — el cambio
    # de nivel inicial fue solo para playas
    html = client.get(f"/o/{seed_data['outfall_id']}").text
    assert "var z = 2;" in html


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

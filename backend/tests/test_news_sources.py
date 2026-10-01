"""Tests de las fuentes de prensa: sitemap de Guía Islas Canarias y
feeds municipales."""

import requests

from app import news_sources
from app.news_sources import (
    GUIA_SOURCE,
    fetch_guia_sitemap,
    fetch_municipal_feeds,
)

SITEMAP_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://guiaislascanarias.com/tenerife/playa-de-benijo/</loc>
    <lastmod>2026-09-17T00:00:00.000Z</lastmod>
  </url>
  <url>
    <loc>https://guiaislascanarias.com/tenerife/playa-del-socorro/</loc>
    <lastmod>2026-08-01T12:30:00.000Z</lastmod>
  </url>
  <url>
    <loc>https://guiaislascanarias.com/tenerife/guia-parque-nacional-teide/</loc>
    <lastmod>2025-03-21T00:00:00.000Z</lastmod>
  </url>
  <url>
    <loc>https://guiaislascanarias.com/gran-canaria/playa-del-ingles/</loc>
    <lastmod>2026-01-01T00:00:00.000Z</lastmod>
  </url>
  <url>
    <loc>https://guiaislascanarias.com/tenerife/playa-sin-lastmod/</loc>
  </url>
</urlset>
"""


class FakeResp:
    content = SITEMAP_XML

    def raise_for_status(self):
        pass


def test_guia_sitemap_filters_tenerife_beach_guides(monkeypatch):
    """Solo entran las fichas de playa de Tenerife; cada una con su
    lastmod parseado (las sin lastmod pasan con None)."""
    monkeypatch.setattr(
        requests, "get", lambda *a, **k: FakeResp()
    )
    pages = dict(fetch_guia_sitemap())
    urls = set(pages)
    assert "https://guiaislascanarias.com/tenerife/playa-de-benijo/" in urls
    assert (
        "https://guiaislascanarias.com/tenerife/playa-del-socorro/"
        in urls
    )
    # ni otras islas ni páginas que no son fichas de playa
    assert not any("gran-canaria" in u for u in urls)
    assert not any("teide" in u for u in urls)
    benijo_mod = pages[
        "https://guiaislascanarias.com/tenerife/playa-de-benijo/"
    ]
    assert benijo_mod.year == 2026 and benijo_mod.month == 9
    # sin lastmod → None (la ingesta las ignora: no puede dedup)
    assert (
        pages["https://guiaislascanarias.com/tenerife/playa-sin-lastmod/"]
        is None
    )


def test_guia_source_name():
    assert GUIA_SOURCE == "Guía Islas Canarias"


MUNI_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>Suspendido el baño en la piscina de El Pris por vertido</title>
    <link>https://ejemplo.es/noticia-cierre</link>
    <pubDate>Tue, 14 Oct 2025 10:00:00 +0000</pubDate>
  </item>
  <item>
    <title>Fiestas del Cristo congregan a un millar de personas</title>
    <link>https://ejemplo.es/noticia-fiestas</link>
    <pubDate>Tue, 14 Oct 2025 09:00:00 +0000</pubDate>
  </item>
</channel></rss>
""".encode()


class FakeMuniResp:
    content = MUNI_RSS

    def raise_for_status(self):
        pass


def test_municipal_feeds_prefilter(monkeypatch):
    """Solo los titulares de playa/mar/baño llegan a la ingesta — el
    resto del feed municipal (fiestas, deportes) no gasta Gemini."""
    monkeypatch.setattr(
        news_sources,
        "MUNICIPAL_FEEDS",
        {"Ayto. Prueba": "https://ejemplo.es/feed/"},
    )
    monkeypatch.setattr(news_sources, "MEDIA_FEEDS", {})
    monkeypatch.setattr(requests, "get", lambda *a, **k: FakeMuniResp())
    arts = fetch_municipal_feeds()
    assert len(arts) == 1
    assert arts[0].source == "Ayto. Prueba"
    assert "piscina" in arts[0].title.lower()
    assert arts[0].published_at is not None


def test_municipal_feeds_dead_feed_no_abort(monkeypatch):
    """Un feed caído no aborta: se omite y se siguen los demás."""
    monkeypatch.setattr(
        news_sources,
        "MUNICIPAL_FEEDS",
        {
            "Caído": "https://caido.es/feed/",
            "Vivo": "https://ejemplo.es/feed/",
        },
    )
    monkeypatch.setattr(news_sources, "MEDIA_FEEDS", {})

    def fake_get(url, *a, **k):
        if "caido" in url:
            raise requests.ConnectionError("down")
        return FakeMuniResp()

    monkeypatch.setattr(requests, "get", fake_get)
    arts = fetch_municipal_feeds()
    assert len(arts) == 1
    assert arts[0].source == "Vivo"

"""Tests de las fuentes de prensa: sitemap de Guía Islas Canarias."""

import requests

from app import news_sources
from app.news_sources import GUIA_SOURCE, fetch_guia_sitemap

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

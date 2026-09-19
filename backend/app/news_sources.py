"""Fuentes de noticias de prensa sobre playas de Tenerife (Hito 8.5).

Fuente primaria: RSS de búsqueda de Google News, que agrega la prensa
canaria indexada (Eldía, Diario de Avisos, Canarias7, elDiario.es,
Atlántico Hoy...) y también comunicados oficiales publicados en web
(ayuntamientos, Gobierno de Canarias). Los enlaces son redirects de
Google News; el medio real va en `source`.

GDELT quedó descartado en el spike: rate limit persistente y su índice
de la DOC API busca sobre traducciones automáticas al inglés, no el
texto original en español.

Feeds por cabecera verificados como respaldo (mismo formato RawArticle):
Diario de Avisos `/feed/`, Canarias7 `/rss/2.0/?section=/canarias/tenerife`.
"""

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime
from email.utils import parsedate_to_datetime

import requests

GNEWS_URL = "https://news.google.com/rss/search"
USER_AGENT = "CheckCoastBot/0.1 (civic data ingestion; contact: local dev)"

# Playa + evento adverso, acotado a Tenerife
QUERY = (
    'playa tenerife (vertido OR prohibido OR cierre OR "calidad del agua" '
    "OR contaminada OR fecales)"
)

# Medios descartados a priori (ruido conocido, no aportan eventos)
EXCLUDED_SOURCES = {
    "teneriffa news",  # SEO-farm: ficha templada diaria por playa
}


@dataclass
class RawArticle:
    title: str
    url: str
    source: str | None
    published_at: datetime | None


def _clean_title(title: str) -> str:
    """Google News añade ' - Medio' al final del titular."""
    return title.rsplit(" - ", 1)[0] if " - " in title else title


def fetch_google_news(query: str = QUERY) -> list[RawArticle]:
    """Titulares recientes del feed de búsqueda de Google News."""
    resp = requests.get(
        GNEWS_URL,
        params={"q": query, "hl": "es", "gl": "ES", "ceid": "ES:es"},
        headers={"User-Agent": USER_AGENT},
        timeout=30,
    )
    resp.raise_for_status()
    root = ET.fromstring(resp.content)
    articles = []
    for item in root.findall(".//item"):
        source_el = item.find("source")
        pub = item.findtext("pubDate")
        try:
            published = parsedate_to_datetime(pub) if pub else None
        except (TypeError, ValueError):
            published = None
        articles.append(
            RawArticle(
                title=_clean_title(item.findtext("title") or "").strip(),
                url=item.findtext("link") or "",
                source=source_el.text if source_el is not None else None,
                published_at=published,
            )
        )
    return articles

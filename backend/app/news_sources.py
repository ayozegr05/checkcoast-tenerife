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

import html
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime
from email.utils import parsedate_to_datetime

import requests

GNEWS_URL = "https://news.google.com/rss/search"
USER_AGENT = "CheckCoastBot/0.1 (civic data ingestion; contact: local dev)"

# Playa + evento adverso, acotado a Tenerife. Google News no hace
# stemming ("cierre" no casa "cerrada"), así que van varias queries
# temáticas; dedup por URL aguas abajo.
QUERIES = [
    # contaminación / calidad del agua
    'playa tenerife (vertido OR contaminada OR fecales OR '
    '"calidad del agua" OR algas OR gasoil)',
    # cierres y reaperturas
    'playa tenerife (cerrada OR cerrado OR cierre OR prohibido OR '
    'prohibición OR reabierta OR reapertura OR clausurada)',
    # obras / riesgo físico (talud, desprendimientos, derrumbes)
    'playa tenerife (obras OR desprendimiento OR talud OR ladera OR '
    'seguridad OR derrumbe OR socavón OR colapso)',
]

# Medios descartados a priori (ruido conocido, no aportan eventos).
# Substrings en minúsculas: el <source> de Google News llega en
# variantes ("Teneriffa News", "teneriffa-news.com")
EXCLUDED_SOURCES = {
    "teneriffa",  # SEO-farm: ficha templada diaria por playa
    # auditado 2026-09-30 — ajenos al dominio playas/baño
    "radio europa",      # radio en alemán para residentes
    "caribbean news",    # revista de turismo
    "seguritecnia",      # revista del sector seguridad
    "canarias-semanal",  # semanario político
    "san borondon",      # hiperlocal de La Palma
}


def source_excluded(source: str | None) -> bool:
    s = (source or "").strip().lower()
    return any(x in s for x in EXCLUDED_SOURCES)


# Webs municipales y oficiales: fuente primaria — muchos avisos de
# playa solo se publican ahí y nunca los agrega Google News (El Pris,
# El Bobo...). Puerto de la Cruz tiene los feeds desactivados a
# propósito ("No feed available") y adeje.es anuncia cierres solo en
# redes. Sin feed localizado (sondeado 2026-09-30): Arona,
# Los Realejos, Garachico, Guía de Isora, Arafo, Arico, La Matanza.
# El Rosario encontrado 2026-10-02 (feed bajo /index.php/feed/).
MUNICIPAL_FEEDS = {
    "Ayto. Tacoronte": "https://www.tacoronte.es/feed/",
    "Ayto. Candelaria": "https://www.candelaria.es/feed/",
    "Ayto. La Laguna": "https://lalagunaahora.com/feed/",
    "Ayto. Granadilla": "https://www.granadilladeabona.org/feed/",
    "Ayto. Icod": "https://www.icoddelosvinos.es/feed/",
    "Ayto. Santa Úrsula": "https://www.santaursula.es/feed/",
    "Ayto. San Miguel": "https://www.sanmigueldeabona.es/feed/",
    "Ayto. Buenavista": "https://www.buenavistadelnorte.es/feed/",
    "Ayto. Fasnia": "https://www.fasnia.com/feed/",
    "Ayto. La Victoria": "https://www.lavictoriadeacentejo.es/feed/",
    "Ayto. Güímar": "https://www.guimar.es/rss.xml",
    # WordPress con permalinks index.php: el feed cuelga de ahí
    "Ayto. El Rosario": "https://www.ayuntamientoelrosario.org/index.php/feed/",
    "Ayto. Santiago del Teide": "https://www.santiagodelteide.es/feed/",
    "Ayto. El Sauzal": "https://www.elsauzal.es/feed/",
    "Ayto. La Orotava": "https://www.laorotava.es/rss.xml",
    # Notas de prensa del Gobierno de Canarias (~50 ítems, insular) —
    # el prefiltro léxico deja pasar solo lo de costa/baño
    "Gobierno de Canarias": "https://www.gobiernodecanarias.org/noticias/feed/",
    # Prensa hiperlocal del Valle de Güímar (Candelaria, Arafo, Güímar,
    # Fasnia): cubre avisos que no indexa Google News (sus artículos ni
    # siquiera nombran "Tenerife") — caso Punta Larga, cierre por
    # socavón bajo el paseo (may-2026) que la ingesta perdió
    "Valle de Güímar": "https://valledeguimar.es/feed/",
}

# Feeds directos de medios serios: quita la dependencia de que Google
# News priorice la pieza (caso Puertito: reaperturas del 9-may y 6-jun
# 2025 cubiertas por 3-4 medios que nunca entraron en el RSS de Google).
# Mismo prefiltro léxico que los municipales — son feeds de sección.
MEDIA_FEEDS = {
    "Diario de Avisos": "https://diariodeavisos.elespanol.com/tenerife/feed/",
    "Canarias7": "https://canarias7.es/rss/2.0/?section=/canarias/tenerife",
    "Europa Press": "https://www.europapress.es/rss/rss.aspx?ch=287",
}

# Prefiltro por titular: el feed municipal es ~95% fiestas, deportes y
# plenos — solo lo que hable de playa/mar/baño gasta una llamada a
# Gemini. Ajustado al vocabulario real de los avisos municipales
# ("suspende el baño", "vertido", "piscina natural", "costero").
_MUNI_BEACHY_RE = re.compile(
    r"playa|bañ|piscina|vertido|aguas? (?:residuales|fecales)|"
    r"calidad del agua|fecal|oleaje|mar agitado|litoral|costero",
    re.IGNORECASE,
)

_XML_ENTITIES = {"amp", "lt", "gt", "quot", "apos"}


def _fix_named_entities(text: str) -> str:
    """Convierte entidades HTML con nombre (&uuml;) a literales.

    Algunos WordPress (p.ej. valledeguimar.es) emiten RSS con entidades
    que no existen en XML — ElementTree aborta la pasada entera si no
    se sanea. Las cinco entidades XML reales se respetan."""
    return re.sub(
        r"&([a-zA-Z]+);",
        lambda m: (
            m.group(0)
            if m.group(1) in _XML_ENTITIES
            else html.unescape(m.group(0))
        ),
        text,
    )


# Guía Islas Canarias: fichas evergreen por playa (sitio Astro, sin
# RSS). No son noticias de última hora — son páginas mantenidas que
# afirman el estado real ("acceso cerrado desde julio de 2024"). El
# sitemap expone `lastmod` por URL: solo se re-extrae una guía cuando
# su ficha cambió, y nunca despiertan push (contexto, no noticia)
GUIA_SITEMAP_URL = "https://guiaislascanarias.com/sitemap-0.xml"
GUIA_SOURCE = "Guía Islas Canarias"
_GUIA_PLAYA_RE = re.compile(r"/tenerife/playa")
_TITLE_RE = re.compile(r"<title[^>]*>([^<]+)</title>", re.IGNORECASE)


def fetch_guia_sitemap() -> list[tuple[str, datetime | None]]:
    """(url, lastmod) de las guías de playa de Tenerife del sitemap."""
    resp = requests.get(
        GUIA_SITEMAP_URL, headers={"User-Agent": USER_AGENT}, timeout=30
    )
    resp.raise_for_status()
    root = ET.fromstring(resp.content)
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    out: list[tuple[str, datetime | None]] = []
    for u in root.findall("sm:url", ns):
        loc = u.findtext("sm:loc", namespaces=ns)
        if not loc or not _GUIA_PLAYA_RE.search(loc):
            continue
        raw = u.findtext("sm:lastmod", namespaces=ns)
        try:
            mod = (
                datetime.fromisoformat(raw.replace("Z", "+00:00"))
                if raw
                else None
            )
        except ValueError:
            mod = None
        out.append((loc, mod))
    return out


def fetch_guia_page(url: str) -> tuple[str, str] | None:
    """(título, cuerpo) de una ficha de guía. El título es parte de la
    información ("Playa de Benijo (Tenerife): Acceso Cerrado")."""
    from curl_cffi import requests as creq

    try:
        r = creq.get(url, impersonate="chrome", timeout=15)
        if not r.ok:
            return None
    except Exception:
        return None
    import trafilatura

    body = trafilatura.extract(r.text)
    if not body:
        return None
    m = _TITLE_RE.search(r.text)
    title = m.group(1).split("|")[0].strip() if m else url
    return title, body.strip()


@dataclass
class RawArticle:
    title: str
    url: str
    source: str | None
    published_at: datetime | None
    # Cuerpo del artículo, solo en la segunda pasada híbrida
    # (resolve_url + fetch_article_body de news_resolve)
    body: str | None = None


def _clean_title(title: str) -> str:
    """Google News añade ' - Medio' al final del titular."""
    return title.rsplit(" - ", 1)[0] if " - " in title else title


def fetch_news() -> list[RawArticle]:
    """Titulares de todas las queries temáticas + feeds municipales,
    deduplicados por URL."""
    seen: set[str] = set()
    articles = []
    for query in QUERIES:
        for a in fetch_google_news(query):
            if a.url and a.url not in seen:
                seen.add(a.url)
                articles.append(a)
    for a in fetch_municipal_feeds():
        if a.url and a.url not in seen:
            seen.add(a.url)
            articles.append(a)
    return articles


def fetch_municipal_feeds() -> list[RawArticle]:
    """Entradas de playa de los RSS municipales/oficiales y de medios.

    Los feeds traen los últimos ~10-20 posts: cobertura hacia adelante,
    no histórico. El titular pasa un prefiltro léxico — sin él cada
    pasada gastaría cuota de Gemini en fiestas y deportes. Un feed
    caído no aborta el resto."""
    articles = []
    feeds = {**MUNICIPAL_FEEDS, **MEDIA_FEEDS}
    for source, feed_url in feeds.items():
        try:
            try:
                resp = requests.get(
                    feed_url, headers={"User-Agent": USER_AGENT}, timeout=30
                )
            except requests.exceptions.SSLError:
                # cert autofirmado o cadena incompleta (Buenavista, Fasnia)
                resp = requests.get(
                    feed_url, headers={"User-Agent": USER_AGENT},
                    timeout=30, verify=False,
                )
            resp.raise_for_status()
            raw = resp.content
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8-sig", "replace")
            # algunos feeds llevan BOM, líneas en blanco o comentarios
            # HTML de debug antes del <?xml (El Sauzal, La Orotava)
            start = re.search(r"<\?xml|<rss|<feed", raw)
            if start is None:
                continue
            root = ET.fromstring(_fix_named_entities(raw[start.start():]))
        except Exception:
            continue
        for item in root.findall(".//item"):
            title = (item.findtext("title") or "").strip()
            if not _MUNI_BEACHY_RE.search(title):
                continue
            pub = item.findtext("pubDate")
            try:
                published = parsedate_to_datetime(pub) if pub else None
            except (TypeError, ValueError):
                published = None
            articles.append(
                RawArticle(
                    title=title,
                    url=item.findtext("link") or "",
                    source=source,
                    published_at=published,
                )
            )
    return articles


def fetch_google_news(query: str) -> list[RawArticle]:
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

"""URL editorial + cuerpo de una noticia (segunda pasada híbrida).

Los <link> del RSS de Google News son interstitials, no el artículo.
La URL real se recupera decodificando el id del artículo:

1. GET /rss/articles/{id}?ucbcb=1&hl=en-US&gl=US — página intermedia
   que lleva la firma+timestamp del decode (`data-n-a-sg`/`data-n-a-ts`)
2. POST batchexecute (RPC interno "garturlreq") → URL del medio
3. GET del artículo → cuerpo con trafilatura (fallback: meta/og
   description, que suelen traer la entradilla)

Los dos pasos necesitan fingerprint de navegador: requests/httpx plano
recibe el consent wall de Google según la IP — `curl_cffi` con
impersonate="chrome" lo evita. Es RPC no documentado: si Google lo
cambia devuelve None y la ingesta sigue funcionando solo con titulares.
"""

import base64
import json
import re
from urllib.parse import quote, urlparse

from curl_cffi import requests as creq

_ARTICLE_PAGE = (
    "https://news.google.com/rss/articles/{}"
    "?ucbcb=1&hl=en-US&gl=US&ceid=US:en"
)
_BATCHEXECUTE = "https://news.google.com/_/DotsSplashUi/data/batchexecute"
_GN_HOST = "news.google.com"

_SIG_RE = re.compile(r'data-n-a-sg="([^"]+)"')
_TS_RE = re.compile(r'data-n-a-ts="([^"]+)"')
# URL vieja embebida en el protobuf del id (formato pre-AU_yqL)
_INLINE_URL_RE = re.compile(rb"https?://[^\x00-\x20\xd2]+")
_META_DESC_RE = (
    re.compile(
        r'<meta[^>]+(?:name|property)=["\'](?:description|og:description)["\']'
        r'[^>]+content=["\']([^"\']+)',
        re.IGNORECASE,
    ),
    re.compile(
        r'content=["\']([^"\']+)["\'][^>]+'
        r'(?:name|property)=["\'](?:description|og:description)["\']',
        re.IGNORECASE,
    ),
)

# Contexto fijo del RPC garturlreq (campos "X" sin uso real en la
# respuesta; lo que manda es el id + timestamp + firma)
_GARTURLREQ_CTX = [
    ["X", "X", ["X", "X"], None, None, 1, 1, "US:en", None, 1, None,
     None, None, None, None, 0, 1],
    "X", "X", 1, [1, 1, 1], 1, 1, None, 0, 0, None, 0,
]


def _article_id(url: str) -> str | None:
    """Id del artículo en una URL de Google News; None si no lo es."""
    try:
        p = urlparse(url)
        parts = p.path.split("/")
        if (
            p.hostname == _GN_HOST
            and len(parts) > 1
            and parts[-2] in ("articles", "read")
        ):
            return parts[-1] or None
    except Exception:
        pass
    return None


def _decoded(text: str) -> str | None:
    """URL editorial dentro de la respuesta batchexecute."""
    body = text.split("\n\n", 1)[-1].lstrip()
    if body.startswith(")]}'"):
        body = body.split("\n", 1)[-1].lstrip()
    try:
        rows = json.loads(body)
    except ValueError:
        return None
    for row in rows or []:
        try:
            payload = json.loads(row[2])
        except (IndexError, TypeError, ValueError):
            continue
        url = _find_url(payload)
        if url:
            return url
    return None


def _find_url(node) -> str | None:
    if isinstance(node, str):
        if node.startswith("http") and _GN_HOST not in node:
            return node
        return None
    if isinstance(node, list):
        for x in node:
            url = _find_url(x)
            if url:
                return url
    return None


def resolve_url(url: str) -> str | None:
    """URL de Google News → URL del medio. URLs que ya son del medio
    (feeds por cabecera) pasan tal cual. None si el decode falla."""
    art = _article_id(url)
    if art is None:
        return url or None
    try:
        raw = base64.urlsafe_b64decode(art + "=" * (-len(art) % 4))
        m = _INLINE_URL_RE.search(raw)
        if m:
            return m.group(0).decode("utf-8", "replace")
    except Exception:
        pass
    try:
        page = creq.get(_ARTICLE_PAGE.format(art), impersonate="chrome",
                        timeout=15)
        sig = _SIG_RE.search(page.text)
        ts = _TS_RE.search(page.text)
        if not (sig and ts):
            return None
        inner = json.dumps(
            ["garturlreq", _GARTURLREQ_CTX, art, int(ts.group(1)),
             sig.group(1)],
            separators=(",", ":"),
        )
        body = "f.req=" + quote(
            json.dumps([[["Fbv4je", inner, None, "0"]]],
                       separators=(",", ":"))
        )
        r = creq.post(
            _BATCHEXECUTE,
            data=body,
            headers={
                "Content-Type":
                "application/x-www-form-urlencoded;charset=UTF-8"
            },
            impersonate="chrome",
            timeout=15,
        )
        return _decoded(r.text)
    except Exception:
        return None


def fetch_article_body(url: str, max_chars: int = 3000) -> str | None:
    """Cuerpo en texto plano del artículo, truncado. None si no se
    pudo descargar o no hay texto extraíble (paywall duro, etc.)."""
    try:
        r = creq.get(url, impersonate="chrome", timeout=15)
        if not r.ok:
            return None
    except Exception:
        return None
    import trafilatura

    text = trafilatura.extract(r.text)
    if not text:
        for rx in _META_DESC_RE:
            m = rx.search(r.text)
            if m:
                text = m.group(1)
                break
    if not text:
        return None
    return text.strip()[:max_chars]


def resolve_and_fetch(url: str) -> str | None:
    """Atajo para la segunda pasada: URL (de Google News o directa) →
    cuerpo del artículo."""
    real = resolve_url(url)
    return fetch_article_body(real) if real else None

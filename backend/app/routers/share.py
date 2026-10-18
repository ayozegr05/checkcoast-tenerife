"""Mini página pública por playa para compartir (WhatsApp/Telegram).

Sirve HTML con Open Graph (título, estado, foto satélite Esri) para que
los mensajeros generen la tarjeta rica; en el navegador muestra una
mini-ficha — réplica web de la ficha de la app — con enlace profundo
`checkcoast://beach/{id}`.

Toda la presentación (formato de nombres, chips de estado, encuadres
satélite, tarjetas, banner de prensa, imagen OG) vive en
`app/share_context.py` — este módulo solo orquesta: query, 404, página.
"""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse, Response
from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import Beach, Outfall
from app.queries import effective_states
from app.share_context import (
    _OUTFALL_PIN,
    _OUTFALL_STATUS,
    _STATUS,
    _display_state,
    _og_card,
    _og_png,
    beach_context,
    beach_row,
    home_context,
    outfall_context,
    outfall_row,
)

router = APIRouter(tags=["share"])

_ANDROID_PACKAGE = "com.checkcoast.tenerife"

_TEMPLATES = Path(__file__).resolve().parent.parent / "templates"
# Autoescape on: los {{ var }} ya no necesitan html.escape manual
_jinja = Environment(
    loader=FileSystemLoader(_TEMPLATES), autoescape=select_autoescape()
)


def _page(template: str, **ctx) -> HTMLResponse:
    # no-cache: el HTML se revalida siempre (los navegadores cacheaban la
    # landing y se veían versiones viejas tras cada despliegue)
    return HTMLResponse(
        content=_jinja.get_template(template).render(**ctx),
        headers={"Cache-Control": "no-cache"},
    )


@router.get("/.well-known/assetlinks.json")
def assetlinks() -> list[dict]:
    """Declaración Android App Links: qué app firmada puede abrir
    https://<dominio>/b/{id}. Vacío hasta configurar
    ANDROID_CERT_SHA256 con el fingerprint del keystore de EAS."""
    if not settings.android_cert_sha256:
        return []
    return [
        {
            "relation": ["delegate_permission/common.handle_all_urls"],
            "target": {
                "namespace": "android_app",
                "package_name": _ANDROID_PACKAGE,
                "sha256_cert_fingerprints": [settings.android_cert_sha256],
            },
        }
    ]


_og_cache: dict[tuple[int, str], bytes] = {}


@router.get("/b/{beach_id}/og.jpg")
def share_og(beach_id: int, db: Session = Depends(get_db)) -> Response:
    """Imagen OG compuesta: lo que WhatsApp/Telegram enseñan en la
    tarjeta. Cacheada por (playa, estado) — regenera si cambia."""
    row = beach_row(db, beach_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Beach not found")
    beach, status, lon, lat = row
    # La og:image pinta el estado efectivo — la misma matriz que la
    # app, sin réplica a medias (antes contradecía /alerts: ignoraba
    # la supresión de oficial rezagado y la persistencia estructural)
    state = _display_state(effective_states(db).get(beach_id))
    key = (beach_id, state)
    if key not in _og_cache:
        # Tope al caché: playas × estados es acotado, pero un fetch a
        # ids inexistentes/rotación de estado podría inflarlo — LRU
        # burdo: a partir de 500 entradas se vacía y se regenera
        if len(_og_cache) >= 500:
            _og_cache.clear()
        label, color = _STATUS.get(state, _STATUS["unknown"])
        _og_cache[key] = _og_png(beach, lon, lat, state, label, color)
    return Response(
        content=_og_cache[key],
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get("/b/{beach_id}", response_class=HTMLResponse)
def share_beach(beach_id: int, db: Session = Depends(get_db)) -> HTMLResponse:
    """Landing compartible de una playa: OG para la tarjeta del
    mensajero + mini-ficha con deep-link a la app."""
    row = beach_row(db, beach_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Beach not found")
    beach, _status, lon, lat = row
    return _page("beach.html", **beach_context(db, beach, lon, lat))


_og_o_cache: dict[tuple[int, str], bytes] = {}


@router.get("/o/{outfall_id}/og.jpg")
def share_og_outfall(
    outfall_id: int, db: Session = Depends(get_db)
) -> Response:
    """og:image del emisario: foto satélite + pin + chip de
    legalidad — misma composición que la de playa."""
    row = outfall_row(db, outfall_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Outfall not found")
    outfall, lon, lat = row
    status = (
        outfall.status.value
        if hasattr(outfall.status, "value")
        else outfall.status
    )
    key = (outfall_id, status)
    if key not in _og_o_cache:
        if len(_og_o_cache) >= 500:
            _og_o_cache.clear()
        label, color = _OUTFALL_STATUS.get(status, _OUTFALL_STATUS["unknown"])
        _og_o_cache[key] = _og_card(
            outfall.name,
            f"{outfall.municipality or 'Tenerife'} · CheckCoast Tenerife",
            lon,
            lat,
            _OUTFALL_PIN.get(status, _OUTFALL_PIN["unknown"]),
            label,
            color,
        )
    return Response(
        content=_og_o_cache[key],
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get("/o/{outfall_id}", response_class=HTMLResponse)
def share_outfall(
    outfall_id: int, db: Session = Depends(get_db)
) -> HTMLResponse:
    """Ficha publica compartible de un emisario: replica web de la
    hoja de la app (legalidad, funcionamiento, que se vierte, playas
    cercanas enlazables a su /b/{id})."""
    row = outfall_row(db, outfall_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Outfall not found")
    outfall, lon, lat = row
    return _page("outfall.html", **outfall_context(db, outfall, lon, lat))


@router.get("/", response_class=HTMLResponse)
def home(db: Session = Depends(get_db), demo: bool = False) -> HTMLResponse:
    """Portada del proyecto: la puerta de entrada pública.

    Hero + mapa vivo de la isla + alertas reales + playas de ejemplo
    enlazables a su /b/{id} — la demo completa sin instalar nada.
    ?demo=1 fabrica alertas de todas las causas para previsualizar
    las secciones del banner (solo presentación, no toca datos)."""
    return _page("home.html", **home_context(db, demo=demo))


@router.get("/robots.txt", response_class=PlainTextResponse)
def robots() -> PlainTextResponse:
    """Rastreo libre + puntero al sitemap — indexación de la landing."""
    body = (
        "User-agent: *\n"
        "Allow: /\n\n"
        f"Sitemap: {settings.public_url}/sitemap.xml\n"
    )
    return PlainTextResponse(
        body,
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/sitemap.xml")
def sitemap(db: Session = Depends(get_db)) -> Response:
    """URLs indexables: portada + una landing por playa y por emisario."""
    base = settings.public_url.rstrip("/")
    locs = (
        [base]
        + [f"{base}/b/{i}" for (i,) in db.query(Beach.id).order_by(Beach.id)]
        + [
            f"{base}/o/{i}"
            for (i,) in db.query(Outfall.id).order_by(Outfall.id)
        ]
    )
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(f"  <url><loc>{loc}</loc></url>" for loc in locs)
        + "\n</urlset>\n"
    )
    return Response(
        content=xml,
        media_type="application/xml",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get("/privacy", response_class=HTMLResponse)
def privacy() -> HTMLResponse:
    """Política de privacidad — exigida por Play Store (push tokens)."""
    return HTMLResponse(
        content=_jinja.get_template("privacy.html").render(),
    )

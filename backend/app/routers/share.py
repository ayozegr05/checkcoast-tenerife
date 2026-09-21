"""Mini página pública por playa para compartir (WhatsApp/Telegram).

Sirve HTML con Open Graph (título, estado, foto satélite Esri) para que
los mensajeros generen la tarjeta rica; en el navegador muestra una
mini-ficha — réplica web de la ficha de la app — con enlace profundo
`checkcoast://beach/{id}`.
"""

import html

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy import func
from sqlalchemy.orm import Session
from geoalchemy2 import Geography

from app.db import get_db
from app.models import Beach, BeachMeasurement, NewsItem, Outfall
from app.queries import beaches_with_latest_status

router = APIRouter(tags=["share"])

# Encuadres como los zooms de SatelliteShot: cerca y lejos (640×300 px)
_SHOT_NEAR = (0.006, 0.0033)
_SHOT_FAR = (0.015, 0.0083)
_SHOT_W = 640
_SHOT_H = 300

# Mismos textos que la ficha de la app
_STATUS = {
    "closed": ("Cierre activo", "#c62828"),
    "warning": ("Aviso activo", "#e65100"),
    "open": ("Apta", "#0d9488"),
    "unknown": ("Sin datos oficiales", "#8fa3ad"),
}

_OUTFALL_STATUS = {
    "legal": ("Autorizado", "#2e9e6b"),
    "illegal": ("No autorizado", "#c62828"),
    "unknown": ("En trámite", "#e65100"),
}

# Mismos PNG que el mapa de la app (servidos desde /icons)
_PIN = {
    "closed": "pin-closed",
    "warning": "pin-warning",
    "open": "pin-open",
    "unknown": "pin-unmonitored",
}
_OUTFALL_PIN = {
    "legal": "pin-outfall-legal",
    "illegal": "pin-outfall-illegal",
    "unknown": "pin-outfall-processing",
}

_NEARBY_OUTFALL_RADIUS_M = 1000  # mismo radio que /beaches/{id}/nearby-outfalls


def _display_name(name: str) -> str:
    """'PLAYA DE LA VIUDA' -> 'Playa de la Viuda' (minúscula en
    artículos/preposiciones salvo al inicio)."""
    low = {"de", "del", "la", "el", "las", "los", "y", "en"}
    words = name.title().split()
    return " ".join(w if i == 0 or w.lower() not in low else w.lower()
                    for i, w in enumerate(words))


def _shot_url(lon: float, lat: float, dlon: float, dlat: float) -> str:
    return (
        "https://server.arcgisonline.com/ArcGIS/rest/services/"
        f"World_Imagery/MapServer/export?bbox={lon - dlon},"
        f"{lat - dlat},{lon + dlon},{lat + dlat}"
        "&bboxSR=4326&imageSR=4326&size=640,300&format=png&f=image"
    )


def _px(
    lon: float, lat: float, clon: float, clat: float,
    dlon: float, dlat: float,
) -> tuple[float, float]:
    """lon/lat → posición (x%, y%) dentro del recuadro satélite."""
    x = (lon - (clon - dlon)) / (2 * dlon) * 100
    y = ((clat + dlat) - lat) / (2 * dlat) * 100
    return x, y


def _dots(outfalls, lon: float, lat: float, dlon: float, dlat: float) -> str:
    """Pins de emisarios sobre la foto (mismos PNG que la app)."""
    return "".join(
        f'<img class="odot" style="left:{x:.1f}%;top:{y:.1f}%"'
        f' src="/icons/{_OUTFALL_PIN.get(o.status.value, _OUTFALL_PIN["unknown"])}.png"'
        f' title="{html.escape(o.name)}" alt="">'
        for o in outfalls
        for x, y in [_px(o.olon, o.olat, lon, lat, dlon, dlat)]
        if 0 <= x <= 100 and 0 <= y <= 100  # fuera del encuadre: no pintar
    )


@router.get("/b/{beach_id}", response_class=HTMLResponse)
def share_beach(beach_id: int, db: Session = Depends(get_db)) -> str:
    """Landing compartible de una playa: OG para la tarjeta del
    mensajero + mini-ficha con deep-link a la app."""
    row = (
        beaches_with_latest_status(db)
        .add_columns(
            func.ST_X(Beach.geom).label("lon"),
            func.ST_Y(Beach.geom).label("lat"),
        )
        .filter(Beach.id == beach_id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Beach not found")

    beach, status, lon, lat = row
    state = status.status.value if status else "unknown"
    label, color = _STATUS.get(state, _STATUS["unknown"])

    latest = (
        db.query(BeachMeasurement)
        .filter(BeachMeasurement.beach_id == beach.id)
        .order_by(BeachMeasurement.sampled_at.desc())
        .first()
    )
    outfalls = (
        db.query(
            Outfall.name,
            Outfall.status,
            func.ST_Distance(
                Beach.geom.cast(Geography), Outfall.geom.cast(Geography)
            ).label("distance_m"),
            func.ST_X(Outfall.geom).label("olon"),
            func.ST_Y(Outfall.geom).label("olat"),
        )
        .filter(Beach.id == beach.id)
        .filter(
            func.ST_DWithin(
                Beach.geom.cast(Geography),
                Outfall.geom.cast(Geography),
                _NEARBY_OUTFALL_RADIUS_M,
            )
        )
        .order_by("distance_m")
        .limit(5)
        .all()
    )
    news = (
        db.query(NewsItem)
        .filter(NewsItem.beach_id == beach.id, NewsItem.relevant.is_(True))
        .order_by(NewsItem.published_at.desc())
        .first()
    )

    name = html.escape(_display_name(beach.name))
    muni = html.escape(beach.municipality or "Tenerife")
    title = f"{name} · {muni}"
    desc = f"Estado: {label} — CheckCoast Tenerife"
    img_far = html.escape(_shot_url(lon, lat, *_SHOT_FAR))
    img_near = html.escape(_shot_url(lon, lat, *_SHOT_NEAR))
    deep = f"checkcoast://beach/{beach.id}"

    # Dots de cada nivel de zoom (el pin de playa siempre va centrado)
    dots_far = _dots(outfalls, lon, lat, *_SHOT_FAR)
    dots_near = _dots(outfalls, lon, lat, *_SHOT_NEAR)

    rows = ""
    if latest:
        ev = html.escape(latest.evaluation) if latest.evaluation else "sin evaluación"
        rows += (
            '<div class="row"><span>Último análisis</span>'
            f"<b>{latest.sampled_at.strftime('%d/%m/%Y')} · {ev}</b></div>"
        )

    outfall_rows = "".join(
        f'<div class="ofrow" style="border-color:'
        f'{_OUTFALL_STATUS.get(o.status.value, _OUTFALL_STATUS["unknown"])[1]}">'
        f'<div class="ofname">{html.escape(o.name)}</div>'
        f'<div class="ofmeta">{_OUTFALL_STATUS.get(o.status.value, _OUTFALL_STATUS["unknown"])[0]}'
        f" · a {round(o.distance_m)} m</div></div>"
        for o in outfalls
    )
    outfalls_block = (
        f'<div class="sec">Emisarios cercanos</div>{outfall_rows}'
        '<div class="radius">En un radio de 1 km</div>'
        if outfalls else ""
    )

    press = ""
    if news:
        when = (
            news.published_at.strftime("%d/%m/%Y") if news.published_at else ""
        )
        press = (
            '<div class="press"><div class="ptag">según prensa</div>'
            f'<a class="ptitle" href="{html.escape(news.url)}">'
            f"{html.escape(news.title)}</a>"
            f'<div class="pmeta">{html.escape(news.source or "")}'
            f"{' · ' + when if when else ''}</div></div>"
        )

    foot = (
        "Playa sin controles sanitarios oficiales. Fuente: OpenStreetMap"
        if not beach.monitored
        else "Estado oficial: Náyade / Min. Sanidad · "
             "Foto: © Esri, Maxar, Earthstar Geographics"
    )

    return f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — CheckCoast Tenerife</title>
<meta property="og:type" content="website">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="{img_far}">
<meta name="twitter:card" content="summary_large_image">
<style>
  body {{ margin:0; font-family:system-ui,sans-serif; background:#eaf3f7;
         display:flex; justify-content:center; padding:24px 16px; }}
  .card {{ max-width:420px; width:100%; background:#fff; border-radius:16px;
          overflow:hidden; box-shadow:0 6px 24px rgba(7,43,62,.18); }}
  .head {{ background:linear-gradient(180deg,#075276,#17b8ce);
          color:#fff; padding:18px 20px 14px; }}
  .head h1 {{ margin:0; font-size:20px; }}
  .head p {{ margin:4px 0 0; font-size:13px; opacity:.9; }}
  .shotwrap {{ position:relative; }}
  .shot {{ display:block; width:100%; height:auto; }}
  .pin {{ position:absolute; left:50%; top:50%; width:42px;
          transform:translate(-50%,-92%);
          filter:drop-shadow(0 2px 5px rgba(0,0,0,.5)); }}
  .odot {{ position:absolute; width:24px;
          transform:translate(-50%,-95%);
          filter:drop-shadow(0 1px 3px rgba(0,0,0,.5)); }}
  .zoom {{ position:absolute; top:8px; right:8px; border:0;
          background:rgba(255,255,255,.92); color:#0d3a52;
          font-weight:700; font-size:13px; border-radius:8px;
          padding:6px 10px; cursor:pointer;
          box-shadow:0 1px 4px rgba(0,0,0,.35); }}
  .hidden {{ display:none; }}
  .body {{ padding:16px 20px 20px; }}
  .chip {{ display:inline-block; background:{color}; color:#fff;
          font-weight:700; font-size:13px; border-radius:999px;
          padding:6px 14px; }}
  .row {{ display:flex; justify-content:space-between; gap:12px;
          margin-top:12px; font-size:13px; }}
  .row span {{ color:#7a919c; }}
  .row b {{ color:#0d3a52; font-weight:600; text-align:right; }}
  .sec {{ margin-top:16px; font-size:13px; font-weight:700;
          color:#0d3a52; }}
  .ofrow {{ margin-top:8px; padding:8px 12px; border-left:3px solid;
          background:#f4f9fb; border-radius:0 8px 8px 0; }}
  .ofname {{ font-size:13px; font-weight:600; color:#0d3a52; }}
  .ofmeta {{ font-size:11px; color:#7a919c; margin-top:1px; }}
  .radius {{ font-size:11px; color:#7a919c; margin-top:6px; }}
  .press {{ margin-top:16px; background:#fff7e8; border:1px solid #f0d9a8;
          border-radius:10px; padding:10px 12px; }}
  .ptag {{ display:inline-block; font-size:10px; font-weight:700;
          color:#8a6d1a; background:#f6e3b0; border-radius:999px;
          padding:2px 8px; text-transform:uppercase; }}
  .ptitle {{ display:block; margin-top:6px; font-size:13px;
          font-weight:600; color:#0d3a52; text-decoration:none; }}
  .pmeta {{ font-size:11px; color:#7a919c; margin-top:3px; }}
  .open {{ display:block; margin-top:16px; text-align:center;
          background:linear-gradient(90deg,#075276,#17b8ce); color:#fff;
          text-decoration:none; font-weight:700; border-radius:10px;
          padding:12px; }}
  .src {{ margin-top:14px; font-size:11px; color:#7a919c; }}
</style>
</head>
<body>
  <div class="card">
    <div class="head"><h1>{name}</h1><p>{muni} · CheckCoast Tenerife</p></div>
    <div class="shotwrap">
      <img id="shot" class="shot" src="{img_far}" alt="Vista aérea de {name}">
      <span id="dots-far">{dots_far}</span>
      <span id="dots-near" class="hidden">{dots_near}</span>
      <img class="pin" src="/icons/{_PIN.get(state, _PIN['unknown'])}.png"
        alt="{name}">
      <button class="zoom" onclick="toggleZoom()" id="zoombtn">Acercar</button>
    </div>
    <div class="body">
      <span class="chip">{label}</span>
      {rows}
      {outfalls_block}
      {press}
      <a class="open" href="{deep}">Abrir en la app</a>
      <p class="src">{foot}</p>
    </div>
  </div>
</body>
<script>
var near = false;
function toggleZoom() {{
  near = !near;
  document.getElementById('shot').src = near ? '{img_near}' : '{img_far}';
  document.getElementById('dots-far').className = near ? 'hidden' : '';
  document.getElementById('dots-near').className = near ? '' : 'hidden';
  document.getElementById('zoombtn').textContent = near ? 'Alejar' : 'Acercar';
}}
</script>
</html>"""

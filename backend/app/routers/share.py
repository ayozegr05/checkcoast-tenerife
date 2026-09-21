"""Mini página pública por playa para compartir (WhatsApp/Telegram).

Sirve HTML con Open Graph (título, estado, foto satélite Esri) para que
los mensajeros generen la tarjeta rica; en el navegador muestra una
mini-ficha con enlace profundo `checkcoast://beach/{id}` a la app.
"""

import html

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Beach
from app.queries import beaches_with_latest_status

router = APIRouter(tags=["share"])

# Mismo encuadre cercano que SatelliteShot del frontend
_SHOT_DLON = 0.006
_SHOT_DLAT = 0.0033

_STATUS = {
    "closed": ("Cerrada", "#c62828"),
    "warning": ("Aviso activo", "#e65100"),
    "open": ("Sin alertas activas", "#0d9488"),
    "unknown": ("Sin datos oficiales", "#8fa3ad"),
}


def _shot_url(lon: float, lat: float) -> str:
    return (
        "https://server.arcgisonline.com/ArcGIS/rest/services/"
        f"World_Imagery/MapServer/export?bbox={lon - _SHOT_DLON},"
        f"{lat - _SHOT_DLAT},{lon + _SHOT_DLON},{lat + _SHOT_DLAT}"
        "&bboxSR=4326&imageSR=4326&size=640,300&format=png&f=image"
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

    name = html.escape(beach.name.title())
    muni = html.escape(beach.municipality or "Tenerife")
    title = f"{name} · {muni}"
    desc = f"Estado: {label} — CheckCoast Tenerife"
    img = html.escape(_shot_url(lon, lat))
    deep = f"checkcoast://beach/{beach.id}"

    return f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — CheckCoast Tenerife</title>
<meta property="og:type" content="website">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="{img}">
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
  .shot {{ display:block; width:100%; height:auto; }}
  .body {{ padding:16px 20px 20px; }}
  .chip {{ display:inline-block; background:{color}; color:#fff;
          font-weight:700; font-size:13px; border-radius:999px;
          padding:6px 14px; }}
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
    <img class="shot" src="{img}" alt="Vista aérea de {name}">
    <div class="body">
      <span class="chip">{label}</span>
      <a class="open" href="{deep}">Abrir en la app</a>
      <p class="src">Estado oficial: Náyade / Min. Sanidad ·
        Foto: © Esri, Maxar, Earthstar Geographics</p>
    </div>
  </div>
</body>
</html>"""

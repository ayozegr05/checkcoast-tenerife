"""Mini página pública por playa para compartir (WhatsApp/Telegram).

Sirve HTML con Open Graph (título, estado, foto satélite Esri) para que
los mensajeros generen la tarjeta rica; en el navegador muestra una
mini-ficha — réplica web de la ficha de la app — con enlace profundo
`checkcoast://beach/{id}`.
"""

import html
import math
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy import func
from sqlalchemy.orm import Session
from geoalchemy2 import Geography

from app.config import settings
from app.db import get_db
from app.models import (
    Beach,
    BeachIncident,
    BeachMeasurement,
    NewsItem,
    Outfall,
)
from app.queries import beaches_with_latest_status

router = APIRouter(tags=["share"])

_ANDROID_PACKAGE = "com.checkcoast.tenerife"


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

# Umbrales RD 1341/2007 (aguas costeras, UFC/100 mL) — mismos que la app
_QUALITY = {
    "ecoli": {"excellent": 250, "good": 500, "label": "E. coli"},
    "enterococci": {"excellent": 100, "good": 200, "label": "Enterococo"},
}
_CHART_H = 88          # px, igual que la app
_LOG_CAP = 100000      # los valores llegan a >24000


def _num(raw: str | None) -> float | None:
    """'9 UFC/100 mL' / '<10' / '>24000' -> número; None si no hay."""
    if not raw:
        return None
    m = re.search(r"\d+(?:\.\d+)?", raw)
    return float(m.group(0)) if m else None


def _bar_h(v: float) -> int:
    return max(3, round(_CHART_H * math.log10(max(v, 1)) / math.log10(_LOG_CAP)))


def _qcolor(param: str, v: float) -> str:
    t = _QUALITY[param]
    if v <= t["excellent"]:
        return "#0d9488"
    return "#e65100" if v <= t["good"] else "#c62828"


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

    measurements = (
        db.query(BeachMeasurement)
        .filter(BeachMeasurement.beach_id == beach.id)
        .order_by(BeachMeasurement.sampled_at.asc())
        .all()
    )
    latest = measurements[-1] if measurements else None
    incidents = (
        db.query(BeachIncident)
        .filter(BeachIncident.beach_id == beach.id)
        .order_by(BeachIncident.opened_at.desc())
        .limit(8)
        .all()
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
    url_far = _shot_url(lon, lat, *_SHOT_FAR)
    url_near = _shot_url(lon, lat, *_SHOT_NEAR)
    # En atributos HTML & va escapado como &amp;; en el JS va en crudo
    # (si no, Esri recibe 'amp;bboxSR' y devuelve error)
    img_far = html.escape(url_far)
    img_near = html.escape(url_near)
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

    # Gráfica de evolución (barras log-escala como la app): dos series
    # pre-renderizadas, el toggle solo cambia visibilidad
    chart_block = ""
    series: dict[str, list[tuple]] = {}
    for param in ("ecoli", "enterococci"):
        series[param] = [
            (m.sampled_at, v)
            for m in measurements
            if (v := _num(getattr(m, param))) is not None
        ]
    if any(len(pts) >= 2 for pts in series.values()):
        # Marcas rojas verticales en las fechas de incidente,
        # interpoladas sobre el rango de fechas de las muestras
        all_dates = [d for pts in series.values() for d, _ in pts]
        d0, d1 = min(all_dates), max(all_dates)
        span = max((d1 - d0).days, 1)
        inc_marks = "".join(
            f'<div class="inc" style="left:{pos:.1f}%"></div>'
            for i in incidents
            for pos in [((i.opened_at - d0).days / span) * 100]
            if 0 <= pos <= 100
        )
        panels = ""
        foots = ""
        for param in ("ecoli", "enterococci"):
            pts = series[param]
            lim_y = _bar_h(_QUALITY[param]["good"])
            bars = "".join(
                f'<div class="bar" style="height:{_bar_h(v)}px;'
                f'background:{_qcolor(param, v)}"'
                f' title="{d.strftime("%d/%m/%Y")} · {v:g} UFC/100 mL"></div>'
                for d, v in pts
            )
            hid = "" if param == "ecoli" else " hidden"
            hid2 = "" if param == "ecoli" else ' class="hidden"'
            panels += (
                f'<div id="chart-{param}" class="chartarea{hid}">'
                f'<div class="lim" style="bottom:{lim_y}px"></div>'
                f"{inc_marks}{bars}</div>"
            )
            foots += (
                f'<span id="foot-{param}"{hid2}>'
                f"{len(pts)} muestreos · cada barra = un análisis oficial"
                f" · línea azul = límite normativo "
                f"({_QUALITY[param]['good']} UFC/100 mL)"
                f" · línea roja = cierre/aviso</span>"
            )
        chart_block = f"""
      <div class="sec">Evolución del agua</div>
      <div class="ctoggle">
        <button id="tb-ecoli" class="tbtn ton" onclick="setChart('ecoli')">E. coli</button>
        <button id="tb-enterococci" class="tbtn" onclick="setChart('enterococci')">Enterococo</button>
      </div>
      {panels}
      <div class="radius">{foots}</div>"""

    inc_block = ""
    if incidents:
        items = "".join(
            '<div class="irow"><b>'
            f'{i.opened_at.strftime("%d/%m/%Y")}'
            + (
                f' → {i.closed_at.strftime("%d/%m/%Y")}'
                if i.closed_at
                else " → activo"
            )
            + "</b>"
            + (
                f'<span>{html.escape(i.observations[:120])}</span>'
                if i.observations
                else ""
            )
            + "</div>"
            for i in incidents
        )
        inc_block = f'<div class="sec">Historial de incidencias</div>{items}'

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
  .hidden {{ display:none !important; }}
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
  .chartarea {{ position:relative; height:{_CHART_H}px; display:flex;
          align-items:flex-end; gap:1px; margin-top:8px;
          background:#f4f9fb; border-radius:8px; padding:0 6px; }}
  .bar {{ flex:1; border-radius:2px 2px 0 0; }}
  .lim {{ position:absolute; left:4px; right:4px;
          border-top:2px dashed #0b6e99; }}
  .inc {{ position:absolute; top:0; bottom:0; width:2px;
          background:#c62828; }}
  .ctoggle {{ display:flex; gap:8px; margin-top:8px; }}
  .tbtn {{ border:1px solid #cddfe8; background:#fff; color:#0d3a52;
          font-size:12px; font-weight:700; border-radius:999px;
          padding:5px 12px; cursor:pointer; }}
  .tbtn.ton {{ background:#075276; color:#fff; border-color:#075276; }}
  .irow {{ margin-top:8px; font-size:12px; color:#0d3a52; }}
  .irow span {{ display:block; color:#7a919c; font-size:11px; }}
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
  .noapp {{ display:none; margin-top:8px; font-size:12px;
          color:#8a6d1a; text-align:center; }}
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
      {chart_block}
      {inc_block}
      {press}
      <a class="open" href="{deep}" onclick="openApp(); return false;">
        Abrir en la app</a>
      <p id="noapp" class="noapp">Si no se abrió, aún no tienes la app
        instalada.</p>
      <p class="src">{foot}</p>
    </div>
  </div>
</body>
<script>
// intent:// es la forma fiable de abrir apps en Chrome/Android: el
// scheme pelado a veces se ignora en silencio
function openApp() {{
  var u = navigator.userAgent;
  if (/Android/i.test(u)) {{
    window.location = 'intent://beach/{beach.id}#Intent;scheme=checkcoast;'
      + 'package=com.checkcoast.tenerife;end';
  }} else {{
    window.location = 'checkcoast://beach/{beach.id}';
  }}
  setTimeout(function () {{
    document.getElementById('noapp').style.display = 'block';
  }}, 1400);
}}
function setChart(p) {{
  document.getElementById('chart-ecoli').className =
    'chartarea' + (p === 'ecoli' ? '' : ' hidden');
  document.getElementById('chart-enterococci').className =
    'chartarea' + (p === 'enterococci' ? '' : ' hidden');
  document.getElementById('tb-ecoli').className =
    'tbtn' + (p === 'ecoli' ? ' ton' : '');
  document.getElementById('tb-enterococci').className =
    'tbtn' + (p === 'enterococci' ? ' ton' : '');
  document.getElementById('foot-ecoli').className =
    p === 'ecoli' ? '' : 'hidden';
  document.getElementById('foot-enterococci').className =
    p === 'enterococci' ? '' : 'hidden';
}}
var near = false;
function toggleZoom() {{
  near = !near;
  document.getElementById('shot').src = near ? '{url_near}' : '{url_far}';
  document.getElementById('dots-far').className = near ? 'hidden' : '';
  document.getElementById('dots-near').className = near ? '' : 'hidden';
  document.getElementById('zoombtn').textContent = near ? 'Alejar' : 'Acercar';
}}
</script>
</html>"""

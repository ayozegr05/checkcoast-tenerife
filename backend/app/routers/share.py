"""Mini página pública por playa para compartir (WhatsApp/Telegram).

Sirve HTML con Open Graph (título, estado, foto satélite Esri) para que
los mensajeros generen la tarjeta rica; en el navegador muestra una
mini-ficha — réplica web de la ficha de la app — con enlace profundo
`checkcoast://beach/{id}`.
"""

import html
import io
import json
import math
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, Response
from sqlalchemy import cast, func, literal
from sqlalchemy.orm import Session
from geoalchemy2 import Geography, Geometry

from app.config import settings
from app.db import get_db
from app.models import (
    Beach,
    BeachIncident,
    BeachMeasurement,
    NewsItem,
    Outfall,
)
from app.queries import beaches_with_latest_status, effective_states

router = APIRouter(tags=["share"])

_ANDROID_PACKAGE = "com.checkcoast.tenerife"

_MONTHS = [
    "ene", "feb", "mar", "abr", "may", "jun",
    "jul", "ago", "sep", "oct", "nov", "dic",
]


def _live_status_counts(db: Session) -> dict[str, int]:
    """Recuento de estados efectivos AHORA (misma regla que el mapa de
    la app) — antes se contaban todas las filas históricas de
    beach_statuses y el contador mentía (5 cerradas cuando hay 3)."""
    counts: dict[str, int] = {}
    for e in effective_states(db).values():
        s = e["status"]
        s = s.value if hasattr(s, "value") else s
        counts[s] = counts.get(s, 0) + 1
    return counts


def _alert_when(aword: str, rep: datetime | None, now: datetime) -> str:
    """'cerrada · hace 3 días' si es reciente; 'cerrada desde feb 2026'
    cuando el cierre lleva >30 d — 'hace 212 días' en una alerta viva
    se lee como dato rancio, no como cierre en curso."""
    if rep is not None and rep.tzinfo is None:
        rep = rep.replace(tzinfo=timezone.utc)
    days = (now - rep).days if rep else 0
    if days <= 30:
        ago = (
            "hoy" if days == 0
            else "ayer" if days == 1
            else f"hace {days} días"
        )
        return f"{aword} · {ago}"
    return f"{aword} desde {_MONTHS[rep.month - 1]} {rep.year}"


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

# Encuadres satélite de más cerca a más lejos (dlon, dlat en grados)
_SHOT_LEVELS = [
    (0.003, 0.0017),   # muy cerca
    (0.006, 0.0033),   # cerca
    (0.015, 0.0083),   # lejos
]

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
    "unknown": ("En trámite", "#f9a825"),
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

_ICONS = Path(__file__).resolve().parent.parent / "static" / "icons"
_FONTS = [
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
     "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    # Windows (desarrollo local)
    ("C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/arial.ttf"),
]
_OG_W, _OG_H = 1200, 630
_og_cache: dict[tuple[int, str], bytes] = {}

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
    return "#f9a825" if v <= t["good"] else "#c62828"


# Port de lib/format.ts (capName + displayBeachName): el censo llega en
# mayúsculas con el artículo en paréntesis — "PLAYA GAVIOTAS (LAS) PM1"
_CONNECTORS = {"de", "del", "y", "e", "en", "a", "o", "u"}
_ARTICLES = {"el", "la", "los", "las"}
_ROMANS = {"i", "ii", "iii", "iv", "v", "vi"}
_ACCENTS = {
    "medano": "médano", "guios": "guíos", "guimar": "güímar",
    "americas": "américas", "camison": "camisón", "jaquita": "jaquita",
    "almaciga": "almáciga", "amricas": "américas", "camisn": "camisón",
    "gimar": "güímar",
}
_ARTICLE_PAREN = re.compile(r"\s*\((EL|LA|LOS|LAS)\)", re.I)
_DE_FORMS = {"el": "del", "la": "de la", "los": "de los",
             "las": "de las"}
_WORD = re.compile(r"[a-záéíóúñü]+", re.I)


def _cap_name(name: str) -> str:
    """Capitaliza estilo español: conectores en minúscula, artículos
    solo en minúscula tras 'de'; restaura acentos conocidos."""
    prev = ""
    out = []
    for p in re.split(f"({_WORD.pattern})", name.lower().replace("", "")):
        if not _WORD.fullmatch(p):
            out.append(p)
            continue
        w = _ACCENTS.get(p, p)
        if w in _ROMANS:
            prev = w
            out.append(w.upper())
            continue
        lower = prev != "" and (
            w in _CONNECTORS or (w in _ARTICLES and prev == "de")
        )
        out.append(w if lower else w[0].upper() + w[1:])
        prev = w
    return "".join(out)


def _display_name(name: str) -> str:
    """'PLAYA GAVIOTAS (LAS) PM1' -> 'Playa de las Gaviotas'."""
    name = re.sub(r"\s+PM\d+$", "", name)
    m = _ARTICLE_PAREN.search(name)
    if not m:
        return _cap_name(name)
    base = re.sub(r" -(?=\S)", "-", _ARTICLE_PAREN.sub("", name))
    if re.match(r"^PLAYA\s", base, re.I):
        art = _DE_FORMS[m.group(1).lower()]
        return _cap_name(
            re.sub(r"^PLAYA\s+", f"PLAYA {art} ", base, flags=re.I)
        )
    return _cap_name(f"{m.group(1)} {base}")


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


def _effective_state(
    db: Session, beach: Beach, official: str | None, news_items: list
) -> tuple[str, str | None]:
    """(state, press_label) — replica la regla de /alerts: el oficial
    manda, pero prensa fresca dominada por cierres escala
    warning->closed y decide en playas sin monitorización."""
    state = official or "unknown"
    press_label: str | None = None
    cutoff = datetime.now(timezone.utc) - timedelta(days=21)
    if news_items and news_items[0].published_at and news_items[0].published_at >= cutoff:
        change = next(
            (i for i in news_items
             if i.event_type in ("closure", "reopening")), None,
        )
        warn = next(
            (i for i in news_items
             if i.event_type in ("warning", "pollution")), None,
        )
        press_ev = None
        if change and change.event_type == "closure":
            press_ev = change
        elif warn and (
            change is None
            or (warn.published_at or datetime.min.replace(tzinfo=timezone.utc))
            > (change.published_at or datetime.min.replace(tzinfo=timezone.utc))
        ):
            press_ev = warn
        counts: dict[str, int] = {}
        for i in news_items:
            if i.event_type and i.event_type != "other":
                counts[i.event_type] = counts.get(i.event_type, 0) + 1
        dominant = (
            "closure" if counts.get("closure")
            else (max(counts, key=counts.get) if counts else None)
        )
        pstate = (
            "closed" if press_ev and press_ev.event_type == "closure"
            else ("warning" if press_ev else None)
        )
        if official in ("closed", "warning"):
            if pstate == "closed" or dominant == "closure":
                state, press_label = "closed", "según prensa"
        elif official == "open":
            # ventana de gracia 14 días + sin reapertura formal posterior
            grace = datetime.now(timezone.utc) - timedelta(days=14)
            resolved = (
                db.query(func.max(BeachIncident.closed_at))
                .filter(
                    BeachIncident.beach_id == beach.id,
                    BeachIncident.closed_at.isnot(None),
                )
                .scalar()
            )
            when = press_ev.published_at if press_ev else None
            if (
                pstate == "closed" and when and when >= grace
                and not (resolved and resolved >= when.date())
            ):
                state, press_label = "closed", "según prensa"
        elif pstate:
            state, press_label = pstate, "según prensa"
    return state, press_label


def _og_png(beach, lon: float, lat: float, state: str, label: str,
            color: str) -> bytes:
    """Compone la og:image 1200×630: foto satélite Esri + pin de la
    playa + banda inferior con nombre, municipio y chip de estado."""
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (_OG_W, _OG_H), "#075276")
    try:
        r = httpx.get(
            _shot_url(lon, lat, *_SHOT_LEVELS[1]).replace(
                "size=640,300", "size=1200,630"
            ),
            timeout=10,
        )
        img = Image.open(io.BytesIO(r.content)).convert("RGBA")
    except Exception:
        img = img.convert("RGBA")

    # Pin de playa centrado (mismo PNG que el mapa de la app)
    pin = Image.open(
        _ICONS / f"{_PIN.get(state, _PIN['unknown'])}.png"
    ).convert("RGBA")
    pin = pin.resize((104, 104))
    img.alpha_composite(pin, (_OG_W // 2 - 52, 240))

    # Banda inferior con degradado a oscuro
    band = Image.new("RGBA", (_OG_W, 190), (8, 32, 46, 0))
    bd = ImageDraw.Draw(band)
    for y in range(190):
        bd.line([(0, y), (_OG_W, y)],
                fill=(8, 32, 46, int(235 * (y / 190))))
    img.alpha_composite(band, (0, _OG_H - 190))

    d = ImageDraw.Draw(img)
    for bold, reg in _FONTS:
        try:
            f_name = ImageFont.truetype(bold, 52)
            f_sub = ImageFont.truetype(reg, 30)
            f_chip = ImageFont.truetype(bold, 30)
            break
        except OSError:
            continue
    else:
        f_name = f_sub = f_chip = ImageFont.load_default()

    name = _display_name(beach.name)
    sub = f"{beach.municipality or 'Tenerife'} · CheckCoast Tenerife"
    d.text((46, _OG_H - 140), name, font=f_name, fill="#ffffff")
    d.text((46, _OG_H - 72), sub, font=f_sub, fill="#cfe3ec")

    # Chip de estado abajo-derecha
    tw = d.textlength(label, font=f_chip)
    cw, ch = tw + 52, 58
    cx, cy = _OG_W - cw - 46, _OG_H - 140
    d.rounded_rectangle([cx, cy, cx + cw, cy + ch], radius=14, fill=color)
    d.text((cx + 26, cy + 12), label, font=f_chip, fill="#ffffff")

    # JPEG: el PNG salía >1 MB y WhatsApp se rendía a miniatura
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=82, optimize=True)
    return buf.getvalue()


@router.get("/b/{beach_id}/og.jpg")
def share_og(beach_id: int, db: Session = Depends(get_db)) -> Response:
    """Imagen OG compuesta: lo que WhatsApp/Telegram enseñan en la
    tarjeta. Cacheada por (playa, estado) — regenera si cambia."""
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
    official = status.status.value if status else None
    news_items = (
        db.query(NewsItem)
        .filter(NewsItem.beach_id == beach.id, NewsItem.relevant.is_(True))
        .order_by(NewsItem.published_at.desc().nulls_last())
        .limit(30)
        .all()
    )
    state, _ = _effective_state(db, beach, official, news_items)
    key = (beach_id, state)
    if key not in _og_cache:
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
    official = status.status.value if status else None

    news_items = (
        db.query(NewsItem)
        .filter(NewsItem.beach_id == beach.id, NewsItem.relevant.is_(True))
        .order_by(NewsItem.published_at.desc().nulls_last())
        .limit(30)
        .all()
    )
    state, press_label = _effective_state(
        db, beach, official, news_items
    )

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
    # beach.geom ya está cargado (ORM) — se usa como parámetro en vez de
    # referenciar la tabla beaches, para que el FROM solo tenga outfalls
    # (evita el cartesian product warning de SQLAlchemy)
    beach_geog = cast(literal(beach.geom, type_=Geometry), Geography)
    outfalls = (
        db.query(
            Outfall.name,
            Outfall.status,
            func.ST_Distance(
                beach_geog, Outfall.geom.cast(Geography)
            ).label("distance_m"),
            func.ST_X(Outfall.geom).label("olon"),
            func.ST_Y(Outfall.geom).label("olat"),
        )
        .filter(
            func.ST_DWithin(
                beach_geog,
                Outfall.geom.cast(Geography),
                _NEARBY_OUTFALL_RADIUS_M,
            )
        )
        .order_by("distance_m")
        .limit(5)
        .all()
    )

    name = html.escape(_display_name(beach.name))
    muni = html.escape(beach.municipality or "Tenerife")
    # Cabecera teñida por estado efectivo, como la ficha de la app
    head_bg = {
        "closed": "linear-gradient(180deg,#7a1f1f,#c62828)",
        "warning": "linear-gradient(180deg,#8a3c00,#e65100)",
    }.get(state, "linear-gradient(180deg,#075276,#17b8ce)")
    # La ola que separa cabecera y foto sigue el color final del
    # degradado del header
    wave_c = {"closed": "#c62828", "warning": "#e65100"}.get(
        state, "#17b8ce"
    )
    title = f"{name} · {muni}"
    urls = [_shot_url(lon, lat, *d) for d in _SHOT_LEVELS]
    # En atributos HTML & va escapado como &amp;; en el JS va en crudo
    # (si no, Esri recibe 'amp;bboxSR' y devuelve error)
    imgs = [html.escape(u) for u in urls]
    deep = f"checkcoast://beach/{beach.id}"

    # Un span de dots por nivel de zoom; se empieza en el más lejano
    start = len(_SHOT_LEVELS) - 1
    dots_spans = "".join(
        f'<span id="dots-{i}" class="{"hidden" if i != start else ""}">'
        f"{d}</span>"
        for i, d in enumerate(
            _dots(outfalls, lon, lat, *d_) for d_ in _SHOT_LEVELS
        )
    )

    rows = ""
    if latest:
        ev = html.escape(latest.evaluation) if latest.evaluation else "sin evaluación"
        rows += (
            f'<div class="row"><b>Último análisis: '
            f"{latest.sampled_at.strftime('%d/%m/%Y')} · {ev}</b></div>"
        )

    outfall_rows = "".join(
        f'<div class="ofrow" style="border-color:'
        f'{_OUTFALL_STATUS.get(o.status.value, _OUTFALL_STATUS["unknown"])[1]}">'
        f'<div><div class="ofname">{html.escape(o.name)}</div>'
        f'<div class="ofmeta">{_OUTFALL_STATUS.get(o.status.value, _OUTFALL_STATUS["unknown"])[0]}'
        # Distancia como cifra destacada (como en la ficha de la app);
        # <500 m va en naranja de aviso — es el dato que impacta
        f'</div></div><div class="ofdist'
        f'{" near" if o.distance_m < 500 else ""}">'
        f"a {round(o.distance_m)} m</div></div>"
        for o in outfalls
    )
    outfalls_block = (
        '<div class="sec">Emisarios cercanos '
        '<span class="secsub">· en un radio de 1 km</span></div>'
        f'{outfall_rows}'
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
            # Etiqueta de año en la primera barra de cada año
            ycells, last_yr = "", None
            for d, _ in pts:
                yr = d.strftime("%Y")
                ycells += (
                    f'<div class="yrcell">{yr}</div>'
                    if yr != last_yr else '<div class="yrcell"></div>'
                )
                last_yr = yr
            hid = "" if param == "ecoli" else " hidden"
            hid2 = "" if param == "ecoli" else ' class="hidden"'
            yhid = "" if param == "ecoli" else " hidden"
            panels += (
                f'<div id="chart-{param}" class="chartarea{hid}">'
                f'<div class="lim" style="bottom:{lim_y}px"></div>'
                f"{inc_marks}{bars}</div>"
                f'<div id="yrs-{param}" class="yrow{yhid}">{ycells}</div>'
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
            f'<div class="irow{"" if i.closed_at else " iact"}"><b>'
            f'{i.opened_at.strftime("%d/%m/%Y")}'
            + (
                f' → {i.closed_at.strftime("%d/%m/%Y")}'
                if i.closed_at
                else ' <em>activo</em>'
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

    # Banner "según prensa" como en la app: evento dominante + causa +
    # desde + nº medios; debajo el último titular enlazable
    press_cls = (
        "press n-closed" if state == "closed"
        else "press n-warning" if state == "warning"
        else "press"
    )
    press = ""
    if news_items:
        counts_ev: dict[str, int] = {}
        for it in news_items:
            if it.event_type and it.event_type != "other":
                counts_ev[it.event_type] = counts_ev.get(it.event_type, 0) + 1
        dom = "closure" if counts_ev.get("closure") else (
            max(counts_ev, key=counts_ev.get) if counts_ev else None
        )
        # Causa = la más frecuente entre los titulares del evento
        # dominante (moda, como el resumen de la app)
        dom_items = [it for it in news_items if it.event_type == dom]
        ccount: dict[str, int] = {}
        for it in dom_items:
            if it.cause:
                ccount[it.cause] = ccount.get(it.cause, 0) + 1
        cause = max(ccount, key=ccount.get) if ccount else None
        since = min(
            (it.published_at for it in dom_items if it.published_at),
            default=None,
        )
        outlets = len({it.source for it in news_items if it.source})
        ev_word = {
            "closure": "Cerrada", "warning": "Aviso en",
            "pollution": "Contaminación en", "reopening": "Reabierta",
        }.get(dom or "", "Mencionada")
        if dom == "closure" and state != "closed":
            ev_word = "Estuvo cerrada" if state == "open" else "Cerrada"
        line = ev_word + (f" por {html.escape(cause)}" if cause else "")
        if since:
            line += f" · desde el {since.strftime('%d/%m/%Y')}"
        # reapertura oficial probada: incidente cerrado tras el titular
        closed_after = next(
            (i.closed_at for i in incidents
             if i.closed_at and since and i.closed_at >= since.date()),
            None,
        )
        if closed_after:
            line += f" · Sanidad la reabrió el {closed_after.strftime('%d/%m/%Y')}"
        # Hasta 3 titulares enlazables, como la caja "En la prensa"
        # de la app — venden el "porqué" mejor que uno solo
        titles = ""
        for n in news_items[:3]:
            nwhen = (
                n.published_at.strftime("%d/%m/%Y") if n.published_at else ""
            )
            titles += (
                f'<a class="ptitle" href="{html.escape(n.url)}">'
                f"{html.escape(n.title)}</a>"
                f'<div class="pmeta">{html.escape(n.source or "")}'
                f"{' · ' + nwhen if nwhen else ''}</div>"
            )
        press = (
            f'<div class="{press_cls}"><div class="psum">{line}</div>'
            f'<div class="ptag">según prensa · {outlets} '
            f'medio{"s" if outlets != 1 else ""}</div>'
            f"{titles}</div>"
        )

    # Con cierre/aviso activo el motivo es lo primero que importa:
    # si el estado lo decide la prensa, su banner sube arriba del todo;
    # si es oficial, se resume el incidente abierto
    notice = ""
    if state in ("closed", "warning"):
        if press and press_label:
            notice, press = press, ""
        else:
            active_inc = next(
                (i for i in incidents if i.closed_at is None), None
            )
            if active_inc:
                verb = "Cerrada" if state == "closed" else "Aviso activo"
                obs = (active_inc.observations or "").strip()
                nline = verb + (
                    f" — {html.escape(obs[:140])}" if obs else ""
                )
                nline += (
                    f" · desde el "
                    f"{active_inc.opened_at.strftime('%d/%m/%Y')}"
                )
                notice = (
                    f'<div class="{press_cls}"><div class="psum">{nline}</div>'
                    f'<div class="ptag">estado oficial · Náyade / '
                    f"Sanidad</div></div>"
                )

    # og:description lleva el motivo cuando hay cierre/aviso —
    # es lo que la gente quiere saber al ver la tarjeta
    desc = f"Estado: {label} — CheckCoast Tenerife"
    if notice:
        reason = re.sub(r"<[^>]+>", "", notice)
        reason = re.sub(r"\s+", " ", reason).split("según prensa")[0]
        reason = reason.split("estado oficial")[0].strip()
        desc = f"{reason} — CheckCoast Tenerife"

    foot = (
        "Playa sin controles sanitarios oficiales. Fuente: OpenStreetMap"
        if not beach.monitored
        else "Estado oficial: Náyade / Min. Sanidad · "
             "Foto: © Esri, Maxar, Earthstar Geographics"
    )

    # Contadores vivos para el panel lateral desktop
    status_counts = _live_status_counts(db)
    total_beaches = db.query(func.count(Beach.id)).scalar()

    # Alertas vivas de la isla para el panel lateral: la misma regla
    # que /alerts, enlazables a su propia landing
    from app.routers.alerts import list_alerts

    salerts = ""
    island_alerts = list_alerts(db)[:4]
    if island_alerts:
        now = datetime.now(timezone.utc)
        rows_a = ""
        for a in island_alerts:
            rep = a.reported_at
            via = "según prensa" if a.via == "press" else "oficial"
            acolor = _STATUS.get(a.status, _STATUS["unknown"])[1]
            aword = "cerrada" if a.status == "closed" else "aviso"
            amuni = html.escape(a.municipality or "")
            rows_a += (
                f'<a class="sal sal-{"c" if a.status == "closed" else "w"}"'
                f' href="/b/{a.beach_id}">'
                f'<i style="background:{acolor}"></i><div>'
                f"<b>{html.escape(_display_name(a.beach_name))}</b>"
                f"<span>{_alert_when(aword, rep, now)} · "
                f"{via} · {amuni}</span>"
                "</div></a>"
            )
        salerts = (
            '<div class="salerts"><div class="sl">Alertas activas '
            "en la isla</div>"
            f"{rows_a}</div>"
        )

    page = f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — CheckCoast Tenerife</title>
<link rel="icon" type="image/png" href="/icons/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<meta property="og:type" content="website">
<meta property="og:site_name" content="CheckCoast Tenerife">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:image"
  content="{settings.public_url}/b/{beach.id}/og.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<style>
  body {{ margin:0; font-family:'Inter',system-ui,sans-serif;
         min-height:100vh;
         background:linear-gradient(160deg,#0d3a52,#075276);
         display:flex; justify-content:center; padding:24px 16px; }}
  /* Fondo = la misma foto satélite de la card, difuminada: cero
     peticiones extra (la URL ya está cacheada) y cada playa
     "ambienta" su landing con su costa real */
  body::before {{ content:''; position:fixed; inset:-70px; z-index:-2;
         background:url("{urls[start]}") center/cover no-repeat;
         filter:blur(30px) brightness(.8) saturate(1.15); }}
  body::after {{ content:''; position:fixed; inset:0; z-index:-1;
         background:linear-gradient(160deg,
           rgba(7,43,62,.62),rgba(7,82,118,.42)); }}
  .page {{ display:flex; flex-direction:column; align-items:center;
          width:100%; max-width:420px; }}
  .brand {{ display:flex; align-items:center; gap:10px;
          margin-bottom:14px; color:#fff; font-weight:700;
          font-size:17px; letter-spacing:.2px;
          text-shadow:0 1px 4px rgba(0,0,0,.4); }}
  .brand img {{ width:38px; height:38px; border-radius:9px;
          box-shadow:0 1px 4px rgba(0,0,0,.25); }}
  .tfe {{ font-weight:400; color:#a8d4e0; }}
  .card {{ max-width:420px; width:100%; background:#fff; border-radius:16px;
          overflow:hidden; box-shadow:0 6px 24px rgba(7,43,62,.18);
          align-self:flex-start; }}
  .side {{ display:none; }}
  @media (min-width:900px) {{
    body {{ align-items:center; padding:48px 24px; }}
    .page {{ flex-direction:row; align-items:flex-start;
            max-width:none; width:auto; gap:44px; }}
    .brand {{ display:none; }}
    .card {{ max-width:520px;
            box-shadow:0 18px 60px rgba(7,43,62,.30); }}
    .side {{ display:block; width:300px; padding-top:6px; }}
    .sbrand {{ display:flex; align-items:center; gap:12px;
            font-weight:700; font-size:22px; color:#fff;
            letter-spacing:.2px; text-shadow:0 1px 4px rgba(0,0,0,.4); }}
    .sbrand img {{ width:50px; height:50px; border-radius:12px;
            box-shadow:0 2px 8px rgba(0,0,0,.3); }}
    .sstat {{ margin-top:4px; background:rgba(255,255,255,.9);
            border:1px solid rgba(255,255,255,.25); border-radius:12px;
            padding:10px 14px; font-size:13px; color:#0d3a52; }}
    .sstat b {{ color:#075276; }}
    .sstat .sl {{ font-size:11px; color:#6d8b9a; font-weight:600;
            text-transform:uppercase; letter-spacing:.4px; }}
    .stag {{ font-size:14px; line-height:1.55; color:#dcebf2;
            margin:16px 0; text-shadow:0 1px 3px rgba(0,0,0,.35); }}
    .sleg {{ margin-top:12px; background:rgba(255,255,255,.88);
            border:1px solid rgba(255,255,255,.25); border-radius:12px;
            padding:12px 14px; font-size:12px; color:#33566b; }}
    .sleg div {{ display:flex; align-items:center; gap:9px;
            margin:5px 0; }}
    .sleg img {{ width:20px; height:20px; }}
    .salerts {{ margin-top:12px; background:rgba(255,255,255,.88);
            border:1px solid rgba(255,255,255,.25); border-radius:12px;
            padding:12px 14px; }}
    .salerts .sl {{ font-size:11px; color:#6d8b9a; font-weight:600;
            text-transform:uppercase; letter-spacing:.4px; }}
    .sal {{ display:flex; align-items:center; gap:9px; margin-top:9px;
            text-decoration:none; border-radius:10px;
            padding:8px 11px; }}
    .sal.sal-c {{ background:#fdeceb; border:1px solid #f0c4bd; }}
    .sal.sal-w {{ background:#fdf1da; border:1px solid #eec27e; }}
    .sal i {{ flex:none; width:9px; height:9px; border-radius:50%; }}
    .sal b {{ display:block; font-size:12px; color:#0d3a52;
            font-weight:600; }}
    .sal:hover b {{ color:#075276; }}
    .sal span {{ font-size:10.5px; color:#7a919c; }}
    .sfoot {{ margin-top:14px; font-size:11px; color:#a8c4d2; }}
  }}
  .head {{ background:{head_bg};
          color:#fff; padding:18px 20px 14px; }}
  .head h1 {{ margin:0; font-size:20px; }}
  .head p {{ margin:4px 0 0; font-size:13px; opacity:.9; }}
  .shotwrap {{ position:relative; }}
  /* Ola divisoria: la cabecera teñida "cae" sobre la foto con curva
     en vez de corte recto — el fill sigue el color final del header */
  .wave {{ position:absolute; top:0; left:0; width:100%; height:22px;
          z-index:2; display:block; }}
  .shot {{ display:block; width:100%; height:auto; }}
  .pin {{ position:absolute; left:50%; top:50%; width:42px;
          transform:translate(-50%,-92%);
          filter:drop-shadow(0 2px 5px rgba(0,0,0,.5)); }}
  .odot {{ position:absolute; width:24px;
          transform:translate(-50%,-95%);
          filter:drop-shadow(0 1px 3px rgba(0,0,0,.5)); }}
  .zoom {{ position:absolute; top:30px; right:8px; display:flex;
          flex-direction:column; border-radius:8px; overflow:hidden;
          box-shadow:0 1px 4px rgba(0,0,0,.35); }}
  .zbtn {{ border:0; background:rgba(255,255,255,.92); color:#0d3a52;
          font-weight:700; font-size:16px; width:30px; height:28px;
          cursor:pointer; line-height:1; padding:0; }}
  .zbtn + .zbtn {{ border-top:1px solid #cddfe8; }}
  .zbtn:disabled {{ opacity:.45; cursor:default; }}
  .hidden {{ display:none !important; }}
  .body {{ padding:16px 20px 20px; }}
  .chip {{ display:inline-block; background:{color}; color:#fff;
          font-weight:700; font-size:13px; border-radius:10px;
          padding:6px 14px; }}
  .chip.ctr {{ display:table; margin:0 auto; }}
  .secsub {{ font-weight:400; color:#7a919c; font-size:11px; }}
  .row {{ display:flex; justify-content:space-between; gap:12px;
          margin-top:12px; font-size:13px; }}
  .row span {{ color:#7a919c; white-space:nowrap; }}
  .row b {{ color:#0d3a52; font-weight:600; text-align:right; }}
  .sec {{ margin-top:16px; font-size:13px; font-weight:700;
          color:#0d3a52; }}
  .ofrow {{ margin-top:8px; padding:8px 12px; border-left:3px solid;
          background:#f4f9fb; border-radius:0 8px 8px 0;
          display:flex; justify-content:space-between;
          align-items:center; gap:10px; }}
  .ofname {{ font-size:13px; font-weight:600; color:#0d3a52; }}
  .ofmeta {{ font-size:11px; color:#7a919c; margin-top:1px; }}
  .ofdist {{ font-size:15px; font-weight:700; color:#075276;
          white-space:nowrap; }}
  .ofdist.near {{ color:#e65100; }}
  .radius {{ font-size:11px; color:#7a919c; margin-top:6px; }}
  .press {{ margin:16px 0 6px; background:#fff7e8;
          border:1px solid #f0d9a8;
          border-radius:10px; padding:10px 12px; }}
  /* El banner de aviso (arriba) se tiñe por estado; el de contexto
     (abajo, en playas abiertas) queda ámbar neutro */
  .press.n-closed {{ background:#fbdeda; border-color:#e8a49c;
          border-left:4px solid #c62828; }}
  .press.n-warning {{ background:#fdeed3; border-color:#eec27e;
          border-left:4px solid #e65100; }}
  .yrow {{ display:flex; gap:1px; padding:3px 6px 0; }}
  .yrcell {{ flex:1; font-size:9px; font-weight:600; color:#8fa3ad;
          white-space:nowrap; overflow:visible; }}
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
  .irow {{ margin-top:8px; font-size:12px; color:#0d3a52;
          border-left:3px solid #cddfe8; padding-left:10px; }}
  .irow.iact {{ border-left-color:#c62828; }}
  .irow.iact b {{ color:#c62828; }}
  .irow em {{ font-style:normal; background:#c62828; color:#fff;
          font-size:10px; font-weight:700; border-radius:999px;
          padding:2px 8px; }}
  .irow span {{ display:block; color:#7a919c; font-size:11px; }}
  .psum {{ font-size:13px; font-weight:600; color:#8a5a00; }}
  .ptag {{ display:inline-block; margin-top:6px; font-size:10px;
          font-weight:700; color:#8a6d1a; background:#f6e3b0;
          border-radius:999px; padding:2px 8px;
          text-transform:uppercase; }}
  .ptitle {{ display:block; margin-top:6px; font-size:12px;
          font-weight:500; color:#0d3a52; text-decoration:none; }}
  .pmeta {{ font-size:11px; color:#7a919c; margin-top:3px; }}
  .open {{ display:block; margin-top:16px; text-align:center;
          background:linear-gradient(90deg,#075276,#17b8ce); color:#fff;
          text-decoration:none; font-weight:700; border-radius:10px;
          padding:12px; }}
  .src {{ margin-top:14px; font-size:11px; color:#7a919c; }}
  .noapp {{ display:none; margin-top:8px; font-size:12px;
          color:#8a6d1a; text-align:center; }}
  .homelink {{ display:block; margin-top:10px; text-align:center;
          font-size:12px; color:#075276; font-weight:600;
          text-decoration:none; }}
  .homelink:hover {{ text-decoration:underline; }}
</style>
</head>
<body>
<div class="page">
  <div class="brand">
    <img src="/icons/app-icon.png" alt="">CheckCoast
    <span class="tfe">Tenerife</span>
  </div>
  <div class="card">
    <div class="head"><h1>{name}</h1><p>{muni}</p></div>
    <div class="shotwrap">
      <svg class="wave" viewBox="0 0 420 24" preserveAspectRatio="none"
        aria-hidden="true"><path fill="{wave_c}"
        d="M0,0 L420,0 L420,7 C365,20 305,3 215,11 C140,18 70,7 0,15 Z"/>
      </svg>
      <img id="shot" class="shot" src="{imgs[start]}"
        alt="Vista aérea de {name}">
      {dots_spans}
      <img class="pin" src="/icons/{_PIN.get(state, _PIN['unknown'])}.png"
        alt="{name}">
      <div class="zoom">
        <button class="zbtn" id="zin" onclick="zoom(-1)"
          aria-label="Acercar">+</button>
        <button class="zbtn" id="zout" onclick="zoom(1)"
          aria-label="Alejar">−</button>
      </div>
    </div>
    <div class="body">
      <span class="chip{' ctr' if notice else ''}">{label}</span>
      {notice}
      {rows}
      {outfalls_block}
      {press}
      {chart_block}
      {inc_block}
      <a class="open" href="{deep}" onclick="openApp(); return false;">
        Abrir en la app</a>
      <p id="noapp" class="noapp">Si no se abrió, aún no tienes la app
        instalada.</p>
      <a class="homelink" href="/">← Inicio</a>
      <p class="src">{foot}</p>
    </div>
  </div>
  <aside class="side">
    <div class="sbrand">
      <img src="/icons/app-icon.png" alt="">CheckCoast
      <span class="tfe">Tenerife</span>
    </div>
    <p class="stag">¿Puedes bañarte hoy? El estado oficial de cada
      playa de Tenerife — y el porqué cuando el parte no lo dice.</p>
    <div class="sstat"><div class="sl">Ahora mismo en Tenerife</div>
      <b>{status_counts.get('closed', 0)}</b> cerradas ·
      <b>{status_counts.get('warning', 0)}</b> con aviso ·
      <b>{total_beaches}</b> playas mapeadas</div>
    {salerts}
    <div class="sleg">
      <div><img src="/icons/pin-open.png" alt=""> Playa — el color
        marca su estado</div>
      <div><img src="/icons/pin-outfall-legal.png" alt=""> Emisario
        autorizado</div>
      <div><img src="/icons/pin-outfall-processing.png" alt="">
        Emisario en trámite</div>
      <div><img src="/icons/pin-outfall-illegal.png" alt=""> Emisario
        no autorizado</div>
    </div>
    <p class="sfoot">App gratuita para Android · Datos: Náyade /
      Min. Sanidad · MITECO · OpenStreetMap · © Esri</p>
  </aside>
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
  document.getElementById('yrs-ecoli').className =
    'yrow' + (p === 'ecoli' ? '' : ' hidden');
  document.getElementById('yrs-enterococci').className =
    'yrow' + (p === 'enterococci' ? '' : ' hidden');
  document.getElementById('tb-ecoli').className =
    'tbtn' + (p === 'ecoli' ? ' ton' : '');
  document.getElementById('tb-enterococci').className =
    'tbtn' + (p === 'enterococci' ? ' ton' : '');
  document.getElementById('foot-ecoli').className =
    p === 'ecoli' ? '' : 'hidden';
  document.getElementById('foot-enterococci').className =
    p === 'enterococci' ? '' : 'hidden';
}}
var urls = {json.dumps(urls)};
var z = {start};
function zoom(d) {{
  z = Math.max(0, Math.min(urls.length - 1, z + d));
  document.getElementById('shot').src = urls[z];
  for (var i = 0; i < urls.length; i++) {{
    document.getElementById('dots-' + i).className =
      i === z ? '' : 'hidden';
  }}
  document.getElementById('zin').disabled = z === 0;
  document.getElementById('zout').disabled = z === urls.length - 1;
}}
zoom(0);
</script>
</html>"""
    # no-cache: el HTML se revalida siempre (los navegadores cacheaban la
    # landing y se veían versiones viejas tras cada despliegue)
    return HTMLResponse(
        content=page,
        headers={"Cache-Control": "no-cache"},
    )


# Encuadre de Tenerife entera para la portada (centro aprox. de la isla)
_ISLAND = (-16.55, 28.30, 0.44, 0.31)


def _shot_url_fit(lon: float, lat: float, dlon: float, dlat: float,
                  w: int) -> str:
    """_shot_url con alto proporcional al bbox. Esri expande el bbox
    cuando su ratio no coincide con size — eso descuadraba los puntos
    del mapa de la isla respecto a la costa."""
    h = round(w * dlat / dlon)
    return (
        "https://server.arcgisonline.com/ArcGIS/rest/services/"
        f"World_Imagery/MapServer/export?bbox={lon - dlon},"
        f"{lat - dlat},{lon + dlon},{lat + dlat}"
        f"&bboxSR=4326&imageSR=4326&size={w},{h}&format=png&f=image"
    )


@router.get("/", response_class=HTMLResponse)
def home(db: Session = Depends(get_db)) -> HTMLResponse:
    """Portada del proyecto: la puerta de entrada pública.

    Hero + mapa vivo de la isla + alertas reales + playas de ejemplo
    enlazables a su /b/{id} — la demo completa sin instalar nada."""
    from app.routers.alerts import list_alerts

    status_counts = _live_status_counts(db)
    total_beaches = db.query(func.count(Beach.id)).scalar()
    island_alerts = list_alerts(db)
    alert_state = {a.beach_id: a.status for a in island_alerts}

    # Puntos del mapa isla: cada playa con su estado (oficial; las
    # alertas vivas — incluidas las de prensa — pisan al oficial para
    # que el mapa cuente lo mismo que la lista de alertas)
    all_beaches = (
        beaches_with_latest_status(db)
        .add_columns(
            func.ST_X(Beach.geom).label("lon"),
            func.ST_Y(Beach.geom).label("lat"),
        )
        .all()
    )
    clon, clat, dlon, dlat = _ISLAND
    dots = ""
    for beach, status, lon, lat in all_beaches:
        if lon is None:
            continue
        st = alert_state.get(
            beach.id, status.status.value if status else "unknown"
        )
        x, y = _px(lon, lat, clon, clat, dlon, dlat)
        if 0 <= x <= 100 and 0 <= y <= 100:
            col = _STATUS.get(st, _STATUS["unknown"])[1]
            # Las playas con alerta viva pulsan (mismo gesto que los
            # pines parpadeantes de la app) — entre 192 dots, lo único
            # que el visitante necesita localizar es lo que pita
            alert_cls = " alert" if beach.id in alert_state else ""
            dots += (
                f'<i class="mdot{alert_cls}" style="left:{x:.1f}%;'
                f'top:{y:.1f}%;background:{col};--pc:{col}"'
                f' title="{html.escape(_display_name(beach.name))}"></i>'
            )

    # Alertas vivas (misma lista que el panel lateral de /b/)
    alert_rows = ""
    now = datetime.now(timezone.utc)
    for a in island_alerts[:5]:
        rep = a.reported_at
        via = "según prensa" if a.via == "press" else "oficial"
        acolor = _STATUS.get(a.status, _STATUS["unknown"])[1]
        aword = "cerrada" if a.status == "closed" else "aviso"
        alert_rows += (
            f'<a class="sal sal-{"c" if a.status == "closed" else "w"}"'
            f' href="/b/{a.beach_id}">'
            f'<i style="background:{acolor}"></i><div>'
            f"<b>{html.escape(_display_name(a.beach_name))}</b>"
            f"<span>{_alert_when(aword, rep, now)} · {via} · "
            f'{html.escape(a.municipality or "")}</span></div></a>'
        )
    alerts_block = (
        f'<div class="sec">Alertas activas en la isla</div>'
        f'<div class="abox">{alert_rows}</div>'
        if alert_rows else ""
    )

    # Playas de ejemplo: las alertas actuales + las monitorizadas con
    # más analíticas (su landing enseña la gráfica histórica)
    example_ids = [a.beach_id for a in island_alerts[:3]]
    fillers = (
        db.query(BeachMeasurement.beach_id, func.count().label("n"))
        .group_by(BeachMeasurement.beach_id)
        .order_by(func.count().desc())
        .limit(6)
        .all()
    )
    for f in fillers:
        if len(example_ids) >= 4:
            break
        if f.beach_id not in example_ids:
            example_ids.append(f.beach_id)

    cards = ""
    ex_rows = {
        b.id: (b, st, lon, lat)
        for b, st, lon, lat in all_beaches
        if b.id in example_ids
    }
    for bid in example_ids:
        row = ex_rows.get(bid)
        if not row:
            continue
        b, st, lon, lat = row
        state = alert_state.get(bid, st.status.value if st else "unknown")
        lbl, col = _STATUS.get(state, _STATUS["unknown"])
        alert = next(
            (a for a in island_alerts if a.beach_id == bid), None
        )
        via = (
            ' · <span class="bcvia">según prensa</span>'
            if alert and alert.via == "press" else ""
        )
        thumb = _shot_url(lon, lat, 0.006, 0.0033)
        cards += (
            f'<a class="bc" href="/b/{bid}">'
            f'<div class="bimg" style="background-image:url(\'{html.escape(thumb)}\')">'
            f'<span class="bcchip" style="background:{col}">{lbl}</span>'
            f"</div>"
            f'<div class="bcname">{html.escape(_display_name(b.name))}</div>'
            f'<div class="bcmuni">{html.escape(b.municipality or "")}{via}</div>'
            f"</a>"
        )
    examples_block = (
        '<div class="sec">Explora una playa</div>'
        '<div class="exnote">Ejemplos destacados — la lista completa, '
        "con filtros por municipio y estado, está en la app</div>"
        f'<div class="bgrid">{cards}</div>'
        if cards else ""
    )

    island_url = _shot_url_fit(clon, clat, dlon, dlat, 920)
    page = f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CheckCoast Tenerife — ¿Puedes bañarte hoy?</title>
<link rel="icon" type="image/png" href="/icons/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<meta property="og:type" content="website">
<meta property="og:site_name" content="CheckCoast Tenerife">
<meta property="og:title" content="CheckCoast Tenerife">
<meta property="og:description" content="El estado oficial de cada playa de Tenerife — y el porqué cuando el parte no lo dice.">
<meta property="og:image" content="{html.escape(island_url)}">
<meta name="twitter:card" content="summary_large_image">
<style>
  body {{ margin:0; font-family:'Inter',system-ui,sans-serif;
         min-height:100vh; display:flex; justify-content:center;
         padding:24px 16px; }}
  body::before {{ content:''; position:fixed; inset:-70px; z-index:-2;
         background:url("{island_url}") center/cover no-repeat;
         filter:blur(30px) brightness(.8) saturate(1.15); }}
  body::after {{ content:''; position:fixed; inset:0; z-index:-1;
         background:linear-gradient(160deg,
           rgba(7,43,62,.62),rgba(7,82,118,.42)); }}
  .page {{ width:100%; max-width:480px; }}
  @media (min-width:900px) {{ .page {{ max-width:880px; }} }}
  .brand {{ display:flex; align-items:center; gap:10px; color:#fff;
          font-weight:700; font-size:19px; letter-spacing:.2px;
          text-shadow:0 1px 4px rgba(0,0,0,.4); }}
  .brand img {{ width:42px; height:42px; border-radius:10px;
          box-shadow:0 2px 6px rgba(0,0,0,.3); }}
  .tfe {{ font-weight:400; color:#a8d4e0; }}
  .hero {{ color:#fff; margin:18px 0 16px;
          text-shadow:0 1px 4px rgba(0,0,0,.4); }}
  .hero h1 {{ margin:0; font-size:26px; line-height:1.2; }}
  .hero p {{ margin:8px 0 0; font-size:14px; line-height:1.5;
          color:#dcebf2; }}
  .stat {{ background:rgba(255,255,255,.92); border-radius:12px;
          padding:10px 14px; font-size:13px; color:#0d3a52;
          margin-bottom:14px; }}
  .stat b {{ color:#075276; }}
  .stat .sl {{ font-size:11px; color:#6d8b9a; font-weight:600;
          text-transform:uppercase; letter-spacing:.4px; }}
  .card {{ background:#fff; border-radius:16px; overflow:hidden;
          box-shadow:0 18px 60px rgba(7,43,62,.30); }}
  .imap {{ position:relative; }}
  .imap img {{ display:block; width:100%; height:auto; }}
  .mdot {{ position:absolute; width:8px; height:8px; border-radius:50%;
          border:1.5px solid rgba(255,255,255,.9);
          transform:translate(-50%,-50%);
          box-shadow:0 1px 3px rgba(0,0,0,.45); }}
  .mdot.alert {{ width:11px; height:11px; z-index:2;
          animation:mpulse 1.7s ease-out infinite; }}
  @keyframes mpulse {{
    0% {{ box-shadow:0 0 0 0 var(--pc, rgba(198,40,40,.55)); }}
    100% {{ box-shadow:0 0 0 11px rgba(198,40,40,0); }} }}
  .ibody {{ padding:16px 20px 20px;
          background:
            radial-gradient(900px 320px at 15% 0%,
              rgba(255,255,255,.55), rgba(255,255,255,0) 60%),
            linear-gradient(180deg,#e2eef6 0%,#d8e9f2 55%,#cfe2ec 100%); }}
  .sec {{ margin-top:22px; font-size:15px; font-weight:700;
          color:#0d3a52; }}
  .sec ~ .sec {{ border-top:1px solid #b9d3e2; padding-top:20px; }}
  .lower {{ margin-top:22px; border-top:1px solid #b9d3e2;
          padding-top:20px; }}
  .lower .sec {{ margin-top:0; }}
  .lcol {{ display:flex; flex-direction:column; }}
  .lcol .steps {{ display:flex; flex-direction:column;
          justify-content:space-between; gap:8px; flex:1; }}
  .rcol {{ margin-top:16px; display:flex;
          flex-direction:column; }}
  .rcards {{ margin-top:10px; display:flex; gap:10px;
          align-items:stretch; flex-wrap:wrap; flex:1; }}
  .gmain {{ flex:1; }}
  .gfeats {{ display:flex; flex-direction:column; gap:4px;
          margin-top:9px; }}
  .gfeats span {{ font-size:11.5px; color:#33566b; }}
  .gfeats i {{ font-style:normal; font-weight:700;
          color:#0a7a4f; }}
  .gside {{ display:flex; flex-direction:column; gap:10px;
          flex:1; min-width:150px; }}
  .gsrow {{ flex-direction:row; gap:12px; flex:1;
          padding:10px 14px; }}
  .abox {{ margin-top:8px; }}
  .sal {{ display:flex; align-items:center; gap:9px; margin-top:9px;
          text-decoration:none; border-radius:10px;
          padding:8px 11px; }}
  .sal.sal-c {{ background:#fdeceb; border:1px solid #f0c4bd; }}
  .sal.sal-w {{ background:#fdf1da; border:1px solid #eec27e; }}
  .sal i {{ flex:none; width:9px; height:9px; border-radius:50%; }}
  .sal b {{ display:block; font-size:12px; color:#0d3a52;
          font-weight:600; }}
  .sal:hover b {{ color:#075276; }}
  .sal span {{ font-size:10.5px; color:#7a919c; }}
  @media (min-width:900px) {{
    .abox {{ display:grid; grid-template-columns:1fr 1fr;
            gap:0 24px; }}
    .bgrid {{ grid-template-columns:repeat(4,1fr) !important; }}
    .lower {{ display:grid; grid-template-columns:repeat(4,1fr);
            gap:10px; }}
    .lcol {{ grid-column:1/3; }}
    .rcol {{ grid-column:3/5; margin-top:0; }}
    .rcards {{ flex-wrap:nowrap; }}
  }}
  .bgrid {{ display:grid; grid-template-columns:1fr 1fr; gap:10px;
          margin-top:10px; }}
  .bc {{ text-decoration:none; border-radius:12px; overflow:hidden;
          background:#fff; border:1px solid #c9dfea; }}
  .bc:hover {{ border-color:#17b8ce; }}
  .bimg {{ position:relative; height:86px; background-size:cover;
          background-position:center; }}
  .bcchip {{ position:absolute; left:8px; bottom:8px; color:#fff;
          font-size:10px; font-weight:700; border-radius:999px;
          padding:3px 9px; }}
  .bcname {{ font-size:12.5px; font-weight:700; color:#0d3a52;
          padding:8px 10px 0; }}
  .bcmuni {{ font-size:10.5px; color:#7a919c; padding:1px 10px 9px; }}
  .bcvia {{ color:#8a6d1a; font-weight:600; }}
  .steps {{ margin-top:16px; }}
  .steps {{ display:grid; grid-template-columns:1fr 1fr; gap:8px;
          margin-top:10px; }}
  .step {{ display:flex; gap:9px; align-items:flex-start;
          background:#fff; border:1px solid #c9dfea;
          border-radius:12px; padding:10px 12px; }}
  .stepn {{ flex:none; width:20px; height:20px; border-radius:50%;
          background:#075276; color:#fff; font-size:11px;
          font-weight:700; display:flex; align-items:center;
          justify-content:center; margin-top:1px; }}
  .step b {{ font-size:12.5px; color:#0d3a52; }}
  .step span {{ display:block; font-size:11.5px; color:#5b7a8a;
          margin-top:1px; }}
  .exnote {{ font-size:11.5px; color:#7a919c; margin-top:2px; }}
  .gcard {{ background:#fff; border:1px solid #c9dfea;
          border-radius:12px; padding:14px 20px; flex:1;
          display:flex; flex-direction:column; gap:8px;
          align-items:center; justify-content:center; }}
  .gmain {{ align-items:flex-start; justify-content:flex-start;
          min-width:180px; }}
  .gmain .gdl {{ align-self:center; margin-top:auto;
          margin-bottom:4px; }}
  .gmain b {{ font-size:12.5px; color:#0d3a52; }}
  .gtx {{ font-size:12px; color:#33566b; line-height:1.45; }}
  .gdl {{ display:inline-block; background:#075276; color:#fff;
          font-size:13.5px; font-weight:700; padding:10px 16px;
          border-radius:9px; text-decoration:none; }}
  .gdl:hover {{ background:#0a628c; }}
  .gsoon {{ display:none; font-size:11px; color:#e65100;
          font-weight:600; }}
  .ggh {{ color:#24292f; text-decoration:none; }}
  .ggh:hover {{ color:#075276; }}
  .ggh span {{ font-size:12px; text-align:center; line-height:1.3;
          color:#33566b; font-weight:600; }}
  .gqr {{ width:74px; height:74px; background:#fff;
          padding:4px; border-radius:8px; flex:none; }}
  .gqrbox span, .gsrow span {{ font-size:11.5px; color:#33566b;
          font-weight:600; text-align:left; line-height:1.3; }}
  .src {{ margin-top:14px; font-size:11px; color:#7a919c; }}
  .foot {{ margin:14px 4px 0; font-size:11px; color:#a8c4d2;
          text-align:center; }}
</style>
</head>
<body>
<div class="page">
  <div class="brand">
    <img src="/icons/app-icon.png" alt="">CheckCoast
    <span class="tfe">Tenerife</span>
  </div>
  <div class="hero">
    <h1>¿Puedes bañarte hoy?</h1>
    <p>El estado oficial de cada playa de Tenerife — y el porqué
      cuando el parte no lo dice.</p>
  </div>
  <div class="stat"><div class="sl">Ahora mismo en Tenerife</div>
    <b>{status_counts.get('closed', 0)}</b> cerradas ·
    <b>{status_counts.get('warning', 0)}</b> con aviso ·
    <b>{total_beaches}</b> playas mapeadas</div>
  <div class="card">
    <div class="imap">
      <img src="{html.escape(island_url)}" alt="Tenerife">
      {dots}
    </div>
    <div class="ibody">
      {alerts_block}
      {examples_block}
      <div class="lower">
      <div class="lcol">
      <div class="sec">Cómo funciona</div>
      <div class="steps">
        <div class="step"><div class="stepn">1</div><div>
          <b>Náyade / Sanidad</b>
          <span>Estado oficial, cierres y analíticas del agua cada hora.</span>
        </div></div>
        <div class="step"><div class="stepn">2</div><div>
          <b>Prensa local</b>
          <span>El porqué de los cierres, etiquetado «según prensa».</span>
        </div></div>
        <div class="step"><div class="stepn">3</div><div>
          <b>Emisarios</b>
          <span>Los 180 vertidos del censo costero con su situación legal,
            junto a cada playa.</span>
        </div></div>
        <div class="step"><div class="stepn">4</div><div>
          <b>Municipios</b>
          <span>Ranking por ayuntamiento: cierres, avisos y calidad
            del agua.</span>
        </div></div>
      </div>
      </div>
      <div class="rcol">
      <div class="sec">Llévala en el bolsillo</div>
      <div class="rcards">
        <div class="gcard gmain">
          <b>El estado de tu playa al abrir el móvil.</b>
          <div class="gfeats">
            <span><i>✓</i> Aviso cuando tu playa cierra o reabre</span>
            <span><i>✓</i> Las 192 playas — ordena por municipio,
              estado o calidad</span>
            <span><i>✓</i> Entérate de todos los incidentes
              de este verano</span>
          </div>
          <a class="gdl" href="#"
            onclick="document.getElementById('gpsoon').style.display='block';return false;">
            Descargar para Android</a>
          <div class="gsoon" id="gpsoon">Próximamente disponible</div>
        </div>
        <div class="gside">
          <div class="gcard gsrow">
            <img class="gqr" src="/img/qr-github.png"
              alt="QR a las descargas en GitHub">
            <span>Descarga la APK<br>en tu móvil</span>
          </div>
          <a class="gcard gsrow ggh"
            href="https://github.com/ayozegr05/checkcoast-tenerife">
          <svg viewBox="0 0 24 24" width="42" height="42"
            fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
            <span>Código abierto<br>en GitHub</span>
          </a>
        </div>
      </div>
      </div>
      </div>
      <p class="src">Datos: Náyade / Min. Sanidad · MITECO ·
        OpenStreetMap · © Esri</p>
    </div>
  </div>
  <p class="foot">CheckCoast Tenerife · proyecto cívico de datos
    abiertos</p>
</div>
</body>
</html>"""
    return HTMLResponse(
        content=page,
        headers={"Cache-Control": "no-cache"},
    )

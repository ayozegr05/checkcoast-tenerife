"""Mini página pública por playa para compartir (WhatsApp/Telegram).

Sirve HTML con Open Graph (título, estado, foto satélite Esri) para que
los mensajeros generen la tarjeta rica; en el navegador muestra una
mini-ficha — réplica web de la ficha de la app — con enlace profundo
`checkcoast://beach/{id}`.
"""

import io
import math
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, Response
from geoalchemy2 import Geography, Geometry
from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import cast, func, literal
from sqlalchemy.orm import Session

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
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
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
        rep = rep.replace(tzinfo=UTC)
    days = (now - rep).days if rep else 0
    if days <= 30:
        ago = (
            "hoy"
            if days == 0
            else "ayer"
            if days == 1
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
    (0.003, 0.0017),  # muy cerca
    (0.006, 0.0033),  # cerca
    (0.015, 0.0083),  # lejos
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

_NEARBY_OUTFALL_RADIUS_M = (
    1000  # mismo radio que /beaches/{id}/nearby-outfalls
)

_ICONS = Path(__file__).resolve().parent.parent / "static" / "icons"
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


_FONTS = [
    (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ),
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
_CHART_H = 88  # px, igual que la app
_LOG_CAP = 100000  # los valores llegan a >24000


def _num(raw: str | None) -> float | None:
    """'9 UFC/100 mL' / '<10' / '>24000' -> número; None si no hay."""
    if not raw:
        return None
    m = re.search(r"\d+(?:\.\d+)?", raw)
    return float(m.group(0)) if m else None


def _bar_h(v: float) -> int:
    return max(
        3, round(_CHART_H * math.log10(max(v, 1)) / math.log10(_LOG_CAP))
    )


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
    "medano": "médano",
    "guios": "guíos",
    "guimar": "güímar",
    "americas": "américas",
    "camison": "camisón",
    "jaquita": "jaquita",
    "almaciga": "almáciga",
    "amricas": "américas",
    "camisn": "camisón",
    "gimar": "güímar",
}
_ARTICLE_PAREN = re.compile(r"\s*\((EL|LA|LOS|LAS)\)", re.I)
_DE_FORMS = {"el": "del", "la": "de la", "los": "de los", "las": "de las"}
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
    lon: float,
    lat: float,
    clon: float,
    clat: float,
    dlon: float,
    dlat: float,
) -> tuple[float, float]:
    """lon/lat → posición (x%, y%) dentro del recuadro satélite."""
    x = (lon - (clon - dlon)) / (2 * dlon) * 100
    y = ((clat + dlat) - lat) / (2 * dlat) * 100
    return x, y


def _dots(
    outfalls, lon: float, lat: float, dlon: float, dlat: float
) -> list[dict]:
    """Pins de emisarios sobre la foto (mismos PNG que la app)."""
    return [
        {
            "x": f"{x:.1f}",
            "y": f"{y:.1f}",
            "pin": _OUTFALL_PIN.get(o.status.value, _OUTFALL_PIN["unknown"]),
            "title": o.name,
        }
        for o in outfalls
        for x, y in [_px(o.olon, o.olat, lon, lat, dlon, dlat)]
        if 0 <= x <= 100 and 0 <= y <= 100  # fuera del encuadre: no pintar
    ]


def _alert_cards(alerts, now: datetime) -> list[dict]:
    """Filas de alerta viva enlazables a su /b/{id} — la misma regla
    que /alerts, compartida por el panel lateral de /b/ y la portada."""
    return [
        {
            "cls": "c" if a.status == "closed" else "w",
            "beach_id": a.beach_id,
            "color": _STATUS.get(a.status, _STATUS["unknown"])[1],
            "name": _display_name(a.beach_name),
            "meta": (
                f"{
                    _alert_when(
                        'cerrada' if a.status == 'closed' else 'aviso',
                        a.reported_at,
                        now,
                    )
                } · {'según prensa' if a.via == 'press' else 'oficial'}"
                f" · {a.municipality or ''}"
            ),
        }
        for a in alerts
    ]


def _effective_state(
    db: Session, beach: Beach, official: str | None, news_items: list
) -> tuple[str, str | None]:
    """(state, press_label) — replica la regla de /alerts: el oficial
    manda, pero prensa fresca dominada por cierres escala
    warning->closed y decide en playas sin monitorización."""
    state = official or "unknown"
    press_label: str | None = None
    cutoff = datetime.now(UTC) - timedelta(days=21)
    if (
        news_items
        and news_items[0].published_at
        and news_items[0].published_at >= cutoff
    ):
        change = next(
            (
                i
                for i in news_items
                if i.event_type in ("closure", "reopening")
            ),
            None,
        )
        warn = next(
            (
                i
                for i in news_items
                if i.event_type in ("warning", "pollution")
            ),
            None,
        )
        press_ev = None
        if change and change.event_type == "closure":
            press_ev = change
        elif warn and (
            change is None
            or (warn.published_at or datetime.min.replace(tzinfo=UTC))
            > (change.published_at or datetime.min.replace(tzinfo=UTC))
        ):
            press_ev = warn
        counts: dict[str, int] = {}
        for i in news_items:
            if i.event_type and i.event_type != "other":
                counts[i.event_type] = counts.get(i.event_type, 0) + 1
        dominant = (
            "closure"
            if counts.get("closure")
            else (max(counts, key=counts.get) if counts else None)
        )
        pstate = (
            "closed"
            if press_ev and press_ev.event_type == "closure"
            else ("warning" if press_ev else None)
        )
        if official in ("closed", "warning"):
            if pstate == "closed" or dominant == "closure":
                state, press_label = "closed", "según prensa"
        elif official == "open":
            # ventana de gracia 14 días + sin reapertura formal posterior
            grace = datetime.now(UTC) - timedelta(days=14)
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
                pstate == "closed"
                and when
                and when >= grace
                and not (resolved and resolved >= when.date())
            ):
                state, press_label = "closed", "según prensa"
        elif pstate:
            state, press_label = pstate, "según prensa"
    return state, press_label


def _og_png(
    beach, lon: float, lat: float, state: str, label: str, color: str
) -> bytes:
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
        bd.line([(0, y), (_OG_W, y)], fill=(8, 32, 46, int(235 * (y / 190))))
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
    state, press_label = _effective_state(db, beach, official, news_items)

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
            func.ST_Distance(beach_geog, Outfall.geom.cast(Geography)).label(
                "distance_m"
            ),
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

    name = _display_name(beach.name)
    muni = beach.municipality or "Tenerife"
    # Cabecera teñida por estado efectivo, como la ficha de la app
    head_bg = {
        "closed": "linear-gradient(180deg,#7a1f1f,#c62828)",
        "warning": "linear-gradient(180deg,#8a3c00,#e65100)",
    }.get(state, "linear-gradient(180deg,#075276,#17b8ce)")
    # La ola que separa cabecera y foto sigue el color final del
    # degradado del header
    wave_c = {"closed": "#c62828", "warning": "#e65100"}.get(state, "#17b8ce")
    title = f"{name} · {muni}"
    urls = [_shot_url(lon, lat, *d) for d in _SHOT_LEVELS]
    deep = f"checkcoast://beach/{beach.id}"

    # Un nivel de dots por encuadre de zoom; se empieza en el más lejano
    start = len(_SHOT_LEVELS) - 1
    dots_levels = [_dots(outfalls, lon, lat, *d) for d in _SHOT_LEVELS]

    latest_line = None
    if latest:
        ev = latest.evaluation or "sin evaluación"
        latest_line = (
            f"Último análisis: {latest.sampled_at.strftime('%d/%m/%Y')} · {ev}"
        )

    # Distancia como cifra destacada (como en la ficha de la app);
    # <500 m va en naranja de aviso — es el dato que impacta
    outfall_ctxs = [
        {
            "name": o.name,
            "status_label": _OUTFALL_STATUS.get(
                o.status.value, _OUTFALL_STATUS["unknown"]
            )[0],
            "color": _OUTFALL_STATUS.get(
                o.status.value, _OUTFALL_STATUS["unknown"]
            )[1],
            "dist": round(o.distance_m),
            "near": o.distance_m < 500,
        }
        for o in outfalls
    ]

    # Gráfica de evolución (barras log-escala como la app): dos series
    # pre-renderizadas, el toggle solo cambia visibilidad
    chart = None
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
        inc_marks = [
            f"{pos:.1f}"
            for i in incidents
            for pos in [((i.opened_at - d0).days / span) * 100]
            if 0 <= pos <= 100
        ]
        panels = []
        for param in ("ecoli", "enterococci"):
            pts = series[param]
            bars = [
                {
                    "h": _bar_h(v),
                    "color": _qcolor(param, v),
                    "title": f"{d.strftime('%d/%m/%Y')} · {v:g} UFC/100 mL",
                }
                for d, v in pts
            ]
            # Etiqueta de año en la primera barra de cada año
            ycells, last_yr = [], None
            for d, _ in pts:
                yr = d.strftime("%Y")
                ycells.append(yr if yr != last_yr else "")
                last_yr = yr
            panels.append(
                {
                    "param": param,
                    "hidden": param != "ecoli",
                    "lim_y": _bar_h(_QUALITY[param]["good"]),
                    "bars": bars,
                    "ycells": ycells,
                    "n": len(pts),
                    "good": _QUALITY[param]["good"],
                }
            )
        chart = {"inc_marks": inc_marks, "panels": panels}

    incident_ctxs = [
        {
            "opened": i.opened_at.strftime("%d/%m/%Y"),
            "closed": (
                i.closed_at.strftime("%d/%m/%Y") if i.closed_at else None
            ),
            "obs": i.observations[:120] if i.observations else None,
        }
        for i in incidents
    ]

    # Banner "según prensa" como en la app: evento dominante + causa +
    # desde + nº medios; debajo hasta 3 titulares enlazables — venden el
    # "porqué" mejor que uno solo
    press_cls = (
        "press n-closed"
        if state == "closed"
        else "press n-warning"
        if state == "warning"
        else "press"
    )
    press = None
    if news_items:
        counts_ev: dict[str, int] = {}
        for it in news_items:
            if it.event_type and it.event_type != "other":
                counts_ev[it.event_type] = counts_ev.get(it.event_type, 0) + 1
        dom = (
            "closure"
            if counts_ev.get("closure")
            else (max(counts_ev, key=counts_ev.get) if counts_ev else None)
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
            "closure": "Cerrada",
            "warning": "Aviso en",
            "pollution": "Contaminación en",
            "reopening": "Reabierta",
        }.get(dom or "", "Mencionada")
        if dom == "closure" and state != "closed":
            ev_word = "Estuvo cerrada" if state == "open" else "Cerrada"
        line = ev_word + (f" por {cause}" if cause else "")
        if since:
            line += f" · desde el {since.strftime('%d/%m/%Y')}"
        # reapertura oficial probada: incidente cerrado tras el titular
        closed_after = next(
            (
                i.closed_at
                for i in incidents
                if i.closed_at and since and i.closed_at >= since.date()
            ),
            None,
        )
        if closed_after:
            line += (
                f" · Sanidad la reabrió el {closed_after.strftime('%d/%m/%Y')}"
            )
        press = {
            "cls": press_cls,
            "line": line,
            "tag": (
                f"según prensa · {outlets} medio{'s' if outlets != 1 else ''}"
            ),
            "titles": [
                {
                    "url": n.url,
                    "title": n.title,
                    "meta": (n.source or "")
                    + (
                        f" · {n.published_at.strftime('%d/%m/%Y')}"
                        if n.published_at
                        else ""
                    ),
                }
                for n in news_items[:3]
            ],
        }

    # Con cierre/aviso activo el motivo es lo primero que importa:
    # si el estado lo decide la prensa, su banner sube arriba del todo;
    # si es oficial, se resume el incidente abierto
    notice = None
    if state in ("closed", "warning"):
        if press and press_label:
            notice, press = press, None
        else:
            active_inc = next(
                (i for i in incidents if i.closed_at is None), None
            )
            if active_inc:
                verb = "Cerrada" if state == "closed" else "Aviso activo"
                obs = (active_inc.observations or "").strip()
                nline = verb + (f" — {obs[:140]}" if obs else "")
                nline += (
                    f" · desde el {active_inc.opened_at.strftime('%d/%m/%Y')}"
                )
                notice = {
                    "cls": press_cls,
                    "line": nline,
                    "tag": "estado oficial · Náyade / Sanidad",
                    "titles": [],
                }

    # og:description lleva el motivo cuando hay cierre/aviso —
    # es lo que la gente quiere saber al ver la tarjeta
    desc = f"Estado: {label} — CheckCoast Tenerife"
    if notice:
        desc = f"{notice['line']} — CheckCoast Tenerife"

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

    salerts = _alert_cards(list_alerts(db)[:4], datetime.now(UTC))

    return _page(
        "beach.html",
        title=title,
        desc=desc,
        public_url=settings.public_url,
        beach_id=beach.id,
        head_bg=head_bg,
        wave_c=wave_c,
        name=name,
        muni=muni,
        # En CSS url() y en el JS la URL va en crudo (|safe / tojson);
        # en atributos el autoescape la escribe como &amp; — correcto
        bg_url=urls[start],
        shot_src=urls[start],
        urls=urls,
        start=start,
        dots_levels=dots_levels,
        pin=_PIN.get(state, _PIN["unknown"]),
        label=label,
        color=color,
        notice=notice,
        latest_line=latest_line,
        outfalls=outfall_ctxs,
        press=press,
        chart=chart,
        chart_h=_CHART_H,
        incidents=incident_ctxs,
        deep=deep,
        foot=foot,
        n_closed=status_counts.get("closed", 0),
        n_warning=status_counts.get("warning", 0),
        total_beaches=total_beaches,
        salerts=salerts,
    )


# Encuadre de Tenerife entera para la portada (centro aprox. de la isla)
_ISLAND = (-16.55, 28.30, 0.44, 0.31)


def _shot_url_fit(
    lon: float, lat: float, dlon: float, dlat: float, w: int
) -> str:
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
    map_dots = []
    for beach, status, lon, lat in all_beaches:
        if lon is None:
            continue
        st = alert_state.get(
            beach.id, status.status.value if status else "unknown"
        )
        x, y = _px(lon, lat, clon, clat, dlon, dlat)
        if 0 <= x <= 100 and 0 <= y <= 100:
            map_dots.append(
                {
                    "x": f"{x:.1f}",
                    "y": f"{y:.1f}",
                    "col": _STATUS.get(st, _STATUS["unknown"])[1],
                    # Las playas con alerta viva pulsan (mismo gesto que
                    # los pines parpadeantes de la app) — entre 192 dots,
                    # lo único que el visitante necesita localizar es lo
                    # que pita
                    "alert": beach.id in alert_state,
                    "name": _display_name(beach.name),
                }
            )

    # Alertas vivas (misma lista que el panel lateral de /b/)
    alerts = _alert_cards(island_alerts[:5], datetime.now(UTC))

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

    ex_rows = {
        b.id: (b, st, lon, lat)
        for b, st, lon, lat in all_beaches
        if b.id in example_ids
    }
    cards = []
    for bid in example_ids:
        row = ex_rows.get(bid)
        if not row:
            continue
        b, st, lon, lat = row
        state = alert_state.get(bid, st.status.value if st else "unknown")
        lbl, col = _STATUS.get(state, _STATUS["unknown"])
        alert = next((a for a in island_alerts if a.beach_id == bid), None)
        cards.append(
            {
                "beach_id": bid,
                "thumb": _shot_url(lon, lat, 0.006, 0.0033),
                "label": lbl,
                "color": col,
                "name": _display_name(b.name),
                "muni": b.municipality or "",
                "via_press": bool(alert and alert.via == "press"),
            }
        )

    island_url = _shot_url_fit(clon, clat, dlon, dlat, 920)
    return _page(
        "home.html",
        island_url=island_url,
        n_closed=status_counts.get("closed", 0),
        n_warning=status_counts.get("warning", 0),
        total_beaches=total_beaches,
        map_dots=map_dots,
        alerts=alerts,
        cards=cards,
    )


@router.get("/privacy", response_class=HTMLResponse)
def privacy() -> HTMLResponse:
    """Política de privacidad — exigida por Play Store (push tokens)."""
    return HTMLResponse(
        content=_jinja.get_template("privacy.html").render(),
    )

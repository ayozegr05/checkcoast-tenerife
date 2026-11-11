"""Contexto de las plantillas públicas (/, /b/{id}).

Extraído del router share.py: toda la presentación — formato de
nombres MITECO, chips/colores de estado, encuadres satélite Esri,
dots sobre la foto, tarjetas de alerta, banner "según prensa",
gráfica log-escala e imagen OG — vive aquí, testeable sin HTTP.
El router queda como orquestador: query, 404 y _page(**ctx).
"""

import io
import math
import re
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx
from geoalchemy2 import Geography, Geometry
from sqlalchemy import cast, func, literal
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.events import (
    _closed_since_date,
    fuse_official_episodes,
    synthesize_events,
)
from app.models import (
    Beach,
    BeachIncident,
    BeachMeasurement,
    BeachStatus,
    JobRun,
    NewsItem,
    Outfall,
)
from app.names import (
    ARENAL_BASES,
    PM_SUFFIX,
    arenal_base,
    beach_group_key,
    normalize_beach_name,
)
from app.news_episodes import (
    _news_cause,
    anchor_is_new_closure_wave,
    press_episode_summary,
)
from app.news_infra import (
    gather_infra_news,
    infra_cause_of,
    norm_txt,
)
from app.news_matching import _norm_muni
from app.news_zones import _ZONE_GROUPS, _zone_entry
from app.queries import (
    _CAUSE_RANK,
    _short_cause,
    beaches_with_latest_status,
    clean_cause_text,
    effective_states,
)
from app.routers.beaches import _collect_episodes, _merged_episode_rows

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

_MONTHS_FULL = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
]

# Encuadres satélite de más cerca a más lejos (dlon, dlat en grados)
_SHOT_LEVELS = [
    (0.0018, 0.00085),  # detalle — mismo tope que la app (~170 m de
    # encuadre ≈ 0,3-0,5 m/px, el límite útil de Esri: más pixela)
    (0.003, 0.0017),  # muy cerca
    (0.006, 0.0033),  # cerca
    (0.015, 0.0083),  # lejos
]

# Mismos textos que la ficha de la app — "structural" es la variante
# granate del cierre (desprendimientos/obras), no un estado propio
_STATUS = {
    "closed": ("Cierre activo", "#d50000"),
    "structural": ("Cierre estructural", "#8c322a"),
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
    "structural": "pin-structural",
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

_ICONS = Path(__file__).resolve().parent / "static" / "icons"

# Umbrales RD 1341/2007 (aguas costeras, UFC/100 mL) — mismos que la app
_QUALITY: dict[str, dict[str, int | str]] = {
    "ecoli": {"excellent": 250, "good": 500, "label": "E. coli"},
    "enterococci": {"excellent": 100, "good": 200, "label": "Enterococo"},
}
_CHART_H = 88  # px, igual que la app
_LOG_CAP = 100000  # los valores llegan a >24000

# Encuadre de Tenerife entera para la portada (centro aprox. de la isla)
# Encuadre con ~8% de mar alrededor — la isla y los pines
# respiran en vez de tocar los bordes de la foto
_ISLAND = (-16.55, 28.30, 0.47, 0.33)


def _live_status_counts(db: Session, effs: dict) -> dict[str, int]:
    """Recuento de estados efectivos AHORA por PLAYA, no por punto de
    muestreo — la app cuenta el grupo (Punta Larga PM1+PM2 cerradas =
    1 cerrada, no 2). Misma clave de grupo que groupedBeaches
    (municipio + beachGroupKey) y mismo representante: el peor estado
    del arenal. Antes: contaba todas las filas históricas de
    beach_statuses; después: contaba cada PM por separado."""
    meta = {
        r.id: (r.name, r.municipality)
        for r in db.query(Beach.id, Beach.name, Beach.municipality)
    }
    # Orden del mapa de la app (lib/mapData.ts:rank) — el representante
    # del grupo es el PM peor parado
    _RANK = {"closed": 0, "warning": 1, "unknown": 2, "open": 3}
    worst: dict[tuple[str, str], str] = {}
    for bid, e in effs.items():
        name, muni = meta.get(bid, ("", None))
        s = e["status"]
        s = s.value if hasattr(s, "value") else s
        # Playa desconocida en el censo → clave única, nunca se fusiona
        key = (
            (_norm_muni(muni) or "", beach_group_key(name))
            if name
            else ("", f"#{bid}")
        )
        if _RANK.get(s, 5) < _RANK.get(worst.get(key, ""), 5):
            worst[key] = s
    counts: dict[str, int] = {}
    for s in worst.values():
        counts[s] = counts.get(s, 0) + 1
    return counts


def _display_state(e: dict | None) -> str:
    """Estado de la matriz → clave visual: el cierre estructural se
    pinta granate (misma distinción que el pin/ficha de la app)."""
    if e is None:
        return "unknown"
    if e.get("structural"):
        return "structural"
    s = e["status"]
    return s.value if hasattr(s, "value") else s


# Añil de fauna marina — colors.status.fauna de la app; el cierre por
# medusas no es contaminación y no va en rojo
_FAUNA_COLOR = "#4f6ab8"


def _dot_visual(dstate: str, e: dict | None) -> tuple[str, str, str]:
    """(clave de capa, pin, color) de un punto de playa en el mapa —
    un cierre por fauna (medusas) lleva capa 'fauna' + pin-medusas +
    añil, igual que el mapa de la app."""
    if dstate == "closed" and e and e.get("cause") in _FAUNA_CAUSES:
        return "fauna", "pin-medusas", _FAUNA_COLOR
    return (
        "unmon" if dstate == "unknown" else dstate,
        _PIN.get(dstate, _PIN["unknown"]),
        _STATUS.get(dstate, _STATUS["unknown"])[1],
    )


def _fmt_check(dt) -> str:
    """'hoy 14:32' / 'ayer 14:32' / '12/05/2026 14:32' — port de
    fmtCheck de la app: cuándo el scraper consultó Náyade por última
    vez (no cuándo cambió el estado)."""
    now = datetime.now(UTC)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    hh = dt.strftime("%H:%M")
    if dt.date() == now.date():
        return f"hoy {hh}"
    if dt.date() == (now - timedelta(days=1)).date():
        return f"ayer {hh}"
    return f"{dt.strftime('%d/%m/%Y')} {hh}"


def _alert_entries(db: Session, effs: dict) -> list[tuple]:
    """(Beach, entry) de las playas con alerta viva de la matriz —
    mismo conjunto que /alerts sin recomputarla ni hacer un get+ST_X/Y
    por playa (la landing y la portada lo usan para el panel lateral)."""
    alert_ids = [bid for bid, e in effs.items() if e["alerted"]]
    if not alert_ids:
        return []
    beaches = {
        b.id: b for b in db.query(Beach).filter(Beach.id.in_(alert_ids))
    }
    return [(beaches[bid], effs[bid]) for bid in alert_ids if bid in beaches]


def _alert_when(aword: str, rep: datetime | None, now: datetime) -> str:
    """'cerrada · hace 3 días' si es reciente; 'cerrada desde feb 2026'
    cuando el cierre lleva >30 d — 'hace 212 días' en una alerta viva
    se lee como dato rancio, no como cierre en curso."""
    if rep is None:
        return f"{aword} · hoy"
    if rep.tzinfo is None:
        rep = rep.replace(tzinfo=UTC)
    days = (now - rep).days
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


def _num(raw: str | None) -> float | None:
    """'9 UFC/100 mL' / '<10' / '>24000' -> número; None si no hay."""
    if not raw:
        return None
    m = re.search(r"\d+(?:\.\d+)?", raw)
    return float(m.group(0)) if m else None


def _sample_note(measurements: list) -> dict | None:
    """Port de lib/quality.ts:samplingNote — huecos >45 d entre
    muestras consecutivas (o desde la última hasta hoy). Si el hueco
    cubre meses que sí se muestrean en la serie → anomalía; si solo
    cubre el parón anual → se declara el calendario real de Sanidad."""
    dates = sorted(m.sampled_at for m in measurements if m.sampled_at)
    if len(dates) < 2:
        return None
    today = datetime.now(UTC).date()
    months = {d.month for d in dates}
    gaps = [
        (dates[i - 1], dates[i], False)
        for i in range(1, len(dates))
        if (dates[i] - dates[i - 1]).days > 45
    ]
    if (today - dates[-1]).days > 45:
        gaps.append((dates[-1], today, True))
    if not gaps:
        return None

    def interior(a, b):
        out = []
        y, m = a.year, a.month + 1
        if m > 12:
            m, y = 1, y + 1
        while (y, m) < (b.year, b.month):
            out.append(m)
            m += 1
            if m > 12:
                m, y = 1, y + 1
        return out

    anom = [g for g in gaps if any(x in months for x in interior(g[0], g[1]))]
    if anom:
        # Etiqueta + rangos con → como en la app (el template usa
        # white-space:pre-line para respetar el salto)
        parts = [
            f"desde {_MONTHS[a.month - 1]} {a.year}"
            if op
            else f"{_MONTHS[a.month - 1]} {a.year} → "
            f"{_MONTHS[b.month - 1]} {b.year}"
            for a, b, op in anom
        ]
        return {
            "text": f"Anomalía: sin muestras\n{' · '.join(parts)}",
            "warn": True,
        }
    a, b, _ = max(gaps, key=lambda g: (g[1] - g[0]).days)
    return {
        "text": f"Sanidad deja de muestrearla cada año entre "
        f"{_MONTHS_FULL[a.month - 1]} y {_MONTHS_FULL[b.month - 1]}",
        "warn": False,
    }


def _bar_h(v: float) -> int:
    return max(
        3, round(_CHART_H * math.log10(max(v, 1)) / math.log10(_LOG_CAP))
    )


_PM_TAG = re.compile(r"\s+PM(\d+)\s*$", re.I)


def _zone_suffix(db: Session, beach: Beach) -> str:
    """' · Punta Brava' (cala curada) o ' · Zona 3' — solo para PMs de
    complejos multipunto, igual que la cabecera de la ficha de la app.
    Un PM sin hermanos no enseña sufijo."""
    m = _PM_TAG.search(beach.name)
    if not m:
        return ""
    ze = _zone_entry(beach)
    if ze and ze.get("name"):
        return f" · {ze['name']}"
    base = PM_SUFFIX.sub("", beach.name).strip()
    n = (
        db.query(func.count(Beach.id))
        .filter(Beach.name.like(f"{base}%"))
        .scalar()
        or 0
    )
    return f" · Zona {m.group(1)}" if n > 1 else ""


def _qcolor(param: str, v: float) -> str:
    t = _QUALITY[param]
    if v <= float(t["excellent"]):
        return "#0d9488"
    return "#f9a825" if v <= float(t["good"]) else "#c62828"


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
}
_ARTICLE_PAREN = re.compile(r"\s*\((EL|LA|LOS|LAS)\)", re.I)
_DE_FORMS = {"el": "del", "la": "de la", "los": "de los", "las": "de las"}
_WORD = re.compile(r"[a-záéíóúñü]+", re.I)


def _cap_name(name: str) -> str:
    """Capitaliza estilo español: conectores en minúscula, artículos
    solo en minúscula tras 'de'; restaura acentos conocidos."""
    prev = ""
    out = []
    for p in re.split(f"({_WORD.pattern})", name.lower()):
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
    name = PM_SUFFIX.sub("", name)
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


# Arte del circulito de causa — espejo de lib/causeArt.ts del
# frontend: estructural → rockfall; el resto por etiqueta canónica
_FAUNA_CAUSES = {"Medusas"}
_BACTERIAL_CAUSES = {"E. coli", "Enterococos", "Contaminación fecal"}
_CAUSE_ART = {
    "Algas": "algas-art",
    "Medusas": "medusas-art",
    "Hidrocarburos": "gasoil-art",
    "E. coli": "bacteria-art",
    "Enterococos": "bacteria-art",
    "Contaminación fecal": "bacteria-art",
}


def _alert_cards(
    entries: list[tuple], now: datetime, db: Session
) -> list[dict]:
    """Filas de alerta viva enlazables a su /b/{id} — la misma regla
    que /alerts, compartida por el panel lateral de /b/ y la portada.
    `entries` = salida de _alert_entries (Beach, fila de la matriz)."""
    # Una sola query de coords para todas las filas — la miniatura
    # satelite del lateral de la ficha (misma URL que las cards de
    # la home) no puede salir sin lon/lat
    ids = [b.id for b, _ in entries]
    coords = {}
    if ids:
        coords = {
            bid: (lon, lat)
            for bid, lon, lat in db.query(
                Beach.id,
                func.ST_X(Beach.geom).label("lon"),
                func.ST_Y(Beach.geom).label("lat"),
            ).filter(Beach.id.in_(ids))
            if lon is not None
        }
    cards = []
    for beach, e in entries:
        dstate = _display_state(e)
        structural = dstate == "structural"
        fauna = e["cause"] in _FAUNA_CAUSES
        art = (
            "rockfall-art"
            if structural
            else _CAUSE_ART.get(e["cause"], "contam-art")
        )
        # Sección de banner — mismo orden que la app: contaminación,
        # fauna marina, estructural, avisos
        sec = (
            "warn"
            if e["status"] == "warning"
            else "struct"
            if structural
            else "fauna"
            if fauna
            else "contam"
        )
        cards.append(
            {
                # "s" estructural · "f" fauna · "c" contaminación ·
                # "w" aviso: cada clase pinta su borde/hover (banner)
                "cls": (
                    "s"
                    if structural
                    else "f"
                    if fauna and e["status"] == "closed"
                    else "c"
                    if e["status"] == "closed"
                    else "w"
                ),
                "sec": sec,
                "beach_id": beach.id,
                "color": (
                    "#4f6ab8"
                    if fauna and e["status"] == "closed"
                    else _STATUS.get(dstate, _STATUS["unknown"])[1]
                ),
                "name": _display_name(beach.name) + _zone_suffix(db, beach),
                "thumb": (
                    _shot_url(*coords[beach.id], 0.0008, 0.00055)
                    if beach.id in coords
                    else None
                ),
                # Arte de causa como en el banner de la app
                "art": art,
                "cause": e["cause"],
                # Patrón del banner de la app (home): estado a la
                # derecha + causa debajo; meta queda para /b/ y /o/
                "estado": "Cerrada" if e["status"] == "closed" else "Aviso",
                # El badge de causa solo acompaña a "Cerrada" (como la app)
                "show_badge": e["status"] == "closed",
                "sub": (
                    f"{_alert_when('', e['reported_at'], now).lstrip(' ·')}"
                    f" · {'según prensa' if e['via'] == 'press' else 'oficial'}"
                    f" · {beach.municipality or ''}"
                ),
                "meta": (
                    f"{
                        _alert_when(
                            'cerrada' if e['status'] == 'closed' else 'aviso',
                            e['reported_at'],
                            now,
                        )
                    } · {'según prensa' if e['via'] == 'press' else 'oficial'}"
                    f" · {beach.municipality or ''}"
                ),
                # Meta en unidades atómicas: cada span va con nowrap
                # y el corte solo puede caer entre ellas — "según
                # prensa" nunca queda colgado a media frase ni se
                # sale de la celda en anchos estrechos
                "sub_when": _alert_when("", e["reported_at"], now).lstrip(
                    " ·"
                ),
                "meta_when": _alert_when(
                    "cerrada" if e["status"] == "closed" else "aviso",
                    e["reported_at"],
                    now,
                ),
                "via": "según prensa" if e["via"] == "press" else "oficial",
                "muni": beach.municipality or "",
            }
        )
    return cards


_FONTS = [
    (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ),
    # Windows (desarrollo local)
    ("C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/arial.ttf"),
]
_OG_W, _OG_H = 1200, 630


def _og_card(
    name: str,
    sub: str,
    lon: float,
    lat: float,
    pin_file: str,
    label: str,
    color: str,
) -> bytes:
    """Compone la og:image 1200×630: foto satélite Esri + pin +
    banda inferior con nombre y chip — sirve a playas y emisarios."""
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

    # Pin centrado (mismo PNG que el mapa de la app) — thumbnail
    # conserva la proporción: el estructural no es cuadrado
    pin = Image.open(_ICONS / f"{pin_file}.png").convert("RGBA")
    pin.thumbnail((104, 104))
    img.alpha_composite(
        pin, (_OG_W // 2 - pin.width // 2, 240 + 104 - pin.height)
    )

    # Banda inferior con degradado a oscuro
    band = Image.new("RGBA", (_OG_W, 190), (8, 32, 46, 0))
    bd = ImageDraw.Draw(band)
    for y in range(190):
        bd.line([(0, y), (_OG_W, y)], fill=(8, 32, 46, int(235 * (y / 190))))
    img.alpha_composite(band, (0, _OG_H - 190))

    d = ImageDraw.Draw(img)
    # Defaults primero: si ningún TTF carga queda la fuente de PIL
    f_name = f_sub = f_chip = ImageFont.load_default()
    for bold, reg in _FONTS:
        try:
            f_name = ImageFont.truetype(bold, 52)
            f_sub = ImageFont.truetype(reg, 30)
            f_chip = ImageFont.truetype(bold, 30)
            break
        except OSError:
            continue

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


def _og_png(
    beach, lon: float, lat: float, state: str, label: str, color: str
) -> bytes:
    """og:image de playa: envoltura de _og_card con los datos de la
    ficha de playa."""
    return _og_card(
        _display_name(beach.name),
        f"{beach.municipality or 'Tenerife'} · CheckCoast Tenerife",
        lon,
        lat,
        _PIN.get(state, _PIN["unknown"]),
        label,
        color,
    )


def beach_row(db: Session, beach_id: int):
    """(Beach, último estado crudo, lon, lat) o None — compartida por
    /b/{id} y /b/{id}/og.jpg."""
    return (
        beaches_with_latest_status(db)
        .add_columns(
            func.ST_X(Beach.geom).label("lon"),
            func.ST_Y(Beach.geom).label("lat"),
        )
        .filter(Beach.id == beach_id)
        .one_or_none()
    )


_PRESS_GROUP_ORDER = ["closure", "warning", "pollution", "reopening", "other"]

# Causas de la familia estructural — tiñen la fila del historial en
# granate (como el pin/chip de cierre estructural), no en el rojo de
# contaminación
_STRUCT_CAUSES = {"Desprendimientos", "Colapso del terreno", "Obras"}

# Causa del episodio → arte del badge (mismo mapa que causeArt.ts);
# lo no categorizado cae en "contam" — Náyade solo vigila
# E. coli/enterococos
_CAUSE_ART = {
    "Algas": "algas-art",
    "Medusas": "medusas-art",
    "Hidrocarburos": "gasoil-art",
    "Desprendimientos": "rockfall-art",
    "Colapso del terreno": "rockfall-art",
    "Obras": "rockfall-art",
    "E. coli": "bacteria-art",
    "Enterococos": "bacteria-art",
    "Contaminación fecal": "bacteria-art",
}
_PRESS_GROUP_LABEL = {
    "closure": "Cierre",
    "warning": "Aviso",
    "pollution": "Contaminación",
    "reopening": "Reapertura",
    "other": "Noticia",
}

# Color de fase: la reapertura va en el verde mar de "apta" (status.open
# de la app, pins de la home), nunca en el acento del episodio —
# verde = "se acabó", sea cual sea la causa del cierre
_PRESS_REOPEN_COLOR = "#0d9488"


def _sibling_zone_ref(beach: Beach, tag: str) -> str:
    """'cala Punta Brava' si la zona hermana está mapeada ('playa
    Chica' si la entrada trae `ref`); 'zona 4' si no
    (siblingZoneRef de lib/zones.ts)."""
    zones = _ZONE_GROUPS.get(
        (
            arenal_base(beach.name),
            _norm_muni(beach.municipality) or "",
        )
    )
    zone = (zones or {}).get(tag)
    if zone:
        return zone.get("ref") or f"cala {zone['name']}"
    return f"zona {tag.removeprefix('PM')}"


def _incident_ctxs(beach: Beach, db: Session) -> dict | None:
    """Historial de incidencias igual que IncidentHistory de la app:
    reutiliza el merge oficial+prensa+analítica que sirve
    /beaches/{id}/incidents, agrupado por año y con los episodios
    atribuidos a un PM hermano apartados al final de cada año."""
    # Import local: routers.beaches carga FastAPI y medio backend;
    # hacerlo en el toplevel crearía un ciclo routers -> share_context
    from app.routers.beaches import beach_incidents

    rows = beach_incidents(beach.id, db)
    if not rows:
        return None
    today = date.today()

    def _is_closure(i) -> bool:
        return (
            i.via == "press"
            # Analítica corroborada por prensa de cierre: escala a
            # cierre; la muda es "agua no apta", nunca cierre
            or (i.via == "measurement" and i.press_confirmed)
            or re.search("proh[ií]b", i.observations or "", re.I) is not None
            or any(
                p.event_type in ("closure", "reopening") for p in i.press_items
            )
        )

    def _is_uncl(i) -> bool:
        # Nota "Sin calificar" sin evidencia de prensa = nota admin.
        # Con prensa corroborante es el registro oficial del episodio
        # real — se muestra como cierre/aviso con su causa
        return re.search(
            r"sin\s*calificar", i.observations or "", re.I
        ) is not None and not any(
            p.event_type in ("closure", "reopening", "warning", "pollution")
            for p in i.press_items
        )

    def _is_mute(i) -> bool:
        """Analítica prohibida sin prensa de cierre en la ventana —
        agua no apta sin cierre demostrado; nunca cuenta como tal."""
        return i.via == "measurement" and not i.press_confirmed

    def _press_groups(items, accent: str) -> list[dict]:
        by_type: dict[str, list] = {}
        for n in items:
            by_type.setdefault(n.event_type or "other", []).append(n)
        out = []
        for t in sorted(
            by_type,
            key=lambda t: (
                _PRESS_GROUP_ORDER.index(t) if t in _PRESS_GROUP_ORDER else 99
            ),
        ):
            gi = by_type[t]
            phrase = (
                "mejora la calidad del agua"
                if t == "reopening"
                else _news_cause(gi)
            )
            label = _PRESS_GROUP_LABEL.get(t, "Noticia")
            out.append(
                {
                    "color": (
                        _PRESS_REOPEN_COLOR if t == "reopening" else accent
                    ),
                    "label": (
                        f"{label} · {phrase}".upper()
                        if phrase
                        else label.upper()
                    ),
                    "headlines": [
                        {
                            "title": n.title,
                            "url": n.url,
                            "source": n.source or "",
                            "date": (
                                n.published_at.strftime("%d/%m/%Y")
                                if n.published_at
                                else ""
                            ),
                        }
                        for n in gi
                    ],
                }
            )
        return out

    def _row(i) -> dict:
        closure, uncl = _is_closure(i), _is_uncl(i)
        # Causas del episodio agregadas de sus titulares (Valleseco:
        # hidrocarburos + algas). La etiqueta "Cerrada"/"Aviso" se
        # tiñe por la causa dominante, como las filas de alertas de
        # la portada; Náyade sin prensa cae en "Contaminación" —
        # solo vigila E. coli/enterococos
        causes: list[str] = []
        for p in i.press_items:
            cat = _short_cause(p.cause)
            if cat and cat not in causes:
                causes.append(cat)
        # Jerarquía (_CAUSE_RANK): si el episodio nombra el parámetro
        # (E. coli/enterococos) las categorías genéricas no aportan —
        # "Contaminación fecal · Enterococos · Contaminación · E. coli"
        # (Punta Brava) decía lo mismo 4 veces. "Contaminación" a secas
        # solo sobrevive cuando no hay nada más específico
        if set(causes) & {"E. coli", "Enterococos"}:
            causes = [c for c in causes if c != "Contaminación fecal"]
        if len(causes) > 1:
            causes = [c for c in causes if c != "Contaminación"]
        causes.sort(key=lambda c: _CAUSE_RANK.get(c, 9))
        causes = causes[:3]
        mute = _is_mute(i)
        state_label = (
            "Sin calificar"
            if uncl
            else "Agua no apta"
            if mute
            else "Cerrada"
            if closure
            else "Aviso"
        )
        state_color = (
            "#8a9aa3"
            if uncl
            # Ámbar como los avisos: dato de laboratorio sin
            # corroboración, no un cierre confirmado
            else "#f9a825"
            if mute
            else "#8c322a"
            if set(causes) & _STRUCT_CAUSES
            else "#4f6ab8"
            if "Medusas" in causes
            else "#c62828"
            if closure
            else "#e65100"
        )
        cause_text = (
            "Agua no apta"
            if mute
            # "Sin calificar" no es cierre — pero si la prensa
            # adjunta sabe el motivo, se muestra igualmente
            else " · ".join(causes) or None
            if uncl
            else " · ".join(causes) or "Contaminación"
        )
        # En un cierre el badge sustituye al "Cerrada" (la fila ya lo
        # dice el propio contexto); avisos y sin calificar conservan
        # su etiqueta porque no se sobreentiende
        badges: list[str] = []
        if mute:
            badges = ["lab-art"]  # tubo + aviso: el lab detectó, no hay acta
        elif closure and not uncl:
            for c in causes:
                art = _CAUSE_ART.get(c, "contam-art")
                if art not in badges:
                    badges.append(art)
            # Familia bacteriana: la cadena causal se cuenta emisario
            # (fuente: hubo vertido) → bacteria (evidencia: el lab la
            # midió) — doble badge como en la app
            if set(causes) & _BACTERIAL_CAUSES and "contam-art" not in badges:
                badges.insert(0, "contam-art")
            if not badges:
                badges = ["contam-art"]
        ndays = max(((i.closed_at or today) - i.opened_at).days, 0) + 1
        rng = (
            f"{i.opened_at.strftime('%d/%m/%Y')} → desconocido"
            if i.end_estimated
            else (
                f"{i.opened_at.strftime('%d/%m/%Y')} → "
                f"{i.closed_at.strftime('%d/%m/%Y') if i.closed_at else 'hoy'}"
                f" · {ndays} día{'s' if ndays != 1 else ''}"
            )
        )
        notes = []
        if i.attributed_pm:
            notes.append(
                f"Ocurrió en la {_sibling_zone_ref(beach, i.attributed_pm)}"
            )
        if i.observations:
            if not re.search(r"sin\s*calificar", i.observations, re.I):
                # Una cláusula por línea: la fila respira y ninguna
                # invade la zona del badge (la observación ya viene
                # redactada como fragmentos unidos por "·")
                notes += [
                    c.strip() for c in i.observations.split("·") if c.strip()
                ]
        # En un cierre la evidencia útil es el ciclo cierre→reapertura:
        # avisos y piezas de contexto ("mala calidad del agua") no
        # cuentan el episodio y ensucian la lista de titulares
        disp = (
            [
                p
                for p in i.press_items
                if p.event_type in ("closure", "reopening")
            ]
            if closure
            else i.press_items
        )
        return {
            "id": i.id,
            "range": rng,
            "state_label": state_label,
            "state_color": state_color,
            "mute": mute,
            "cause_text": cause_text,
            "badges": badges,
            "accent": state_color,
            "notes": notes,
            "n_press": len(disp),
            "groups": _press_groups(disp, state_color),
            "opened": i.opened_at,
            "closed": i.closed_at,
        }

    own = [i for i in rows if not i.attributed_pm]
    # Episodios de laboratorio aparte: solo los MUDOS — agua no
    # apta sin cierre corroborado. Los que la prensa documentó
    # como cierre sí cuentan en cierres
    lab_n = sum(1 for i in own if _is_mute(i))
    total_c = sum(1 for i in own if _is_closure(i))
    total_w = sum(
        1
        for i in own
        if not _is_closure(i) and not _is_uncl(i) and not _is_mute(i)
    )
    uncl = sum(1 for i in rows if _is_uncl(i))

    def _count_since(cutoff: date) -> tuple[int, int, int]:
        sel = [
            i
            for i in rows
            if not i.attributed_pm
            and not _is_uncl(i)
            and i.opened_at >= cutoff
        ]
        return (
            sum(1 for i in sel if _is_closure(i)),
            sum(1 for i in sel if not _is_closure(i) and not _is_mute(i)),
            sum(1 for i in sel if _is_mute(i)),
        )

    y1 = _count_since(date(today.year, 1, 1))
    y5 = _count_since(today - timedelta(days=int(5 * 365.25)))

    def _parts(c: int, w: int, lab: int) -> str:
        return " · ".join(
            s
            for s in (
                f"{c} cierre{'s' if c != 1 else ''}" if c else None,
                f"{w} aviso{'s' if w != 1 else ''}" if w else None,
                (
                    f"{lab} muestra{'s' if lab != 1 else ''} "
                    f"no apta{'s' if lab != 1 else ''}"
                    if lab
                    else None
                ),
            )
            if s
        )

    y1p, y5p = _parts(*y1), _parts(*y5)
    if total_c == y5[0] and total_w == y5[1] and lab_n == y5[2] and y5p:
        # "6 cierres (4 este año) · 2 muestras no aptas" — el
        # paréntesis va pegado a los cierres, no colgando al final
        uncl_bit = f" · {uncl} sin calificar" if uncl else ""
        if y1p == y5p:
            main = f"{y5p}{uncl_bit} este año"
        elif y5[0]:
            rest = _parts(0, y5[1], y5[2])
            c1 = str(y1[0]) if y1[0] else "ninguno"
            main = f"{y5[0]} cierre{'s' if y5[0] != 1 else ''} ({c1} este año)"
            if rest:
                main += f" · {rest}"
            main += uncl_bit
        else:
            main = f"{y5p}{uncl_bit} ({y1p or 'sin episodios'} este año)"
        summary_main, summary_sub = main, None
    else:
        main = _parts(total_c, total_w, lab_n)
        if uncl:
            main = (main + " · " if main else "") + f"{uncl} sin calificar"
        summary_main = main or "Sin episodios"
        summary_sub = (
            f"Este año: {y1p or 'sin episodios'} · "
            f"Últimos 5 años: {y5p or 'sin episodios'}"
        )

    years: dict[int, dict] = {}
    for i in rows:
        g = years.setdefault(
            i.opened_at.year,
            {"year": i.opened_at.year, "rows": [], "sib_rows": []},
        )
        if i.attributed_pm:
            g["sib_rows"].append(_row(i))
            g["sib_label"] = _sibling_zone_ref(beach, i.attributed_pm)
        else:
            g["rows"].append(_row(i))

    # Acordeón por año: actual y anterior abiertos; el resto llegan
    # colapsados con su conteo — pero con pocos episodios (≤10) todo
    # abierto, el acordeón solo paga cuando hay volumen
    many = len(rows) > 10
    for g in years.values():
        g["count"] = len(g["rows"]) + len(g["sib_rows"])
        g["collapsed"] = many and g["year"] < datetime.now().year - 1

    return {
        "count": len(rows),
        "summary_main": summary_main,
        "summary_sub": summary_sub,
        "years": list(years.values()),
    }


def beach_context(
    db: Session, beach: Beach, lon: float, lat: float, demo: bool = False
) -> dict:
    """Contexto completo de /b/{id}: queries auxiliares (prensa,
    mediciones, incidencias, emisarios cercanos) + todo el montaje de
    presentación (degradado de cabecera, gráfica, banner de prensa,
    panel de alertas) — listo para `_page("beach.html", **ctx)`."""
    # Estado efectivo = matriz compartida con /alerts (oficial +
    # prensa, supresión de rezagados, persistencia estructural). La
    # réplica local se quedaba a medias y la landing podía enseñar lo
    # contrario que la app (Benijo "sin datos" vs cerrada)
    effs = effective_states(db)
    eff = effs.get(beach.id)
    if demo:
        # ?demo=1: la ficha replica la alerta fabricada de la home —
        # sin el override, "El Duque cerrada" abriría "Apta" (dato real)
        all_beaches = (
            beaches_with_latest_status(db)
            .add_columns(
                func.ST_X(Beach.geom).label("lon"),
                func.ST_Y(Beach.geom).label("lat"),
            )
            .all()
        )
        fake = {
            b.id: e for b, e in _demo_alerts(all_beaches, datetime.now(UTC))
        }
        eff = fake.get(beach.id, eff)
    state = _display_state(eff)
    press_label = (
        "según prensa" if eff is not None and eff["via"] == "press" else None
    )

    news_items = (
        db.query(NewsItem)
        .filter(NewsItem.beach_id == beach.id, NewsItem.relevant.is_(True))
        .order_by(NewsItem.published_at.desc().nulls_last())
        .limit(30)
        .all()
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
            Outfall.id,
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

    name = _display_name(beach.name) + _zone_suffix(db, beach)
    muni = beach.municipality or "Tenerife"
    # Cabecera teñida por estado efectivo, como la ficha de la app —
    # el cierre estructural va en granate, no en el rojo del vertido
    head_bg = {
        "closed": "linear-gradient(180deg,#7a1f1f,#c62828)",
        "structural": "linear-gradient(180deg,#5e2320,#8c322a)",
        "warning": "linear-gradient(180deg,#8a3c00,#e65100)",
    }.get(state, "linear-gradient(180deg,#0f766e,#0d9488)")
    # La ola que separa cabecera y foto sigue el color final del
    # degradado del header
    wave_c = {
        "closed": "#c62828",
        "structural": "#8c322a",
        "warning": "#e65100",
    }.get(state, "#0d9488")
    title = f"{name} · {muni}"
    # Zonas hermanas del complejo multipunto (misma clave base +
    # municipio que groupKeyOf de la app): dots coloreados por
    # estado efectivo sobre la foto, como los pm-dots de la ficha
    # nativa. El pin central sigue marcando la zona de esta ficha
    zone_sibs = []
    if _PM_TAG.search(beach.name):
        base = PM_SUFFIX.sub("", beach.name).strip()
        sib_rows = (
            db.query(
                Beach,
                func.ST_X(Beach.geom).label("slon"),
                func.ST_Y(Beach.geom).label("slat"),
            )
            .filter(
                Beach.municipality == beach.municipality,
                Beach.name.like(f"{base}%"),
                Beach.id != beach.id,
            )
            .all()
        )
        zone_sibs = [
            {
                "lon": slon,
                "lat": slat,
                "color": _STATUS.get(
                    _display_state(effs.get(sb.id)), _STATUS["unknown"]
                )[1],
                "tag": _zone_suffix(db, sb).lstrip(" ·"),
                "title": _display_name(sb.name),
            }
            for sb, slon, slat in sib_rows
            if slon is not None
        ]

    # El nivel más lejano crece hasta que todas las zonas hermanas
    # quepan en el encuadre — la ficha abre en ese nivel y un
    # complejo ancho no debe cortar a sus hermanas
    shot_levels = list(_SHOT_LEVELS)
    if zone_sibs:
        far_dlon = max(
            _SHOT_LEVELS[-1][0],
            max(abs(z["lon"] - lon) for z in zone_sibs) * 2.3 + 0.004,
        )
        far_dlat = max(
            _SHOT_LEVELS[-1][1],
            max(abs(z["lat"] - lat) for z in zone_sibs) * 2.3 + 0.002,
        )
        shot_levels[-1] = (far_dlon, far_dlat)

    urls = [_shot_url(lon, lat, *d) for d in shot_levels]
    deep = f"checkcoast://beach/{beach.id}"

    # Un nivel de dots por encuadre de zoom; se empieza en el más lejano
    start = len(shot_levels) - 2
    dots_levels = [_dots(outfalls, lon, lat, *d) for d in shot_levels]
    zone_levels = [
        [
            {**z, "x": f"{x:.1f}", "y": f"{y:.1f}"}
            for z in zone_sibs
            for x, y in [_px(z["lon"], z["lat"], lon, lat, dlon, dlat)]
            if 0 <= x <= 100 and 0 <= y <= 100
        ]
        for dlon, dlat in shot_levels
    ]

    # Tarjeta "Calidad del agua" como la app: valor + % del límite
    # normativo por parámetro + nota del calendario de muestreo
    quality = None
    if latest:
        params = []
        for param in ("ecoli", "enterococci"):
            raw = getattr(latest, param)
            v = _num(raw)
            if v is None:
                continue
            t = _QUALITY[param]
            params.append(
                {
                    "label": t["label"],
                    "value": (raw or "").strip(),
                    "cls": (
                        "Excelente"
                        if v <= float(t["excellent"])
                        else "Buena"
                        if v <= float(t["good"])
                        else "Insuficiente"
                    ),
                    "color": _qcolor(param, v),
                    "pct": round(v / float(t["good"]) * 100),
                    "pctw": min(round(v / float(t["good"]) * 100), 100),
                }
            )
        if params:
            quality = {
                "date": latest.sampled_at.strftime("%d/%m/%Y"),
                "params": params,
                "note": _sample_note(measurements),
            }

    # Distancia como cifra destacada (como en la ficha de la app);
    # <500 m va en naranja de aviso — es el dato que impacta
    outfall_ctxs = [
        {
            "oid": o.id,
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

    # Oficiales + episodios reconstruidos (prensa/analítica) — mismo
    # merge que /beaches/{id}/incidents; la versión anterior solo
    # leía beach_incidents y Punta Larga salía sin historial
    incident_ctxs = _incident_ctxs(beach, db)

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
        # Franjas de fondo por período de incidente [apertura→cierre],
        # interpoladas sobre el rango de fechas de las muestras. Misma
        # matriz que el historial (oficial + prensa + reconstruidos):
        # color = tipo (rojo cierre, amarillo aviso). El velo explica
        # de un vistazo tanto la duración como los huecos sin
        # muestreo. "Sin calificar" no marca
        all_dates = [d for pts in series.values() for d, _ in pts]
        d0, d1 = min(all_dates), max(all_dates)
        span = max((d1 - d0).days, 1)
        inc_rows = [
            i
            for y in (incident_ctxs or {}).get("years", [])
            for i in y["rows"]
        ]

        def _pos(d: date) -> float:
            return max(0.0, min(100.0, ((d - d0).days / span) * 100))

        inc_marks = [
            {
                "pos": f"{pf:.1f}",
                "w": f"{max(pt - pf, 1.0):.1f}",
                "color": (
                    "#c62828" if i["state_label"] == "Cerrada" else "#f9a825"
                ),
                # Fechas exactas + duración vía tooltip: en el eje
                # saturarían (días inclusive, como la app)
                "title": (
                    f"{i['opened'].strftime('%d/%m/%Y')} → "
                    + (
                        i["closed"].strftime("%d/%m/%Y")
                        if i["closed"]
                        else "hoy"
                    )
                    + f" · {((i['closed'] or date.today()) - i['opened']).days + 1} días"
                    + f" · {i['state_label'].lower()}"
                ),
            }
            for i in inc_rows
            for pf, pt in [
                (_pos(i["opened"]), _pos(i["closed"] or date.today()))
            ]
            if i["state_label"] != "Sin calificar" and pt > 0 and pf < 100
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
                    "lim_y": _bar_h(float(_QUALITY[param]["good"])),
                    "bars": bars,
                    "ycells": ycells,
                    "n": len(pts),
                    "good": _QUALITY[param]["good"],
                }
            )
        chart = {"inc_marks": inc_marks, "panels": panels}

    # Banner "según prensa" como en la app: evento dominante + causa +
    # desde + nº medios; debajo hasta 3 titulares enlazables — venden el
    # "porqué" mejor que uno solo
    press_cls = (
        "press n-structural"
        if state == "structural"
        else "press n-closed"
        if state == "closed"
        else "press n-warning"
        if state == "warning"
        else "press"
    )
    # Misma regla que la app: el banner solo narra episodios vivos
    # (estado efectivo cerrado/aviso) o cobertura reciente ≤90 d —
    # un titular viejo de episodio resuelto ya vive en Episodios
    latest_news = max(
        (it.published_at for it in news_items if it.published_at),
        default=None,
    )
    press_fresh = latest_news is not None and (
        (date.today() - latest_news.date()).days <= 90
    )
    press_live = state in ("closed", "structural", "warning")
    press = None
    if news_items and (press_live or press_fresh):
        counts_ev: dict[str, int] = {}
        for it in news_items:
            if it.event_type and it.event_type != "other":
                counts_ev[it.event_type] = counts_ev.get(it.event_type, 0) + 1
        dom = (
            "closure"
            if counts_ev.get("closure")
            else (
                max(counts_ev, key=counts_ev.__getitem__)
                if counts_ev
                else None
            )
        )
        # Causa = la más frecuente entre los titulares del evento
        # dominante (moda, como el resumen de la app)
        dom_items = [it for it in news_items if it.event_type == dom]
        ccount: dict[str, int] = {}
        for it in dom_items:
            if it.cause:
                ccount[it.cause] = ccount.get(it.cause, 0) + 1
        cause = max(ccount, key=ccount.__getitem__) if ccount else None
        banner_items: list[NewsItem] = dom_items
        if dom == "closure":
            # El "desde" es el inicio del episodio VIVO, no la
            # cobertura más vieja del saco: misma cadena de episodios
            # que la app (closed_since corroborado > ancla de
            # cobertura) — Gaviotas: el titular más antiguo era del
            # cierre de acceso de 2024 y el banner mentía "desde el
            # 03/05/2024"
            summ = press_episode_summary(
                list(news_items),
                synthesize_events(beach),
                list(incidents),
                date.today(),
            )
            since = _closed_since_date(summ.closed_since) or (
                summ.since.date() if summ.since else None
            )
            cause = clean_cause_text(summ.cause or cause)
            if summ.episode_items:
                banner_items = summ.episode_items
        else:
            since = min(
                (
                    it.published_at.date()
                    for it in dom_items
                    if it.published_at
                ),
                default=None,
            )
        # Los medios se cuentan sobre los ítems que el banner narra
        # (episode_items del episodio vigente), no sobre toda la
        # historia de prensa de la playa — la app usa outlets_count
        # del resumen con el mismo alcance (Jardín: 9 medios del 4º
        # cierre, no 11 de toda la historia)
        outlets = len({it.source for it in banner_items if it.source})
        ev_word = {
            "closure": "Cerrada",
            "warning": "Aviso en",
            "pollution": "Contaminación en",
            "reopening": "Reabierta",
        }.get(dom or "", "Mencionada")
        if dom == "closure" and state not in ("closed", "structural"):
            ev_word = "Estuvo cerrada" if state == "open" else "Cerrada"
        # reapertura oficial probada: incidencia cerrada tras el
        # titular. Se resuelve ANTES de componer la línea porque el
        # acta puede documentar un inicio anterior al ancla de prensa
        # — y se busca en los EPISODIOS FUSIONADOS (misma vista que
        # /beaches/{id}/incidents y la app): con dos actas del mismo
        # episodio el inicio es la primera, no el tramo casado (Punta
        # Brava: actas 28/09→30/09 + 05/10→07/10 = episodio
        # 28/09→07/10; con la acta suelta el banner decía "desde el
        # 05/10" mientras la lista de episodios mostraba 28/09)
        fused = fuse_official_episodes(list(incidents), list(news_items))
        reopening_grp = next(
            (
                g
                for g in fused
                if g[-1].closed_at and since and g[-1].closed_at >= since
            ),
            None,
        )
        # Día-frontera: el acta que cierra JUSTO el día del ancla de
        # prensa pertenece al episodio ANTERIOR cuando esa oleada
        # documenta un cierre NUEVO corroborado — Sanidad reabrió por
        # la mañana y el mismo día volvieron a prohibir el baño
        # (Jardín: acta 28/09→07/10 y la prensa cuenta el 4º cierre
        # 07→09/10 con 6 medios). Sin el corte, el banner narra el
        # episodio viejo aunque el actual esté listado debajo. Sin
        # corroboración el acta sigue siendo la del ancla: una pieza
        # suelta en día de reapertura es cobertura del mismo episodio
        if (
            reopening_grp
            and since
            and reopening_grp[-1].closed_at == since
            and anchor_is_new_closure_wave(list(news_items), since)
        ):
            reopening_grp = next(
                (
                    g
                    for g in fused
                    if g[-1].closed_at and g[-1].closed_at > since
                ),
                None,
            )
        press_reopen = None
        if reopening_grp is None and dom == "closure":
            # El episodio del ancla solo existe en prensa: su cierre
            # también lo documentan los medios — sin él el banner
            # perdería el "reabrió el X" de un episodio ya resuelto.
            # Corre con cualquier episodio sin acta, no solo tras un
            # día-frontera: Jardín 07→09/10 nunca tuvo incidencia
            # oficial, el corte anterior dejaba el banner mudo
            press_ep = next(
                (
                    ev
                    for ev in synthesize_events(beach)
                    if ev.via == "press"
                    and ev.opened_at == since
                    and ev.closed_at is not None
                ),
                None,
            )
            press_reopen = press_ep.closed_at if press_ep else None
        closed_after = (
            reopening_grp[-1].closed_at if reopening_grp else press_reopen
        )
        if (
            reopening_grp
            and reopening_grp[0].opened_at
            and (since is None or reopening_grp[0].opened_at < since)
        ):
            since = reopening_grp[0].opened_at
        line = ev_word + (f" por {cause}" if cause else "")
        if since:
            line += f" · desde el {since.strftime('%d/%m/%Y')}"
        if closed_after:
            # La atribución importa: "Sanidad la reabrió" solo cuando
            # el fin lo documenta un acta; en episodios solo-prensa la
            # reapertura la contaron los medios (la etiqueta del banner
            # ya dice "según prensa")
            line += (
                f" · Sanidad la reabrió el {closed_after.strftime('%d/%m/%Y')}"
                if reopening_grp
                else f" · reabrió el {closed_after.strftime('%d/%m/%Y')}"
            )
        # Espejo de la app: un CIERRE ya resuelto no se narra arriba
        # cuando la reapertura tiene >7 d — el episodio vive en
        # Episodios y enseñarlo en caja repetía la tarjeta y leía
        # como alerta viva. Solo narran cierres vivos, avisos/vertidos
        # recientes y reaperturas frescas
        resolved_stale = (
            dom == "closure"
            and state not in ("closed", "structural")
            and not (closed_after and (date.today() - closed_after).days <= 7)
        )
        press = (
            None
            if resolved_stale
            else {
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
                    # Todos los titulares del episodio — el <details> va
                    # plegado, así que no ocupa sitio; la app enseña
                    # episode_items completo
                    for n in banner_items
                ],
            }
        )

    # Con cierre/aviso activo el motivo es lo primero que importa:
    # si el estado lo decide la prensa, su banner sube arriba del todo;
    # si es oficial, se resume el incidente abierto
    notice = None
    if state in ("closed", "structural", "warning"):
        if press and press_label:
            notice, press = press, None
        else:
            active_inc = next(
                (i for i in incidents if i.closed_at is None), None
            )
            if active_inc:
                verb = (
                    "Cerrada"
                    if state in ("closed", "structural")
                    else "Aviso activo"
                )
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

    # Badge de causa dentro del chip de estado — mismo mapping que el
    # banner/ficha de la app (_CAUSE_ART arriba): solo en cierre vivo
    chip_art = None
    if state == "structural":
        chip_art = "rockfall-art"
    elif state == "closed":
        chip_art = _CAUSE_ART.get((eff or {}).get("cause") or "", "contam-art")

    # og:description lleva el motivo cuando hay cierre/aviso —
    # es lo que la gente quiere saber al ver la tarjeta
    desc = f"Estado: {label} — CheckCoast Tenerife"
    if notice:
        desc = f"{notice['line']} — CheckCoast Tenerife"

    # Pie de fuentes — mismo texto que la ficha de la app + el crédito
    # de la foto aérea (obligatorio por la licencia de Esri)
    foot = (
        "Playa sin controles sanitarios oficiales. "
        "Fuente: OpenStreetMap (© colaboradores OSM)"
        if not beach.monitored
        else "Fuentes: Censo Zonas de Baño 2025 (MITECO) · "
        "Incidencias: Náyade (Min. Sanidad)"
    )
    if beach.monitored:
        last_check = (
            db.query(func.max(BeachStatus.reported_at))
            .filter(BeachStatus.beach_id == beach.id)
            .scalar()
        )
        if last_check:
            foot += f" · Consultado {_fmt_check(last_check)}"
    foot += " · Foto: © Esri, Maxar, Earthstar Geographics"

    # Contadores + alertas del panel lateral sobre la MISMA matriz ya
    # calculada — antes eran dos barridos extra de effective_states
    status_counts = _live_status_counts(db, effs)
    total_beaches = db.query(func.count(Beach.id)).scalar()
    salerts = _alert_cards(_alert_entries(db, effs)[:4], datetime.now(UTC), db)

    return {
        "title": title,
        "desc": desc,
        "public_url": settings.public_url,
        "beach_id": beach.id,
        "head_bg": head_bg,
        "wave_c": wave_c,
        "name": name,
        "muni": muni,
        # En CSS url() y en el JS la URL va en crudo (|safe / tojson);
        # en atributos el autoescape la escribe como &amp; — correcto
        "bg_url": urls[start],
        "shot_src": urls[start],
        "urls": urls,
        "start": start,
        "dots_levels": dots_levels,
        "zone_levels": zone_levels,
        # Pin limpio en la ficha: el badge de causa ya vive dentro del
        # chip — el pin-structural del mapa lo llevaría duplicado
        "pin": (
            "pin-structural-plain"
            if _PIN.get(state) == "pin-structural"
            else _PIN.get(state, _PIN["unknown"])
        ),
        "label": label,
        "color": color,
        "chip_art": chip_art,
        "notice": notice,
        "quality": quality,
        "outfalls": outfall_ctxs,
        "press": press,
        "chart": chart,
        "chart_h": _CHART_H,
        "incidents": incident_ctxs,
        "deep": deep,
        "foot": foot,
        "n_closed": status_counts.get("closed", 0),
        "n_warning": status_counts.get("warning", 0),
        "total_beaches": total_beaches,
        "salerts": salerts,
    }


# -- Ficha publica de emisario (/o/{id}) --------------------------
# Port de frontend/lib/outfallSheet.ts y lib/outfallRisk.ts: mismas
# frases y reglas que la ficha de la app, testeables sin HTTP.

_CONDITION_COLOR = {
    "Bueno": "#2e9e6b",
    "Precario": "#e65100",
    "Malo": "#c62828",
}
_RISK_LABEL = {
    "alto": "Riesgo alto",
    "medio": "Riesgo medio",
    "bajo": "Riesgo bajo",
}
# Mismos colores que colors.risk de la app: el alto comparte el
# rojo del censo ilegal — en el triaje conviven y dos rojos
# distintos leían como error
_RISK_COLOR = {"alto": "#d50000", "medio": "#f9a825", "bajo": "#0d9488"}

_NEARBY_BEACH_RADIUS_M = 1500  # mismo radio que /outfalls/{id}/nearby-beaches

# Punto + etiqueta de estado por zona en el selector de playas
# cercanas (mismos colores que la ficha/la app)
_ZONE_STATE = {
    "open": ("#2e9e6b", "Apta"),
    "warning": ("#e65100", "Con aviso"),
    "closed": ("#c62828", "Cerrada"),
    "structural": ("#7a1f1f", "Cerrada"),
    "unknown": ("#8fa3ad", None),
}


def _fmt_dist(m: float) -> str:
    """Port de fmtDistance: '296 m' / '1.0 km'."""
    return f"{round(m)} m" if m < 1000 else f"{m / 1000:.1f} km"


def _esri_thumb(lon: float, lat: float) -> str:
    """Miniatura cuadrada Esri (port de thumbUrl): scale 0.2 ≈ 146 m
    de encuadre — el máximo zoom antes de que la imagen se pixelice."""
    d = 0.0033 * 0.2
    return (
        "https://server.arcgisonline.com/ArcGIS/rest/services/"
        f"World_Imagery/MapServer/export?bbox={lon - d},{lat - d},"
        f"{lon + d},{lat + d}&bboxSR=4326&imageSR=4326&size=160,160"
        "&format=png&f=image"
    )


def _cap1(s: str) -> str:
    return s[0].upper() + s[1:] if s else s


def _origin_kind_label(t: str) -> str | None:
    """Sigla del censo -> tipo de instalacion."""
    if t.startswith("EBAR"):
        return "bombeo de aguas residuales"
    if t.startswith("EDAM"):
        return "desaladora"
    if re.match(r"^E[DT]A[RS]", t):
        return "depuradora"
    return None


def _origin_label(s: str) -> str:
    if "+" in s:
        labels = [_origin_kind_label(t.strip()) for t in s.split("+")]
        if all(labels):
            return _cap1(" + ".join(dict.fromkeys(x for x in labels if x)))
    lbl = _origin_kind_label(s.strip())
    return _cap1(lbl) if lbl else s


def _protected_area_name(s: str) -> str:
    """'ZEC Franja marina Teno - Rasca. no ZEC 103_TF. Ref. ES7020017'
    -> solo el nombre (los codigos son registro, no info de ficha)."""
    return (
        re.split(r"\.\s*(?:n[ºú]|Ref\.?|ES\d)", s, flags=re.I)[0]
        .strip()
        .rstrip(".")
    )


def _protected_area_note(s: str) -> str:
    if re.search(r"Teno\s*-\s*Rasca", s, re.I):
        return (
            ", hogar de calderones tropicales y delfines mulares,"
            " con cachalotes y tortugas de paso"
        )
    if re.search(r"Sebadales", s, re.I):
        return (
            ", que protege praderas de sebada, fanerógamas marinas"
            " que sirven de criadero de peces"
        )
    return ""


def _zone_text(zd: str) -> str:
    """La descripcion del censo mezcla frases completas con fragmentos
    secos: se limpia el sujeto redundante y el fragmento se convierte
    en frase."""
    s = re.sub(r"\s+", " ", zd.strip()).rstrip(".").strip()
    if re.match(r"^(?:el|la|los|las|se|este|esta)\b", s, re.I):
        s = re.sub(
            r"^(?:el|la|los|las)\s+(?:emisario(?:\s+submarino)?|"
            r"conducci[oó]n(?:\s+(?:submarina|de\s+(?:desag[üu]e|"
            r"vertido)))?|canal|tuber[ií]a|instalaci[oó]n"
            r"(?:\s+de\s+vertido)?)\s+",
            "",
            s,
            flags=re.I,
        )
        return _cap1(s) + "."
    s = re.sub(r"^situad[oa]\s+", "", s, flags=re.I)
    if re.match(r"^en\b", s, re.I):
        return f"El punto de vertido está {s[0].lower() + s[1:]}."
    fem = re.match(
        r"^(escollera|rasa|playa|zona|parte|trasera|urbanizaci[oó]n|"
        r"costa|peque[ñn]a|plaza|piscina|d[aá]rsena|desembocadura|"
        r"proximidades|explanada|ensenada|caleta|colada)",
        s,
        re.I,
    )
    masc = re.match(
        r"^(paseo|muelle|muellito|puerto|entorno|acantilado|barranco|"
        r"extremo|final|interior|espald[oó]n|dique|pozo|parque|lado)",
        s,
        re.I,
    )
    body = (
        f"la {s[0].lower() + s[1:]}"
        if fem
        else f"el {s[0].lower() + s[1:]}"
        if masc
        else s
    )
    return f"El punto de vertido está en {body}."


def _conduit_segs(
    kind: str | None,
    shore: float | None,
    length: float | None,
    depth: float | None,
) -> list[dict] | None:
    """'Emisario submarino que vierte a 646 m de la orilla y a 24 m de
    profundidad.' — segmentos con marca b=negrita."""
    segs: list[dict] = []
    if kind:
        segs.append({"t": _cap1(kind)})
    elif shore is not None or length is not None or depth is not None:
        segs.append({"t": "La conducción"})
    if not segs:
        return None
    if shore is not None:
        segs += [
            {"t": " que vierte a "},
            {"t": f"{round(shore)} m", "b": True},
            {"t": " de la orilla"},
        ]
    elif length is not None:
        segs += [{"t": " de "}, {"t": f"{round(length)} m", "b": True}]
    if depth is not None:
        if depth < 0:
            segs += [
                {"t": " y a "},
                {"t": f"{abs(depth):g} m", "b": True},
                {"t": " de profundidad"},
            ]
        else:
            segs.append(
                {
                    "t": (
                        " y cae sobre la superficie del mar"
                        if depth > 0
                        else " y sale a ras de mar"
                    )
                }
            )
    segs.append({"t": "."})
    return segs


def _nature_parts(
    nature: str,
    origin: str | None,
    depth: float | None,
    zone_desc: str | None,
) -> list[dict]:
    """Una linea por sustancia: instalacion + que lleva + nota de
    impacto — mismo texto que la app."""
    n = nature.lower()
    o = (origin or "").lower()
    zd = (zone_desc or "").lower()
    pretreated = "pretratamiento" in o or "pretratamiento" in zd
    parts = []
    industrial_only = "industrial" in n and "urbana" not in n
    # El veredicto de tratamiento va en línea propia coloreada — es
    # la conclusión, no una nota gris. EDAR/ETAR/depuradora → sale
    # depurada; red/bombeo/aliviadero → en bruto. Sin origen claro
    # no se inventa el veredicto (port de natureParts)
    treated = (
        not pretreated
        and re.search(r"e[dt]a[rs]|depuradora|tratamiento", o) is not None
        and not re.search(r"ebar|bombeo|aliviadero|saneamiento|red", o)
    )
    raw = not pretreated and re.search(
        r"ebar|bombeo|aliviadero|saneamiento|red", o
    )
    if "residual" in n:
        src = (
            "Estación de pretratamiento"
            if pretreated
            else "Depuradora"
            if re.search(r"e[dt]a[rs]|depuradora|tratamiento", o)
            else "Red de saneamiento"
            if re.search(r"ebar|bombeo|saneamiento|aliviadero|red", o)
            else None
        )
        parts.append(
            {
                "src": src,
                "name": (
                    "agua de procesos industriales"
                    if industrial_only
                    else "aguas fecales, domésticas e industriales"
                    if "industrial" in n
                    else "aguas fecales y domésticas"
                ),
                "desc": (
                    "químicos, hidrocarburos o metales"
                    if industrial_only
                    else None
                ),
                "note": (
                    "restos de la actividad de la planta — el impacto"
                    " depende de la industria y su tratamiento."
                    if industrial_only
                    else "solo filtra lo grueso (sólidos, arenas y grasas)."
                    if pretreated
                    else None
                    if treated or raw
                    else "el riesgo depende del tratamiento: depurada"
                    " es leve, en bruto es contaminación fecal."
                ),
                "verdict": (
                    None
                    if industrial_only
                    else "El agua sale sin depurar."
                    if pretreated
                    else "Sale depurada: impacto leve sobre el agua."
                    if treated
                    else "Vierte en bruto: puede llevar contaminación fecal."
                    if raw
                    else None
                ),
                "verdict_bad": bool(pretreated or raw),
            }
        )
    if "salmuera" in n:
        shallow = depth is not None and (depth >= 0 or abs(depth) < 8)
        note = (
            "no lleva fecales, pero es más densa que el mar y puede"
            " formar una capa sobre el fondo que daña praderas y"
            " bentos."
        )
        if shallow and depth is not None:
            note += (
                " Y aquí el vertido cae sobre la superficie del mar,"
                " así que esa capa salada llega al fondo casi sin"
                " diluirse."
                if depth >= 0
                else f" Y aquí vierte a solo {abs(depth):g} m de"
                " profundidad, así que esa capa salada llega al"
                " fondo casi sin diluirse."
            )
        note += " El bañista apenas lo nota."
        parts.append(
            {
                "src": (
                    "Desaladora"
                    if re.search(r"edam|desaladora|salina", o)
                    else None
                ),
                "name": "salmuera",
                "desc": "concentrado de sal",
                "note": note,
                "verdict": None,
                "verdict_bad": False,
            }
        )
    if "piscina" in n:
        parts.append(
            {
                "src": (
                    "Piscinas"
                    if re.search(r"piscina|n[aá]utico|club", o)
                    else None
                ),
                "name": "agua de piscinas",
                "desc": "con cloro y sal",
                "note": "impacto leve y puntual.",
                "verdict": None,
                "verdict_bad": False,
            }
        )
    if "refrigeración" in n:
        parts.append(
            {
                "src": None,
                "name": "agua de refrigeración",
                "desc": "sale más caliente que el mar",
                "note": "impacto leve y puntual.",
                "verdict": None,
                "verdict_bad": False,
            }
        )
    if "pluvial" in n:
        parts.append(
            {
                "src": "Red de pluviales" if "pluvial" in o else None,
                "name": "agua de lluvia",
                "desc": "arrastra aceites, metales y suciedad de las calles",
                "note": "no es fecal, pero tras la sequía sale cargada.",
                "verdict": None,
                "verdict_bad": False,
            }
        )
    multi = len(parts) > 1
    return [
        {
            "label": (
                f"{pt['src']} ({pt['name']})"
                if multi and pt["src"]
                else pt["src"] or pt["name"]
            ),
            "desc": pt["desc"],
            "note": pt["note"],
            "verdict": pt["verdict"],
            "verdict_bad": pt["verdict_bad"],
            "colon": multi or bool(pt["desc"]),
        }
        for pt in parts
    ]


def _operation_text(active: bool | None, continuity: str | None) -> str | None:
    """EstadoFunc + ContinVert en una frase legible — evita la aparente
    contradiccion 'no activo pero vertido habitual'."""
    habitual = continuity == "Habitual"
    # "De excedencia-emergencia" del censo = válvula de escape que
    # solo abre cuando el sistema se desborda — no "emergencia" en
    # sentido de catástrofe
    overflow = (
        "cuando el sistema se desborda: lluvia fuerte, avería o más"
        " caudal del que la depuradora puede tratar"
    )
    if active is True:
        if continuity is None:
            return "En funcionamiento actualmente."
        return (
            "Funciona hoy: vierte de forma continua en uso normal."
            if habitual
            else f"Funciona hoy, pero solo debería verter {overflow}."
        )
    if active is False:
        if continuity is None:
            return "No opera ahora mismo."
        return (
            "No opera ahora mismo, aunque está pensado para verter a diario."
            if habitual
            else "No opera ahora mismo; está pensado para abrir solo"
            f" {overflow}."
        )
    if continuity is None:
        return None
    return (
        "Pensado para vertido habitual."
        if habitual
        else f"Pensado para abrir solo {overflow}."
    )


def _operation_short(active: bool | None, continuity: str | None) -> str:
    """Celda "Funcionamiento" del triaje (port de operationShort):
    operationText comprimido a su titular — el matiz completo va
    en la frase de detalle."""
    habitual = continuity == "Habitual"
    if active is True:
        if continuity is None:
            return "En funcionamiento"
        return "Vierte a diario" if habitual else "Solo al desbordarse"
    if active is False:
        return "Ahora no vierte"
    if continuity is None:
        return "Sin datos"
    return "Vertido habitual" if habitual else "Solo al desbordarse"


def _smart_title(s: str) -> str:
    """Responsables del censo en mayúsculas ('CLUB NAUTICO DE
    BAJAMAR' → 'Club Nautico de Bajamar') — port de smartTitle:
    solo reescribe si TODO viene en mayúsculas; conectores en
    minúscula y siglas conocidas se conservan."""
    if not re.search(r"[A-ZÁÉÍÓÚÑ]", s) or re.search(r"[a-záéíóúñ]", s):
        return s
    small = {
        "de",
        "del",
        "la",
        "el",
        "los",
        "las",
        "y",
        "en",
        "a",
        "al",
        "con",
        "por",
        "para",
    }
    acronym = re.compile(
        r"^(CEPSA|E[DTBA]A[RMS]I?|PM\d*|[IVXLCDM]+|S\.?A\.?|S\.?L\.?)$", re.I
    )

    def _w(w: str, i: int) -> str:
        if acronym.match(w):
            return w.upper()
        if i > 0 and w in small:
            return w
        return w[0].upper() + w[1:]

    return re.sub(
        r"-([a-záéíóúñ])",
        lambda m: f"-{m.group(1).upper()}",
        " ".join(_w(w, i) for i, w in enumerate(s.lower().split(" "))),
    )


def _outfall_risk(o: Outfall) -> dict:
    """Indice de riesgo del vertido (port de outfallRisk.ts): score
    ponderado sobre datos del censo + las 3 razones que mas pesan."""
    n = (o.nature or "").lower()
    org = (o.origin or "").lower()
    zd = (o.zone_desc or "").lower()
    weighted: list[tuple[float, str]] = []

    substance = 0.0
    if "residual" in n:
        urban = "urbana" in n or "doméstica" in n
        industrial = "industrial" in n
        if industrial and not urban:
            substance = 2
            weighted.append(
                (2, "vertido industrial (químicos o hidrocarburos)")
            )
        else:
            pretreated = "pretratamiento" in f"{org} {zd}"
            treated = (
                not pretreated
                and re.search(r"e[dt]a[rs]|depuradora|tratamiento", org)
                and not re.search(
                    r"ebar|bombeo|aliviadero|saneamiento|red", org
                )
            )
            substance = (1 if treated else 2) + (0.5 if industrial else 0)
            weighted.append(
                (
                    substance,
                    "solo pretratada (sin depurar)"
                    if pretreated
                    else "vierte depurada"
                    if treated
                    else "vierte con potencial fecal",
                )
            )
    elif "salmuera" in n:
        substance = 1
        weighted.append((1, "salmuera (afecta al fondo marino)"))
    elif "pluvial" in n:
        substance = 1
        weighted.append((1, "riada urbana cargada"))
    elif "piscina" in n:
        substance = 0.5
        weighted.append((0.5, "cloro y sal de piscina"))
    elif "refrigeración" in n:
        substance = 0.5
        weighted.append((0.5, "vierte agua caliente"))

    if o.is_active is True and o.continuity == "Habitual":
        weighted.append((2 if substance >= 1 else 0.5, "vierte a diario"))
    elif o.is_active is True:
        weighted.append((1, "sigue en funcionamiento"))

    sv = o.status.value if hasattr(o.status, "value") else o.status
    if sv == "illegal":
        weighted.append((1, "sin autorización"))
    if o.protected_area and substance >= 1:
        weighted.append((1, "en zona protegida"))

    d = o.outfall_depth
    shallow = (
        (d is not None and (d >= 0 or abs(d) < 8))
        or "DPMT" in (o.kind or "")
        or (o.shore_m is not None and o.shore_m < 50)
    )
    if shallow and substance >= 1:
        weighted.append((1, "vierte en la orilla"))

    if o.condition == "Malo":
        weighted.append((1, "estado malo"))
    elif o.condition == "Precario":
        weighted.append((0.5, "estado precario"))

    score = sum(w for w, _ in weighted)
    level = "alto" if score >= 5 else "medio" if score >= 3 else "bajo"
    reasons = [r for _, r in sorted(weighted, key=lambda t: -t[0])[:3]]
    return {
        "level": level,
        "label": _RISK_LABEL[level],
        "color": _RISK_COLOR[level],
        "reasons": reasons,
    }


def _beach_base_name(name: str) -> str:
    """Clave de agrupacion (port de beachBaseName): PMs, romanos y
    calas del mismo arenal cuentan una vez en 'playas cercanas'."""
    s = PM_SUFFIX.sub("", name)
    s = re.sub(r"\s+(I|II|III|IV)\s*(?=\))", "", s)
    s = re.sub(r"\s+(I|II|III|IV)(?=\s*\(|\s*$)", "", s)
    return ARENAL_BASES.get(normalize_beach_name(s), s)


def outfall_row(db: Session, outfall_id: int):
    """(Outfall, lon, lat) o None — compartida por /o/{id} y og."""
    return (
        db.query(
            Outfall,
            func.ST_X(Outfall.geom).label("lon"),
            func.ST_Y(Outfall.geom).label("lat"),
        )
        .filter(Outfall.id == outfall_id)
        .one_or_none()
    )


def outfall_context(
    db: Session, outfall: Outfall, lon: float, lat: float
) -> dict:
    """Contexto de /o/{id}: replica web de la ficha de emisario de la
    app (legalidad, funcionamiento, riesgo, ZEC, que se vierte, donde
    y como, playas cercanas, fuente del censo)."""
    status = (
        outfall.status.value
        if hasattr(outfall.status, "value")
        else outfall.status
    )
    label, color = _OUTFALL_STATUS.get(status, _OUTFALL_STATUS["unknown"])
    name = outfall.name
    muni = outfall.municipality or "Tenerife"

    # Cabecera teñida por legalidad: ilegal rojo, autorizado verde,
    # en tramite ambar
    head_bg = {
        "illegal": "linear-gradient(180deg,#7a1f1f,#c62828)",
        "legal": "linear-gradient(180deg,#155e43,#2e9e6b)",
        "unknown": "linear-gradient(180deg,#8a6d1a,#f9a825)",
    }.get(status, "linear-gradient(180deg,#075276,#17b8ce)")
    wave_c = {
        "illegal": "#c62828",
        "legal": "#2e9e6b",
        "unknown": "#f9a825",
    }.get(status, "#17b8ce")

    urls = [_shot_url(lon, lat, *d) for d in _SHOT_LEVELS]
    start = len(_SHOT_LEVELS) - 1

    # Dots del encuadre: otros emisarios + playas (mismo gesto que
    # shotMarkers de la app — el emisario en cuestion es el pin
    # central)
    effs = effective_states(db)
    others = (
        db.query(
            Outfall.status,
            Outfall.name,
            func.ST_X(Outfall.geom).label("olon"),
            func.ST_Y(Outfall.geom).label("olat"),
        )
        .filter(Outfall.id != outfall.id)
        .all()
    )
    beaches = (
        beaches_with_latest_status(db)
        .add_columns(
            func.ST_X(Beach.geom).label("blon"),
            func.ST_Y(Beach.geom).label("blat"),
        )
        .all()
    )

    def _level(dlon: float, dlat: float) -> list[dict]:
        dots = []
        for st, nm, olon, olat in others:
            if olon is None:
                continue
            x, y = _px(olon, olat, lon, lat, dlon, dlat)
            if 0 <= x <= 100 and 0 <= y <= 100:
                sv = st.value if hasattr(st, "value") else st
                dots.append(
                    {
                        "x": f"{x:.1f}",
                        "y": f"{y:.1f}",
                        "pin": _OUTFALL_PIN.get(sv, _OUTFALL_PIN["unknown"]),
                        "title": nm,
                    }
                )
        for b, _st, blon, blat in beaches:
            if blon is None:
                continue
            x, y = _px(blon, blat, lon, lat, dlon, dlat)
            if 0 <= x <= 100 and 0 <= y <= 100:
                eff = effs.get(b.id)
                dots.append(
                    {
                        "x": f"{x:.1f}",
                        "y": f"{y:.1f}",
                        "pin": _PIN.get(_display_state(eff), _PIN["unknown"]),
                        "title": _display_name(b.name),
                    }
                )
        return dots

    dots_levels = [_level(*d) for d in _SHOT_LEVELS]

    # Playas cercanas <=1.5 km, agrupadas por arenal (los PMs del mismo
    # complejo en una fila — port de nearbyUniqueBeaches); las
    # multipunto llevan sus zonas para el selector tipo ZonePicker
    outfall_geog = cast(literal(outfall.geom, type_=Geometry), Geography)
    nearby_rows = (
        db.query(
            Beach,
            func.ST_X(Beach.geom).label("blon"),
            func.ST_Y(Beach.geom).label("blat"),
            func.ST_Distance(Beach.geom.cast(Geography), outfall_geog).label(
                "distance_m"
            ),
        )
        .filter(
            func.ST_DWithin(
                Beach.geom.cast(Geography),
                outfall_geog,
                _NEARBY_BEACH_RADIUS_M,
            )
        )
        .order_by("distance_m")
        .all()
    )
    groups: dict[str, dict] = {}
    order: list[str] = []
    for b, blon, blat, dist in nearby_rows:
        base = _beach_base_name(b.name)
        g = groups.get(base)
        if g is None:
            g = groups[base] = {
                "name": _display_name(base),
                "muni": b.municipality or "",
                "zones": [],
            }
            order.append(base)
        ds = _display_state(effs.get(b.id))
        scol, slabel = _ZONE_STATE.get(ds, _ZONE_STATE["unknown"])
        g["zones"].append(
            {
                "beach_id": b.id,
                "tag": _zone_suffix(db, b).lstrip(" ·") or "Zona",
                "dist": round(dist),
                "dist_s": _fmt_dist(dist),
                "scol": scol,
                "slabel": slabel,
                "coords": (blon, blat),
            }
        )
    nearby = []
    for base in order:
        g = groups[base]
        dist = min(z["dist"] for z in g["zones"])
        g["dist_s"] = _fmt_dist(dist)
        # Solo <500 m se enciende en la píldora (misma regla que la
        # app): en campo cercano la dilución aún no ha hecho su
        # trabajo — "pegada" es un umbral honesto, no un semáforo
        # de precisión inventado
        g["hot"] = dist < 500
        # Miniatura Esri del arenal (thumbUrl de la app): reconocer
        # la playa de un vistazo vende mejor que el nombre
        lon, lat = min(g["zones"], key=lambda z: z["dist"])["coords"]
        g["thumb"] = _esri_thumb(lon, lat)
        for z in g["zones"]:
            del z["coords"]
        nearby.append(g)
        if len(nearby) >= 5:
            break

    zone_line = _zone_text(outfall.zone_desc) if outfall.zone_desc else None
    where_extra = [
        v
        for v in (outfall.location, outfall.settlement, muni)
        if v and (not zone_line or v.lower() not in zone_line.lower())
    ]
    where_extra = list(dict.fromkeys(where_extra))

    operation = _operation_text(outfall.is_active, outfall.continuity)
    # Detalle bajo el triaje (port de operationDetail): la frase
    # completa solo cuando añade algo que la celda no dice —
    # "Vierte a diario"/"En funcionamiento" ya la cuentan; los
    # desbordes, las paradas y el régimen sin estado sí aportan
    op_detail = (
        None
        if outfall.is_active is True
        and outfall.continuity in (None, "Habitual")
        else operation
    )
    risk = _outfall_risk(outfall)
    parts = (
        _nature_parts(
            outfall.nature,
            outfall.origin,
            outfall.outfall_depth,
            outfall.zone_desc,
        )
        if outfall.nature
        else []
    )
    # Tiles numéricos del dato hero (port de kpiSegs + tile de
    # longitud): "vierte a / 4 m / de la orilla · mide / 100 m / de
    # longitud". Con tiles la fila Conducción se reduce al tipo; el
    # vertido a ras de mar lleva tile "0 m" — la gramática numérica
    # se mantiene sin fingir profundidad
    tiles = []
    if outfall.shore_m is not None:
        tiles.append(
            {
                "lead": "vierte a",
                "v": f"{round(outfall.shore_m)} m",
                "l": "de la orilla",
            }
        )
    if outfall.outfall_depth == 0:
        tiles.append({"lead": "vierte a", "v": "0 m", "l": "a ras de mar"})
    elif outfall.outfall_depth is not None:
        tiles.append(
            {
                "lead": "vierte a",
                "v": f"{abs(outfall.outfall_depth):g} m",
                "l": (
                    "bajo el mar"
                    if outfall.outfall_depth < 0
                    else "sobre el mar"
                ),
            }
        )
    if outfall.length_m is not None:
        tiles.append(
            {
                "lead": "mide",
                "v": (
                    f"{outfall.length_m / 1000:.1f} km"
                    if outfall.length_m >= 1000
                    else f"{round(outfall.length_m)} m"
                ),
                "l": "de longitud",
            }
        )
    # Conducción como frase solo cuando no hay tiles — si no, el
    # número ya lo cuenta el tile y la fila basta con el tipo
    conduit = (
        None
        if tiles
        else _conduit_segs(
            outfall.kind,
            outfall.shore_m,
            outfall.length_m,
            outfall.outfall_depth,
        )
    )
    conduit_row = (
        [s for s in conduit if s["t"] != "."]
        if conduit
        else [{"t": _cap1(outfall.kind)}]
        if outfall.kind
        else None
    )
    condition = (
        {
            "text": _cap1(outfall.condition.lower()),
            "color": _CONDITION_COLOR.get(outfall.condition, "#16323f"),
            "icon": "icon-ok" if outfall.condition == "Bueno" else "icon-warn",
        }
        if outfall.condition
        else None
    )
    # "Dónde y cómo" como ficha técnica: filas etiqueta+dato con
    # icono — el responsable vive aquí (es administrativo, igual que
    # en la app), no en "Qué se vierte"
    where_rows: list[dict] = []
    if where_extra:
        where_rows.append(
            {
                "icon": "pin",
                "label": "Ubicación",
                "value": ", ".join(where_extra),
            }
        )
    if conduit_row:
        where_rows.append(
            {"icon": "icon-waves2", "label": "Conducción", "segs": conduit_row}
        )
    if condition:
        where_rows.append(
            {
                "icon": condition["icon"],
                "label": "Estado de la conducción",
                "value": condition["text"],
                "color": condition["color"],
            }
        )
    responsible = _smart_title(outfall.entity or outfall.manager or "")
    if responsible:
        where_rows.append(
            {
                "icon": "icon-townhall",
                "label": "Responsable",
                "value": responsible,
            }
        )
    protected = None
    if outfall.protected_area:
        protected = {
            "name": _protected_area_name(outfall.protected_area),
            "note": _protected_area_note(outfall.protected_area),
        }

    status_counts = _live_status_counts(db, effs)
    total_beaches = db.query(func.count(Beach.id)).scalar()
    salerts = _alert_cards(_alert_entries(db, effs)[:4], datetime.now(UTC), db)

    # Prensa de infra del punto — misma regla que /outfalls/{id}/news:
    # named = nombra ESTE punto, zone = infra genérica del entorno;
    # nunca cierres de playa por fecal (eso vive en la ficha de playa)
    def _news_card(pair: tuple) -> dict:
        n, bname = pair
        meta = n.source or ""
        if n.published_at:
            meta += f" · {n.published_at.strftime('%d/%m/%Y')}"
        if bname:
            meta += f" · {_display_name(bname)}"
        return {"url": n.url, "title": n.title, "meta": meta}

    # Cada fuente lleva su hecho como lead: `fact` limpio + fecha
    # encima del titular ("fisura del emisario · 28/05/25"); meta
    # pierde la fecha para no escribirla dos veces. Si el hecho ES
    # el titular (ítem sin causa extraída), la fila solo enseña
    # titular + meta
    def _news_row(pair: tuple) -> dict:
        n, bname = pair
        fact = clean_cause_text(infra_cause_of(n))
        if fact and norm_txt(fact) != norm_txt(n.title):
            meta = n.source or ""
            if bname:
                meta += f" · {_display_name(bname)}"
            return {
                "url": n.url,
                "title": n.title,
                "fact": fact,
                "date": (
                    n.published_at.strftime("%d/%m/%y")
                    if n.published_at
                    else ""
                ),
                "meta": meta,
            }
        card = _news_card(pair)
        card["fact"] = None
        card["date"] = ""
        return card

    # año → familias → filas con lead; "rows" y no "items": en
    # Jinja, f.items resolvería al método del dict
    def _years(groups: list[dict]) -> list[dict]:
        return [
            {
                "year": y["year"],
                "count": sum(f["count"] for f in y["families"]),
                "families": [
                    {
                        "family": f["family"],
                        "count": f["count"],
                        "rows": [_news_row(p) for p in f["items"]],
                    }
                    for f in y["families"]
                ],
            }
            for y in groups
        ]

    _, _, news_summary, news_groups = gather_infra_news(db, outfall)
    news: dict = {
        "named_groups": _years(news_groups["named"]),
        "zone_groups": _years(news_groups["zone"]),
        # cabecera-estadística: "De este emisario · 14 noticias"
        "named_count": (news_summary or {}).get("named_count", 0),
    }
    # La card de episodios del entorno se retiró: era un espejo del
    # contador que cada playa ya lleva en su ficha y su número
    # agregado invitaba a leer causalidad en el emisario. El dato
    # sigue sirviéndose por /outfalls/{id}/news (campo episodes)
    # para quien lo quiera consumir — la landing no lo muestra.

    return {
        "title": f"{name} · {muni}",
        "desc": f"Emisario — {label} — CheckCoast Tenerife",
        "public_url": settings.public_url,
        "outfall_id": outfall.id,
        "deep": f"checkcoast://outfall/{outfall.id}",
        "head_bg": head_bg,
        "wave_c": wave_c,
        "name": name,
        "muni": muni,
        "bg_url": urls[start],
        "shot_src": urls[start],
        "urls": urls,
        "start": start,
        "dots_levels": dots_levels,
        "pin": _OUTFALL_PIN.get(status, _OUTFALL_PIN["unknown"]),
        "status_key": status,
        "label": label,
        "color": color,
        "funcionamiento": _operation_short(
            outfall.is_active, outfall.continuity
        ),
        "op_detail": op_detail,
        "risk": risk,
        "protected": protected,
        "nature": outfall.nature,
        "origin_label": (
            _origin_label(outfall.origin) if outfall.origin else None
        ),
        "parts": parts,
        "zone_lead": zone_line,
        "where_rows": where_rows,
        "tiles": tiles,
        "nearby": nearby,
        "news": news,
        "source_url": outfall.source_url,
        "n_closed": status_counts.get("closed", 0),
        "n_warning": status_counts.get("warning", 0),
        "total_beaches": total_beaches,
        "salerts": salerts,
    }


def _demo_alerts(all_beaches: list, now: datetime) -> list[tuple]:
    """Alertas fabricadas para previsualizar las secciones del
    banner de la landing (?demo=1): una por cada causa/estado.
    Reusa playas reales del censo para que los /b/{id} enlacen."""
    causes = [
        ("Algas", "closed"),
        ("Medusas", "closed"),
        ("Hidrocarburos", "closed"),
        ("Contaminación fecal", "closed"),
        ("Desprendimientos", "closed"),
        (None, "warning"),
    ]
    # Repartidas por la isla: con las 6 primeras de la BD todas
    # caian en Costa Adeje y en el mapa se apilaban en un solo
    # punto — solo se veia el pin de arriba (Ajabo)
    # Solo playas de punto unico: si la alerta cae en un PM de
    # arenal multipunto su dot queda escondido dentro del pin padre
    # hasta hacer zoom — en la vista isla no se veria
    singles = [
        r
        for r in all_beaches
        if r[2] is not None and not _PM_TAG.search(r[0].name)
    ]
    spread = sorted(singles, key=lambda r: r[2])
    picks = [
        spread[int(i * (len(spread) - 1) / (len(causes) - 1) + 0.5)]
        for i in range(len(causes))
    ]
    out = []
    for (b, _st, _lon, _lat), (cause, status) in zip(picks, causes):
        out.append(
            (
                b,
                {
                    "status": status,
                    "cause": cause,
                    "via": "press",
                    "reported_at": now,
                    "alerted": True,
                    "structural": cause
                    in {"Desprendimientos", "Obras", "Colapso del terreno"},
                },
            )
        )
    return out


# (clave, título de sección, etiqueta del pill de cabecera, clase CSS)
_ALERT_SECTIONS = [
    ("contam", "Contaminación", "Contaminación", "na"),
    ("fauna", "Fauna marina", "Fauna marina", "fa"),
    ("struct", "Cierre estructural", "Estructural", "st"),
    ("warn", "Avisos", "Avisos", "wn"),
]


def home_context(db: Session, demo: bool = False) -> dict:
    """Contexto de la portada: una sola matriz para todo — contadores,
    puntos del mapa, tarjetas de alerta y playas de ejemplo — antes la
    portada pintaba el estado oficial crudo y podía contradecir a la
    app (una playa reabierta según prensa salía roja en el mapa)."""
    effs = effective_states(db)
    status_counts = _live_status_counts(db, effs)
    total_beaches = db.query(func.count(Beach.id)).scalar()
    island_alerts = _alert_entries(db, effs)

    # Puntos del mapa isla: estado efectivo (igual que la app — una
    # reapertura de prensa no se pinta cerrada; un cierre estructural
    # va en granate). Solo playas monitorizadas + emisarios no
    # autorizados: el default de la app — los ~135 puntos OSM sin
    # datos sanitarios eran ruido gris que ahogaba las alertas
    all_beaches = (
        beaches_with_latest_status(db)
        .add_columns(
            func.ST_X(Beach.geom).label("lon"),
            func.ST_Y(Beach.geom).label("lat"),
        )
        .all()
    )
    if demo:
        # ?demo=1: las alertas fabricadas van DENTRO de la matriz —
        # solo sustituir island_alerts las dibujaba en las filas pero
        # el mapa seguia sin ellas (ni pin ni halo)
        now = datetime.now(UTC)
        for b, e in _demo_alerts(all_beaches, now):
            effs[b.id] = e
        status_counts = _live_status_counts(db, effs)
        island_alerts = _alert_entries(db, effs)

    clon, clat, dlon, dlat = _ISLAND
    map_dots = []
    # Emisarios no autorizados (mismo filtro por defecto que la app):
    # el censo costero es lo que la app aporta sobre el mapa oficial —
    # si la landing no los pinta, no se ve
    # Todas las capas van al DOM — la leyenda las enciende/apaga como
    # el panel «Capas» de la app; por defecto se ven las de siempre
    _OK = {
        "legal": ("olegal", "Emisario autorizado"),
        "illegal": ("oillegal", "Vertido no autorizado"),
        "unknown": ("oproc", "Emisario en trámite"),
    }
    outfall_dots = (
        db.query(Outfall)
        .add_columns(
            func.ST_X(Outfall.geom).label("lon"),
            func.ST_Y(Outfall.geom).label("lat"),
        )
        .all()
    )
    for o, lon, lat in outfall_dots:
        if lon is None:
            continue
        sv = o.status.value if hasattr(o.status, "value") else o.status
        k, olabel = _OK.get(sv, _OK["unknown"])
        x, y = _px(lon, lat, clon, clat, dlon, dlat)
        if 0 <= x <= 100 and 0 <= y <= 100:
            map_dots.append(
                {
                    "x": f"{x:.1f}",
                    "y": f"{y:.1f}",
                    "pin": _OUTFALL_PIN.get(sv, _OUTFALL_PIN["unknown"]),
                    "col": _OUTFALL_STATUS.get(sv, _OUTFALL_STATUS["unknown"])[
                        1
                    ],
                    "alert": False,
                    "outfall": True,
                    "oid": o.id,
                    "k": k,
                    "olabel": olabel,
                    "name": o.name or "Emisario",
                    "muni": o.municipality or "",
                    "lon": lon,
                    "lat": lat,
                }
            )
    # Un pin por arenal multipunto (como el ZonePicker de la app):
    # un solo pin en el centroide con el estado más grave; al pulsar
    # se despliega la lista de zonas. Agrupados por (base, municipio)
    _SEV = ["structural", "closed", "warning", "open", "unknown"]
    pm_groups: dict[tuple, list] = {}
    beach_dots: list[dict] = []
    for beach, _status, lon, lat in all_beaches:
        if lon is None:
            continue
        eff = effs.get(beach.id)
        # Todas las playas entran: las sin datos sanitarios quedan
        # bajo la capa «unmon», apagada por defecto — el mapa
        # inicial sigue mostrando solo las monitorizadas/con alerta
        dstate = _display_state(eff)
        x, y = _px(lon, lat, clon, clat, dlon, dlat)
        if not (0 <= x <= 100 and 0 <= y <= 100):
            continue
        m = _PM_TAG.search(beach.name)
        if m:
            key = (
                arenal_base(beach.name),
                _norm_muni(beach.municipality) or "",
            )
            pm_groups.setdefault(key, []).append(
                (beach, lon, lat, x, y, dstate, eff, int(m.group(1)))
            )
            continue
        dk, dpin, dcol = _dot_visual(dstate, eff)
        beach_dots.append(
            {
                "x": f"{x:.1f}",
                "y": f"{y:.1f}",
                # Los mismos PNG de pin que la app — la landing
                # parece app, no un mapa de dots ajenos
                "pin": dpin,
                "col": dcol,
                # Las playas con alerta viva llevan halo pulsante
                # (mismo gesto que los pines de la app) — entre
                # los ~140 puntos, lo que el visitante necesita
                # localizar es lo que pita
                "alert": eff["alerted"] if eff else False,
                # Estructural → anillo fijo en la app (lo crónico
                # no late); contaminación → pulso de urgencia
                "structural": dstate == "structural",
                "bid": beach.id,
                "k": dk,
                "name": _display_name(beach.name),
                "muni": beach.municipality or "",
                "lon": lon,
                "lat": lat,
            }
        )
    for _key, members in pm_groups.items():
        if len(members) == 1:
            beach, lon, lat, x, y, dstate, eff, _n = members[0]
            dk, dpin, dcol = _dot_visual(dstate, eff)
            beach_dots.append(
                {
                    "x": f"{x:.1f}",
                    "y": f"{y:.1f}",
                    "pin": dpin,
                    "col": dcol,
                    "alert": eff["alerted"] if eff else False,
                    "structural": dstate == "structural",
                    "bid": beach.id,
                    "k": dk,
                    "name": _display_name(beach.name),
                    "muni": beach.municipality or "",
                    "lon": lon,
                    "lat": lat,
                }
            )
            continue
        members.sort(key=lambda t: t[7])
        worst = min(members, key=lambda t: _SEV.index(t[5]))
        cx = sum(t[3] for t in members) / len(members)
        cy = sum(t[4] for t in members) / len(members)
        clon2 = sum(t[1] for t in members) / len(members)
        clat2 = sum(t[2] for t in members) / len(members)
        base_beach = members[0][0]
        zones = []
        for beach, _lon, _lat, _x, _y, dstate, zeff, pmn in members:
            ze = _zone_entry(beach)
            zk, _zpin, zcol = _dot_visual(dstate, zeff)
            zones.append(
                {
                    "bid": beach.id,
                    "zone": (
                        ze["name"] if ze and ze.get("name") else f"Zona {pmn}"
                    ),
                    "label": (
                        "Cerrada · fauna"
                        if zk == "fauna"
                        else _STATUS.get(dstate, _STATUS["unknown"])[0]
                    ),
                    "color": zcol,
                }
            )
        wk, wpin, wcol = _dot_visual(worst[5], worst[6])
        beach_dots.append(
            {
                "x": f"{cx:.1f}",
                "y": f"{cy:.1f}",
                "pin": wpin,
                "col": wcol,
                "alert": any(t[6] and t[6]["alerted"] for t in members),
                "structural": worst[5] == "structural",
                "k": wk,
                "name": _display_name(PM_SUFFIX.sub("", base_beach.name)),
                "muni": base_beach.municipality or "",
                "lon": clon2,
                "lat": clat2,
                "complex": zones,
            }
        )
        # Los PMs del arenal también salen como dots propios: bajo el
        # umbral de zoom van ocultos (solo se ve el pin padre); al
        # acercar, cada zona muestra su estado y enlaza a su ficha —
        # el gesto del ZonePicker de la app trasladado al mapa web
        for beach, lon, lat, x, y, dstate, eff, _pmn in members:
            dk, dpin, dcol = _dot_visual(dstate, eff)
            beach_dots.append(
                {
                    "x": f"{x:.1f}",
                    "y": f"{y:.1f}",
                    "pin": dpin,
                    "col": dcol,
                    "alert": eff["alerted"] if eff else False,
                    "structural": dstate == "structural",
                    "bid": beach.id,
                    "k": dk,
                    "name": _display_name(beach.name)
                    + _zone_suffix(db, beach),
                    "muni": beach.municipality or "",
                    "lon": lon,
                    "lat": lat,
                    "cxmember": True,
                }
            )
    map_dots.extend(beach_dots)

    # Alertas vivas (misma lista que el panel lateral de /b/)
    now = datetime.now(UTC)
    alerts = _alert_cards(island_alerts, now, db)
    # Agrupadas por sección — mismo patrón que el banner de la app
    alert_groups = [
        {
            "sec": sec,
            "title": title,
            "pill": pill,
            "pcls": pcls,
            "rows": [a for a in alerts if a["sec"] == sec],
        }
        for sec, title, pill, pcls in _ALERT_SECTIONS
    ]
    alert_groups = [g for g in alert_groups if g["rows"]]
    # Desglose para las pills de la cabecera: el granate de los
    # cierres estructurales no es el rojo de la contaminación
    n_struct = sum(1 for a in alerts if a["art"] == "rockfall-art")

    # Reaperturas recientes (≤30 d, según prensa) — el contrapunto
    # verde bajo las alertas: la isla no solo cierra, también reabre
    reopened = []
    seen: set[str] = set()
    for n, b in (
        db.query(NewsItem, Beach)
        .join(Beach, NewsItem.beach_id == Beach.id)
        .filter(
            NewsItem.event_type == "reopening",
            NewsItem.published_at >= now - timedelta(days=30),
        )
        .order_by(NewsItem.published_at.desc())
        .limit(40)
    ):
        if n.beach_id is None:
            continue
        # La fila enlaza a la ficha del PM concreto — en un complejo
        # multipunto el nombre sin zona mentía ("Playa Jardín" que abre
        # Punta Brava): mismo sufijo que la cabecera de la app
        dname = _display_name(b.name) + _zone_suffix(db, b)
        if dname in seen:
            continue
        seen.add(dname)
        reopened.append(
            {
                "beach_id": n.beach_id,
                "name": dname,
                "when": _alert_when("reabierta", n.published_at, now),
            }
        )
        if len(reopened) >= 6:
            break

    # Escala anual — la misma lectura que la cabecera de la app
    # («N episodios en YYYY · afectan a M de los K municipios con
    # playa · V siguen vigentes»): la instantánea de alertas dice
    # poco en un día tranquilo; el acumulado cuenta la persistencia
    ep_beaches = (
        db.query(Beach)
        .options(
            selectinload(Beach.incidents),
            selectinload(Beach.measurements),
            selectinload(Beach.news_items),
        )
        .all()
    )
    today_d = now.date()
    year_start = date(today_d.year, 1, 1)
    ep_rows = _merged_episode_rows(
        _collect_episodes(ep_beaches, today_d, include_measurement=False)
    )
    y_eps = [
        r
        for r in ep_rows
        if r.opened_at <= today_d
        and (r.closed_at is None or r.closed_at >= year_start)
    ]
    year_stats = {
        "year": today_d.year,
        "episodes": len(y_eps),
        "munis": len({r.municipality for r in y_eps if r.municipality}),
        "total_munis": len(
            {b.municipality for b, *_ in all_beaches if b.municipality}
        ),
        "open": sum(1 for r in y_eps if r.closed_at is None),
    }

    # Frescura de datos: última pasada ok del sync de Náyade —
    # "Ahora mismo" merece un "según datos de hace X min" debajo
    last_sync = (
        db.query(JobRun.finished_at)
        .filter(JobRun.job == "nayade-sync", JobRun.ok.is_(True))
        .order_by(JobRun.finished_at.desc())
        .limit(1)
        .scalar()
    )
    fresh = ""
    if last_sync:
        if last_sync.tzinfo is None:
            last_sync = last_sync.replace(tzinfo=UTC)
        mins = int((now - last_sync).total_seconds() // 60)
        fresh = (
            "actualizado ahora mismo"
            if mins < 2
            else f"actualizado hace {mins} min"
            if mins < 60
            else f"actualizado hace {mins // 60} h"
        )

    # Emisarios: la otra mitad del relato — los puntos de vertido con
    # más recorrido en prensa (vía infra), ordenados por titulares y
    # desempatados por gravedad del triaje. Sin foto: el mar no
    # reconoce nada; el dato que importa es "N noticias"
    onews = dict(
        db.query(NewsItem.infra_outfall_id, func.count())
        .filter(
            NewsItem.infra_outfall_id.isnot(None),
            NewsItem.relevant.is_(True),
        )
        .group_by(NewsItem.infra_outfall_id)
        .all()
    )
    _OSEV = {"illegal": 0, "unknown": 1, "legal": 2}
    ostats = {"legal": 0, "illegal": 0, "unknown": 0}
    ocands: list[tuple[Outfall, str]] = []
    for o, _lon, _lat in outfall_dots:
        sv = o.status.value if hasattr(o.status, "value") else o.status
        ostats[sv] = ostats.get(sv, 0) + 1
        ocands.append((o, sv))
    ocands.sort(
        key=lambda t: (-onews.get(t[0].id, 0), _OSEV.get(t[1], 3), t[0].id)
    )
    orows = []
    for o, sv in ocands[:4]:
        lbl, col = _OUTFALL_STATUS.get(sv, _OUTFALL_STATUS["unknown"])
        risk = _outfall_risk(o)
        orows.append(
            {
                "id": o.id,
                "name": o.name or "Emisario",
                "muni": o.municipality or "",
                "label": lbl,
                "color": col,
                "risk_label": risk["label"],
                "risk_color": risk["color"],
                "zec": bool(o.protected_area),
                "news": onews.get(o.id, 0),
            }
        )
    n_outfalls = len(ocands)

    island_url = _shot_url_fit(clon, clat, dlon, dlat, 920)
    # bbox real del mapa para el MapLibre interactivo (fitBounds)
    ibounds = [clon - dlon, clat - dlat, clon + dlon, clat + dlat]
    return {
        "island_url": island_url,
        "ibounds": ibounds,
        "n_closed": status_counts.get("closed", 0),
        "n_warning": status_counts.get("warning", 0),
        "total_beaches": total_beaches,
        "map_dots": map_dots,
        "alerts": alerts,
        "alert_groups": alert_groups,
        "n_alerts": len(island_alerts),
        "n_struct": n_struct,
        "n_contam": len(alerts) - n_struct,
        "reopened": reopened,
        "n_reopened": len(reopened),
        "fresh": fresh,
        "orows": orows,
        "ostats": ostats,
        "n_outfalls": n_outfalls,
        "year_stats": year_stats,
        "demo": demo,
    }

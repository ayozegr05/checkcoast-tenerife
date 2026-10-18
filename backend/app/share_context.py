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
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
from geoalchemy2 import Geography, Geometry
from sqlalchemy import cast, func, literal
from sqlalchemy.orm import Session

from app.config import settings
from app.models import (
    Beach,
    BeachIncident,
    BeachMeasurement,
    JobRun,
    NewsItem,
    Outfall,
)
from app.names import PM_SUFFIX
from app.queries import beaches_with_latest_status, effective_states

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

# Encuadres satélite de más cerca a más lejos (dlon, dlat en grados)
_SHOT_LEVELS = [
    (0.003, 0.0017),  # muy cerca
    (0.006, 0.0033),  # cerca
    (0.015, 0.0083),  # lejos
]

# Mismos textos que la ficha de la app — "structural" es la variante
# granate del cierre (desprendimientos/obras), no un estado propio
_STATUS = {
    "closed": ("Cierre activo", "#c62828"),
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


def _live_status_counts(effs: dict) -> dict[str, int]:
    """Recuento de estados efectivos AHORA (misma regla que el mapa de
    la app) — antes se contaban todas las filas históricas de
    beach_statuses y el contador mentía (5 cerradas cuando hay 3).
    Recibe la matriz ya calculada: la portada/landing la usan además
    para pintar playa y alertas — un solo barrido."""
    counts: dict[str, int] = {}
    for e in effs.values():
        s = e["status"]
        s = s.value if hasattr(s, "value") else s
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


def _bar_h(v: float) -> int:
    return max(
        3, round(_CHART_H * math.log10(max(v, 1)) / math.log10(_LOG_CAP))
    )


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


def _alert_cards(entries: list[tuple], now: datetime) -> list[dict]:
    """Filas de alerta viva enlazables a su /b/{id} — la misma regla
    que /alerts, compartida por el panel lateral de /b/ y la portada.
    `entries` = salida de _alert_entries (Beach, fila de la matriz)."""
    cards = []
    for beach, e in entries:
        dstate = _display_state(e)
        cards.append(
            {
                # "s" = estructural: el panel usa la variante granate
                "cls": (
                    "s"
                    if dstate == "structural"
                    else "c"
                    if e["status"] == "closed"
                    else "w"
                ),
                "beach_id": beach.id,
                "color": _STATUS.get(dstate, _STATUS["unknown"])[1],
                "name": _display_name(beach.name),
                # Arte de causa como en el banner de la app:
                # estructural → desprendimiento, resto → contaminación
                "art": "rockfall-art"
                if dstate == "structural"
                else "contam-art",
                "cause": e["cause"],
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


def beach_context(db: Session, beach: Beach, lon: float, lat: float) -> dict:
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

    name = _display_name(beach.name)
    muni = beach.municipality or "Tenerife"
    # Cabecera teñida por estado efectivo, como la ficha de la app —
    # el cierre estructural va en granate, no en el rojo del vertido
    head_bg = {
        "closed": "linear-gradient(180deg,#7a1f1f,#c62828)",
        "structural": "linear-gradient(180deg,#5e2320,#8c322a)",
        "warning": "linear-gradient(180deg,#8a3c00,#e65100)",
    }.get(state, "linear-gradient(180deg,#075276,#17b8ce)")
    # La ola que separa cabecera y foto sigue el color final del
    # degradado del header
    wave_c = {
        "closed": "#c62828",
        "structural": "#8c322a",
        "warning": "#e65100",
    }.get(state, "#17b8ce")
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
                    "lim_y": _bar_h(float(_QUALITY[param]["good"])),
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
        "press n-structural"
        if state == "structural"
        else "press n-closed"
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
        if dom == "closure" and state not in ("closed", "structural"):
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

    # Contadores + alertas del panel lateral sobre la MISMA matriz ya
    # calculada — antes eran dos barridos extra de effective_states
    status_counts = _live_status_counts(effs)
    total_beaches = db.query(func.count(Beach.id)).scalar()
    salerts = _alert_cards(_alert_entries(db, effs)[:4], datetime.now(UTC))

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
        "pin": _PIN.get(state, _PIN["unknown"]),
        "label": label,
        "color": color,
        "notice": notice,
        "latest_line": latest_line,
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
_RISK_COLOR = {"alto": "#d84315", "medio": "#f9a825", "bajo": "#0d9488"}

_NEARBY_BEACH_RADIUS_M = 1500  # mismo radio que /outfalls/{id}/nearby-beaches


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
            " — hogar de calderones tropicales y delfines mulares,"
            " con cachalotes y tortugas de paso"
        )
    if re.search(r"Sebadales", s, re.I):
        return (
            " — protege praderas de sebada, fanerógamas marinas"
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
                    else "solo filtra lo grueso (sólidos, arenas y"
                    " grasas) — el agua sale sin depurar."
                    if pretreated
                    else "el riesgo depende del tratamiento: depurada"
                    " es leve, en bruto es contaminación fecal."
                ),
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
            }
        )
    if "refrigeración" in n:
        parts.append(
            {
                "src": None,
                "name": "agua de refrigeración",
                "desc": "sale más caliente que el mar",
                "note": "impacto leve y puntual.",
            }
        )
    if "pluvial" in n:
        parts.append(
            {
                "src": "Red de pluviales" if "pluvial" in o else None,
                "name": "agua de lluvia",
                "desc": "arrastra aceites, metales y suciedad de las calles",
                "note": "no es fecal, pero tras la sequía sale cargada.",
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
            "colon": multi or bool(pt["desc"]),
        }
        for pt in parts
    ]


def _operation_text(active: bool | None, continuity: str | None) -> str | None:
    """EstadoFunc + ContinVert en una frase legible — evita la aparente
    contradiccion 'no activo pero vertido habitual'."""
    habitual = continuity == "Habitual"
    overflow = (
        "cuando el sistema se desborda (lluvia fuerte, avería o más"
        " caudal del que la depuradora puede tratar)"
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
    """Clave de agrupacion (port de beachBaseName): PMs y romanos de
    un mismo arenal cuentan una vez en 'playas cercanas'."""
    s = PM_SUFFIX.sub("", name)
    s = re.sub(r"\s+(I|II|III|IV)\s*(?=\))", "", s)
    return re.sub(r"\s+(I|II|III|IV)(?=\s*\(|\s*$)", "", s)


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

    # Playas cercanas <=1.5 km, dedup por arenal (PM1/PM2 cuentan una
    # vez — port de nearbyUniqueBeaches)
    outfall_geog = cast(literal(outfall.geom, type_=Geometry), Geography)
    nearby_rows = (
        db.query(
            Beach.id,
            Beach.name,
            Beach.municipality,
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
    nearby = []
    seen_base: set[str] = set()
    for bid, bname, bmuni, dist in nearby_rows:
        base = _beach_base_name(bname)
        if base in seen_base:
            continue
        seen_base.add(base)
        nearby.append(
            {
                "beach_id": bid,
                "name": _display_name(_beach_base_name(bname)),
                "muni": bmuni or "",
                "dist": round(dist),
                # Barra de exposicion por distancia (misma escala que
                # la app): <500 pegado, <1000 alcance, resto diluido
                "dcol": "#c62828"
                if dist < 500
                else "#e65100"
                if dist < 1000
                else "#f9a825",
            }
        )
        if len(nearby) >= 5:
            break

    zone_line = _zone_text(outfall.zone_desc) if outfall.zone_desc else None
    where_extra = [
        v
        for v in (outfall.location, outfall.settlement, muni)
        if v and (not zone_line or v.lower() not in zone_line.lower())
    ]
    where_extra = list(dict.fromkeys(where_extra))
    place_text = (
        f"{zone_line[:-1]}, {', '.join(where_extra)}."
        if zone_line and where_extra
        else zone_line
        if zone_line
        else f"Está en {', '.join(where_extra)}."
        if where_extra
        else None
    )

    operation = _operation_text(outfall.is_active, outfall.continuity)
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
    conduit = _conduit_segs(
        outfall.kind,
        outfall.shore_m,
        outfall.length_m,
        outfall.outfall_depth,
    )
    protected = None
    if outfall.protected_area:
        protected = {
            "name": _protected_area_name(outfall.protected_area),
            "note": _protected_area_note(outfall.protected_area),
        }
    responsible = outfall.entity or outfall.manager

    status_counts = _live_status_counts(effs)
    total_beaches = db.query(func.count(Beach.id)).scalar()
    salerts = _alert_cards(_alert_entries(db, effs)[:4], datetime.now(UTC))

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
        "label": label,
        "color": color,
        "operation": operation,
        "risk": risk,
        "protected": protected,
        "nature": outfall.nature,
        "origin_label": (
            _origin_label(outfall.origin) if outfall.origin else None
        ),
        "parts": parts,
        "responsible": responsible,
        "place_text": place_text,
        "conduit": conduit,
        "condition": (
            {
                "text": outfall.condition.lower(),
                "color": _CONDITION_COLOR.get(outfall.condition, "#0d3a52"),
            }
            if outfall.condition
            else None
        ),
        "nearby": nearby,
        "source_url": outfall.source_url,
        "n_closed": status_counts.get("closed", 0),
        "n_warning": status_counts.get("warning", 0),
        "total_beaches": total_beaches,
        "salerts": salerts,
    }


def home_context(db: Session) -> dict:
    """Contexto de la portada: una sola matriz para todo — contadores,
    puntos del mapa, tarjetas de alerta y playas de ejemplo — antes la
    portada pintaba el estado oficial crudo y podía contradecir a la
    app (una playa reabierta según prensa salía roja en el mapa)."""
    effs = effective_states(db)
    status_counts = _live_status_counts(effs)
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
    for beach, _status, lon, lat in all_beaches:
        if lon is None:
            continue
        eff = effs.get(beach.id)
        # Todas las playas entran: las sin datos sanitarios quedan
        # bajo la capa «unmon», apagada por defecto — el mapa
        # inicial sigue mostrando solo las monitorizadas/con alerta
        dstate = _display_state(eff)
        x, y = _px(lon, lat, clon, clat, dlon, dlat)
        if 0 <= x <= 100 and 0 <= y <= 100:
            map_dots.append(
                {
                    "x": f"{x:.1f}",
                    "y": f"{y:.1f}",
                    # Los mismos PNG de pin que la app — la landing
                    # parece app, no un mapa de dots ajenos
                    "pin": _PIN.get(dstate, _PIN["unknown"]),
                    "col": _STATUS.get(dstate, _STATUS["unknown"])[1],
                    # Las playas con alerta viva llevan halo pulsante
                    # (mismo gesto que los pines de la app) — entre
                    # los ~140 puntos, lo que el visitante necesita
                    # localizar es lo que pita
                    "alert": eff["alerted"] if eff else False,
                    # Estructural → anillo fijo en la app (lo crónico
                    # no late); contaminación → pulso de urgencia
                    "structural": dstate == "structural",
                    "bid": beach.id,
                    "k": "unmon" if dstate == "unknown" else dstate,
                    "name": _display_name(beach.name),
                    "lon": lon,
                    "lat": lat,
                }
            )

    # Alertas vivas (misma lista que el panel lateral de /b/)
    now = datetime.now(UTC)
    alerts = _alert_cards(island_alerts, now)
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
        dname = _display_name(b.name)
        if dname in seen:
            continue
        seen.add(dname)
        reopened.append(
            {
                "beach_id": n.beach_id,
                "name": _display_name(b.name),
                "when": _alert_when("reabierta", n.published_at, now),
            }
        )
        if len(reopened) >= 6:
            break

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

    # Playas de ejemplo: las alertas actuales + las monitorizadas con
    # más analíticas (su landing enseña la gráfica histórica)
    example_ids = [b.id for b, _ in island_alerts[:3]]
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
        eff = effs.get(bid)
        lbl, col = _STATUS.get(_display_state(eff), _STATUS["unknown"])
        cards.append(
            {
                "beach_id": bid,
                "thumb": _shot_url(lon, lat, 0.006, 0.0033),
                "label": lbl,
                "color": col,
                "name": _display_name(b.name),
                "muni": b.municipality or "",
                "via_press": bool(eff and eff["via"] == "press"),
            }
        )

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
        "n_alerts": len(island_alerts),
        "n_struct": n_struct,
        "n_contam": len(alerts) - n_struct,
        "reopened": reopened,
        "n_reopened": len(reopened),
        "fresh": fresh,
        "cards": cards,
    }

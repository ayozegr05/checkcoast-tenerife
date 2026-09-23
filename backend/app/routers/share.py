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
from sqlalchemy import func
from sqlalchemy.orm import Session
from geoalchemy2 import Geography

from app.config import settings
from app.db import get_db
from app.models import (
    Beach,
    BeachIncident,
    BeachMeasurement,
    BeachStatus,
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
    news = news_items[0] if news_items else None
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
        f'<div class="ofname">{html.escape(o.name)}</div>'
        f'<div class="ofmeta">{_OUTFALL_STATUS.get(o.status.value, _OUTFALL_STATUS["unknown"])[0]}'
        f" · a {round(o.distance_m)} m</div></div>"
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
        when = (
            news.published_at.strftime("%d/%m/%Y") if news.published_at else ""
        )
        press = (
            f'<div class="{press_cls}"><div class="psum">{line}</div>'
            f'<div class="ptag">según prensa · {outlets} '
            f'medio{"s" if outlets != 1 else ""}</div>'
            f'<a class="ptitle" href="{html.escape(news.url)}">'
            f"{html.escape(news.title)}</a>"
            f'<div class="pmeta">{html.escape(news.source or "")}'
            f"{' · ' + when if when else ''}</div></div>"
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
    status_counts = {
        (k.value if hasattr(k, "value") else k): v
        for k, v in db.query(BeachStatus.status, func.count())
        .group_by(BeachStatus.status)
        .all()
    }
    total_beaches = db.query(func.count(Beach.id)).scalar()

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
    .sleg {{ background:rgba(255,255,255,.88);
            border:1px solid rgba(255,255,255,.25); border-radius:12px;
            padding:12px 14px; font-size:12px; color:#33566b; }}
    .sleg div {{ display:flex; align-items:center; gap:9px;
            margin:5px 0; }}
    .sleg img {{ width:20px; height:20px; }}
    .steps {{ margin-top:18px; background:rgba(255,255,255,.88);
            border:1px solid rgba(255,255,255,.25); border-radius:12px;
            padding:12px 14px; }}
    .step {{ display:flex; gap:10px; margin:9px 0; font-size:12px;
            line-height:1.45; color:#33566b; }}
    .step b {{ display:block; font-size:12px; color:#0d3a52; }}
    .stepn {{ flex:none; width:20px; height:20px; border-radius:50%;
            background:linear-gradient(135deg,#075276,#17b8ce);
            color:#fff; font-size:11px; font-weight:700;
            display:flex; align-items:center; justify-content:center;
            margin-top:1px; }}
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
  .zoom {{ position:absolute; top:8px; right:8px; display:flex;
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
          background:#f4f9fb; border-radius:0 8px 8px 0; }}
  .ofname {{ font-size:13px; font-weight:600; color:#0d3a52; }}
  .ofmeta {{ font-size:11px; color:#7a919c; margin-top:1px; }}
  .radius {{ font-size:11px; color:#7a919c; margin-top:6px; }}
  .press {{ margin:16px 0 6px; background:#fff7e8;
          border:1px solid #f0d9a8;
          border-radius:10px; padding:10px 12px; }}
  /* El banner de aviso (arriba) se tiñe por estado; el de contexto
     (abajo, en playas abiertas) queda ámbar neutro */
  .press.n-closed {{ background:#fdecea; border-color:#f0b4ac; }}
  .press.n-warning {{ background:#fff3e2; border-color:#f0cf9e; }}
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
  <aside class="side">
    <div class="sbrand">
      <img src="/icons/app-icon.png" alt="">CheckCoast
      <span class="tfe">Tenerife</span>
    </div>
    <p class="stag">El estado oficial de las playas de Tenerife —
      cierres, avisos y calidad del agua según Náyade (Min. Sanidad) —
      y los puntos de vertido que hay junto a ellas. Cuando el parte
      oficial no dice el porqué, la prensa local ayuda a explicarlo.</p>
    <div class="sstat"><div class="sl">Ahora mismo en Tenerife</div>
      <b>{status_counts.get('closed', 0)}</b> cerradas ·
      <b>{status_counts.get('warning', 0)}</b> con aviso ·
      <b>{total_beaches}</b> playas mapeadas</div>
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
    <div class="steps">
      <div class="step"><span class="stepn">1</span><div>
        <b>Náyade / Sanidad</b>El estado oficial de cada playa:
        cierres, avisos y analíticas de calidad del agua.</div></div>
      <div class="step"><span class="stepn">2</span><div>
        <b>Prensa local</b>Cuando el parte oficial no dice el porqué,
        la prensa lo explica — siempre etiquetada "según prensa".
        </div></div>
      <div class="step"><span class="stepn">3</span><div>
        <b>Emisarios</b>Los 180 puntos de vertido del censo
        tierra-mar junto a cada playa, con su situación legal.
        </div></div>
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

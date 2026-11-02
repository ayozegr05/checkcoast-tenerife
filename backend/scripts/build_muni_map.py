"""Genera los mini-mapas de municipio para la sección Municipios.

Descarga los límites municipales del portal de datos abiertos del
Cabildo de Tenerife (CC-BY), filtra roques/islotes (ROQUE), simplifica
la geometría con shapely y renderiza un PNG por municipio con el resto
de la isla en gris y el municipio resaltado en el acento de la app.

Salida: ../frontend/assets/muni-maps/<slug>.png + index de nombres.

Uso: .venv/Scripts/python -m scripts.build_muni_map
"""

from __future__ import annotations

import json
import math
import os
import unicodedata
import urllib.request

from PIL import Image, ImageDraw
from shapely.geometry import MultiPolygon, Polygon, shape

URL = (
    "https://datos.tenerife.es/ckan/dataset/"
    "d0fae4ae-3bd5-41fc-939b-d7b16e3d5bda/resource/"
    "98e3a02c-d7bf-4e1e-b54f-a13ca4fee148/download/municip_4326.geojson"
)
OUT_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "frontend", "assets", "muni-maps"
)

# Lienzo y estilo — mismos colores que frontend/lib/theme.ts
W, H, PAD = 480, 330, 18
FILL_BASE = "#c4d5dd"  # municipios vecinos — un escalón bajo la
# tarjeta marina (#e6f1f5) para que la isla no se funda con ella
FILL_HI = "#0d97ac"  # acento turquesa, un punto más profundo para destacar sobre la tarjeta
EDGE_BASE = "#ffffff"
EDGE_HI = "#086b96"  # primary
SIMPLIFY = 0.003  # ~300 m — aguanta el repintado a tamaño miniatura


def slug(name: str) -> str:
    """minúsculas sin tildes, guiones — 'San Cristóbal de La Laguna'
    y 'La Laguna' deben converger en el mismo fichero."""
    s = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower().strip().replace(" ", "-")


# Alias: el dataset del Cabildo usa nombres cortos para un par de
# municipios; el censo MITECO de la app usa el oficial completo
ALIAS = {
    "san cristobal de la laguna": "la laguna",
    "guimar": "guimar",  # Güímar en la app → Guimar en el dataset
}


def canon(name: str) -> str:
    """nombre app/dataset → nombre dataset"""
    key = " ".join(
        unicodedata.normalize("NFKD", name)
        .encode("ascii", "ignore")
        .decode()
        .lower()
        .split()
    )
    return ALIAS.get(key, key)


def load(src: str | None = None) -> dict[str, MultiPolygon]:
    """src: GeoJSON local (cache de una descarga previa) — si no se
    pasa, descarga del portal del Cabildo."""
    if src and os.path.exists(src):
        data = json.loads(open(src, encoding="utf-8").read())
    else:
        data = json.loads(urllib.request.urlopen(URL, timeout=60).read())
    by_muni: dict[str, list] = {}
    for f in data["features"]:
        if f["properties"].get("ROQUE"):
            continue  # islotes/roques — solo la isla grande
        geom = shape(f["geometry"])
        polys = (
            list(geom.geoms)
            if isinstance(geom, MultiPolygon)
            else [geom]
        )
        by_muni.setdefault(f["properties"]["NOMBRE"], []).extend(
            p for p in polys if isinstance(p, Polygon)
        )
    out: dict[str, MultiPolygon] = {}
    for name, geoms in by_muni.items():
        out[name] = MultiPolygon(geoms).simplify(SIMPLIFY)
    return out


def projector(geoms: list[MultiPolygon]):
    minx = min(g.bounds[0] for g in geoms)
    miny = min(g.bounds[1] for g in geoms)
    maxx = max(g.bounds[2] for g in geoms)
    maxy = max(g.bounds[3] for g in geoms)
    cos_lat = math.cos(math.radians((miny + maxy) / 2))
    sx = (W - 2 * PAD) / ((maxx - minx) * cos_lat)
    sy = (H - 2 * PAD) / (maxy - miny)
    s = min(sx, sy)

    def xy(lon: float, lat: float) -> tuple[float, float]:
        return (
            PAD + (lon - minx) * cos_lat * s,
            H - PAD - (lat - miny) * s,
        )

    return xy


def ring_pts(ring, xy) -> list[tuple[float, float]]:
    return [xy(lon, lat) for lon, lat in ring.coords]


def render(munis: dict[str, MultiPolygon]) -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    xy = projector(list(munis.values()))
    for target in sorted(munis):
        img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        dr = ImageDraw.Draw(img)
        for name, mp in munis.items():
            hi = name == target
            polys = (
                list(mp.geoms)
                if isinstance(mp, MultiPolygon)
                else [mp]
            )
            for poly in polys:
                dr.polygon(
                    ring_pts(poly.exterior, xy),
                    fill=FILL_HI if hi else FILL_BASE,
                    outline=EDGE_HI if hi else EDGE_BASE,
                )
                for hole in poly.interiors:
                    dr.polygon(
                        ring_pts(hole, xy),
                        fill=(0, 0, 0, 0),
                        outline=EDGE_HI if hi else EDGE_BASE,
                    )
        # Recorta al bounding box real de la isla (+colchón): el
        # lienzo fijo deja aire vertical que en la tarjeta de la app
        # se lee como espacio muerto a los lados
        bbox = img.getbbox()
        if bbox:
            x0, y0, x1, y1 = bbox
            img = img.crop(
                (
                    max(x0 - 6, 0),
                    max(y0 - 6, 0),
                    min(x1 + 6, W),
                    min(y1 + 6, H),
                )
            )
        img.save(os.path.join(OUT_DIR, f"{slug(target)}.png"))


def main() -> None:
    import sys

    munis = load(sys.argv[1] if len(sys.argv) > 1 else None)
    print(f"municipios: {len(munis)}")
    render(munis)
    print("slugs:")
    for name in sorted(munis):
        print(f"  {slug(name)}  <-  {name}")
    print(f"OK -> {OUT_DIR}")


if __name__ == "__main__":
    main()

# Descarga el estilo "positron" de OpenFreeMap y lo retine con la
# paleta oceanica de la app -> assets/mapstyle-sea.json
# Uso: python scripts/gen_mapstyle.py  (desde frontend/)
import json
import urllib.request

URL = "https://tiles.openfreemap.org/styles/positron"
OUT = "assets/mapstyle-sea.json"

SEA = "#5fc4d6"          # mar turquesa
SEA_DEEP = "#3fa8bf"     # vias de agua / acentos
SAND = "#f2ecdd"         # tierra arena
SAND_URBAN = "#ece1cc"   # zonas residenciales/edificios
GREEN_SAND = "#dfe6cd"   # parques/bosque suave
ROAD = "#d9cfbc"         # carreteras
ROAD_INNER = "#fffdf6"   # interior carreteras principales
BOUNDARY = "#a9b8bd"
LABEL = "#33505e"        # texto general
LABEL_SEA = "#1a7f96"    # texto sobre agua

req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
style = json.load(urllib.request.urlopen(req))
style["name"] = "CheckCoast Sea"

for layer in style["layers"]:
    lid = layer["id"]
    t = layer["type"]
    paint = layer.setdefault("paint", {})

    if t == "background":
        paint["background-color"] = SAND
    elif lid == "water":
        paint["fill-color"] = SEA
    elif lid in ("park",):
        paint["fill-color"] = GREEN_SAND
    elif lid.startswith("landcover"):
        paint["fill-color"] = GREEN_SAND
    elif lid in ("landuse_residential", "building", "road_area_pier",
                 "aeroway-area"):
        paint["fill-color"] = SAND_URBAN
    elif lid == "waterway":
        paint["line-color"] = SEA_DEEP
    elif lid.startswith("highway") or lid.startswith("road") \
            or lid.startswith("tunnel") or lid.startswith("railway"):
        cur = paint.get("line-color")
        if "casing" in lid or "subtle" in lid:
            paint["line-color"] = ROAD
        else:
            paint["line-color"] = ROAD_INNER
    elif lid.startswith("boundary"):
        paint["line-color"] = BOUNDARY
    elif t == "symbol":
        if "text-color" in paint or True:
            if lid.startswith("water"):
                paint["text-color"] = LABEL_SEA
            else:
                paint["text-color"] = LABEL
            paint["text-halo-color"] = "#ffffff"

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(style, f, separators=(",", ":"), ensure_ascii=False)

print(f"{OUT} escrito ({len(style['layers'])} capas)")

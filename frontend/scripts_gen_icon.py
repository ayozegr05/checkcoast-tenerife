# Genera icono + splash tematicos: silueta de Tenerife + olas blancas
# sobre degradado mar. La silueta sale del GeoJSON real de Nominatim/OSM.
# Uso: python scripts_gen_icon.py  (desde frontend/, con Pillow)
from PIL import Image, ImageDraw
import json
import math
import urllib.request

S = 1024
DEEP = (7, 82, 118)      # #075276 mar profundo
TURQ = (23, 184, 206)    # #17b8ce turquesa
WHITE = (255, 255, 255)
NAVY = (22, 50, 63)      # #16323f
RED = (224, 49, 49)      # paño de la sombrilla

NOMINATIM = (
    "https://nominatim.openstreetmap.org/search"
    "?q=Tenerife&format=geojson&polygon_geojson=1&limit=5"
)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(size):
    img = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        d.line([(0, y), (size, y)], fill=lerp(DEEP, TURQ, y / size))
    return img


def tenerife_ring():
    req = urllib.request.Request(
        NOMINATIM, headers={"User-Agent": "CheckCoast-dev/1.0"}
    )
    data = json.load(urllib.request.urlopen(req))
    feat = next(
        f for f in data["features"]
        if "Canarias" in (f.get("properties") or {}).get("display_name", "")
    )
    g = feat["geometry"]
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    ring = max(polys, key=lambda p: len(p[0]))[0]
    # corrige el estiramiento equirectangular: 1 deg lon = cos(lat) km
    k = math.cos(math.radians(28.3))
    return [(x * k, y) for x, y in ring]


def island_pts(ring, box):
    """Normaliza el anillo lon/lat a la caja (x0,y0,x1,y1) del lienzo."""
    xs = [c[0] for c in ring]
    ys = [c[1] for c in ring]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    w, h = (maxx - minx) or 1, (maxy - miny) or 1
    bx0, by0, bx1, by1 = box
    bw, bh = bx1 - bx0, by1 - by0
    s = min(bw / w, bh / h)
    ox = bx0 + (bw - w * s) / 2
    oy = by0 + (bh - h * s) / 2
    return [(ox + (x - minx) * s, oy + (maxy - y) * s) for x, y in ring]


def wave_poly(cx, cy, half_w, amp, wavelength, thickness):
    n = 120
    top = []
    for i in range(n + 1):
        x = cx - half_w + (2 * half_w * i / n)
        y = cy + amp * math.sin(
            2 * math.pi * (i / n) * (2 * half_w / wavelength)
        )
        top.append((x, y - thickness / 2))
    bottom = [(x, y + thickness) for x, y in reversed(top)]
    return top + bottom


def draw_faucet(d, pt, s):
    """Grifo blanco goteando, a la derecha de la isla, sobre las olas."""

    def rr(x0, y0, x1, y1, r):
        d.rounded_rectangle(
            [pt(x0, y0)[0], pt(x0, y0)[1], pt(x1, y1)[0], pt(x1, y1)[1]],
            radius=r * s, fill=WHITE)

    rr(576, 434, 736, 479, 18)   # tubo horizontal
    rr(566, 416, 599, 497, 11)   # brida de pared
    rr(625, 399, 652, 436, 10)   # tallo del mango
    rr(599, 370, 681, 398, 13)   # cruceta del mango
    rr(707, 468, 744, 534, 13)   # caño que baja
    rr(701, 526, 748, 545, 10)   # boca del caño
    for cx, cy, r in ((725, 594, 14), (725, 645, 9)):
        d.polygon([pt(cx - r, cy - r * 0.4), pt(cx + r, cy - r * 0.4),
                   pt(cx, cy - r * 2.4)], fill=WHITE)
        d.ellipse([pt(cx - r, cy - r)[0], pt(cx - r, cy - r)[1],
                   pt(cx + r, cy + r)[0], pt(cx + r, cy + r)[1]], fill=WHITE)


def draw_mark(size, ring, scale=1.0, faucet=False):
    """Marca blanca sobre transparente.

    Sin grifo: isla centrada flotando sobre las olas (icono/adaptativo).
    Con grifo: isla a la izquierda + grifo goteando sobre las olas (splash).
    """
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size / 1024 * scale
    off = (size - 1024 * s) / 2

    def pt(x, y):
        return (x * s + off, y * s + off)

    if faucet:
        box = (pt(140, 0)[0], pt(0, 170)[1], pt(700, 0)[0], pt(0, 620)[1])
        waves = (
            (pt(0, 700)[1], 340 * s, 26 * s, 34 * s, 210 * s),
            (pt(0, 790)[1], 260 * s, 20 * s, 26 * s, 175 * s),
        )
    else:
        box = (pt(150, 0)[0], pt(0, 140)[1], pt(874, 0)[0], pt(0, 600)[1])
        waves = (
            (pt(0, 640)[1], 340 * s, 26 * s, 34 * s, 210 * s),
            (pt(0, 730)[1], 260 * s, 20 * s, 26 * s, 175 * s),
        )
    d.polygon(island_pts(ring, box), fill=WHITE)
    if faucet:
        draw_faucet(d, pt, s)

    cx = pt(512, 0)[0]
    for cy, half_w, amp, th, wl in waves:
        d.polygon(wave_poly(cx, cy, half_w, amp, wl, th),
                  fill=WHITE + (235,))
    return img


# --- pins de playa: chincheta blanca + aro de estado + sombrilla ---
PIN_COLORS = {
    "open": (13, 148, 136),
    "warning": (230, 81, 0),
    "closed": (198, 40, 40),
    "unmonitored": (143, 163, 173),
}


def pin_shape(d, s, scale, color):
    c = s / 96

    def t(x, y):
        return (48 * c + (x - 48) * scale * c,
                48 * c + (y - 48) * scale * c)

    e = [t(10, 2), t(86, 78)]
    d.ellipse([e[0][0], e[0][1], e[1][0], e[1][1]], fill=color)
    d.polygon([t(26, 60), t(70, 60), t(48, 94)], fill=color)


def umbrella(img, cx, cy, r, canopy=RED):
    """Sombrilla de playa: paño + palo inclinado."""
    d = ImageDraw.Draw(img)
    d.pieslice([cx - r, cy - r, cx + r, cy + r], 180, 360, fill=canopy)
    # palo inclinado + gancho
    pw = max(2, int(r * 0.18))
    tip = (cx + int(r * 0.35), cy + int(r * 1.2))
    d.line([(cx, cy), tip], fill=NAVY, width=pw)
    d.arc([tip[0], tip[1] - r * 0.35, tip[0] + r * 0.45, tip[1] + r * 0.1],
          250, 430, fill=NAVY, width=pw)


def make_pin(name, status_color):
    s = 96
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pin_shape(d, s, 1.0, status_color)
    pin_shape(d, s, 0.78, WHITE)
    umbrella(img, 48, 36, 15, canopy=status_color)
    img.save(f"assets/icons/pin-{name}.png")


# --- pins de vertidos: misma chincheta + simbolo extraido de outfall.png ---
OUTFALL_COLORS = {
    "legal": (46, 125, 50),
    "illegal": (198, 40, 40),
    "processing": (249, 168, 37),
}


def outfall_symbol(size, color):
    """Extrae el glifo oscuro de outfall.png y lo tiñe de `color`."""
    src = Image.open("assets/icons/outfall.png").convert("RGBA")
    sym = Image.new("RGBA", src.size, (0, 0, 0, 0))
    px, sp = src.load(), sym.load()
    for y in range(src.size[1]):
        for x in range(src.size[0]):
            r, g, b, a = px[x, y]
            lum = (r + g + b) // 3
            if a and lum < 170:
                sp[x, y] = color + (min(255, (170 - lum) * 3),)
    return sym.resize((size, size), Image.LANCZOS)


def make_outfall_pin(name, status_color):
    s = 96
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pin_shape(d, s, 1.0, status_color)
    pin_shape(d, s, 0.78, WHITE)
    sym = outfall_symbol(30, status_color)
    img.alpha_composite(sym, (33, 21))
    img.save(f"assets/icons/pin-outfall-{name}.png")


# --- generar todo ---
ring = tenerife_ring()

icon = gradient(S).convert("RGBA")
icon.alpha_composite(draw_mark(S, ring))
icon.convert("RGB").save("assets/icon.png")

draw_mark(512, ring, scale=0.60).save("assets/android-icon-foreground.png")
gradient(512).save("assets/android-icon-background.png")
draw_mark(512, ring, scale=0.60).save("assets/android-icon-monochrome.png")
draw_mark(1024, ring, scale=0.55, faucet=True).save("assets/splash-icon.png")

icon.resize((64, 64), Image.LANCZOS).convert("RGB").save("assets/favicon.png")

W, H = 512, 128
grad = Image.new("RGB", (W, H))
gd = ImageDraw.Draw(grad)
for x in range(W):
    gd.line([(x, 0), (x, H)], fill=lerp(DEEP, TURQ, x / W))
grad.save("assets/gradient-sea.png")

for name, col in PIN_COLORS.items():
    make_pin(name, col)

for name, col in OUTFALL_COLORS.items():
    make_outfall_pin(name, col)

print("assets generados")

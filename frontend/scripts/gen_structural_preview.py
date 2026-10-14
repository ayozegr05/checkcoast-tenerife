# Preview comparativo: siluetas para cierre estructural.
# A ~25px de render solo leen FORMA+COLOR, no glifos internos.
# Genera scripts/out/structural-silhouettes.png + index.html
from PIL import Image, ImageDraw
import math

STRUCT = (140, 50, 42)
RED = (198, 40, 40)
WHITE = (255, 255, 255)
NAVY = (22, 50, 63)
SEA = (90, 178, 196)
SAND = (230, 215, 175)

SS = 4


def octagon(d, cx, cy, r, fill, outline=None, ow=0):
    pts = []
    for i in range(8):
        a = math.radians(22.5 + i * 45)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    d.polygon(pts, fill=fill, outline=outline)
    if outline and ow:
        for i in range(ow):
            d.polygon(pts, outline=outline)
    return pts


def beach_glyph(color, size):
    src = Image.open("assets/icons/beach.png").convert("RGBA")
    alpha = src.split()[3]
    tinted = Image.new("RGBA", src.size, color)
    tinted.putalpha(alpha)
    tinted.thumbnail((size, size), Image.LANCZOS)
    return tinted


def pin_shape(d, s, scale, color):
    c = s / 96

    def t(x, y):
        return (48 * c + (x - 48) * scale * c,
                48 * c + (y - 48) * scale * c)

    e = [t(10, 2), t(86, 78)]
    d.ellipse([e[0][0], e[0][1], e[1][0], e[1][1]], fill=color)
    d.polygon([t(26, 60), t(70, 60), t(48, 94)], fill=color)


def slash_mask(size, cx, cy, half_len, half_w, deg=45):
    m = Image.new("L", size, 0)
    dm = ImageDraw.Draw(m)
    a = math.radians(deg)
    dx, dy = math.cos(a), math.sin(a)
    px, py = -dy, dx
    dm.polygon([
        (cx - dx * half_len - px * half_w, cy - dy * half_len - py * half_w),
        (cx + dx * half_len - px * half_w, cy + dy * half_len - py * half_w),
        (cx + dx * half_len + px * half_w, cy + dy * half_len + py * half_w),
        (cx - dx * half_len + px * half_w, cy - dy * half_len + py * half_w),
    ], fill=255)
    return m


def rocks(d, cx, cy, rr):
    cliff = [
        (cx - rr * 0.95, cy + rr * 0.95),
        (cx - rr * 0.95, cy - rr * 0.60),
        (cx - rr * 0.55, cy - rr * 0.80),
        (cx - rr * 0.35, cy - rr * 0.15),
        (cx - rr * 0.05, cy + rr * 0.95),
    ]
    d.polygon(cliff, fill=NAVY)
    for pts in (
        [(0.20, -0.50), (0.55, -0.55), (0.62, -0.28), (0.40, -0.10), (0.15, -0.22)],
        [(0.62, 0.02), (0.92, 0.00), (0.95, 0.28), (0.68, 0.40)],
        [(0.30, 0.48), (0.58, 0.42), (0.62, 0.68), (0.35, 0.75)],
    ):
        d.polygon([(cx + x * rr, cy + y * rr) for x, y in pts], fill=NAVY)


def make_opt(shape, inner):
    """shape: 'octagon'|'pin'; inner: 'umbrella'|'rocks'|None"""
    img = Image.new("RGBA", (96 * SS, 96 * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy = 48 * SS, 48 * SS
    if shape == "octagon":
        # STOP: octogono con marco blanco — la silueta ya dice "cerrado"
        octagon(d, cx, cy, 42 * SS, WHITE)
        octagon(d, cx, cy, 40 * SS, STRUCT)
    else:
        pin_shape(d, W_SS, 1.0, STRUCT)
        pin_shape(d, W_SS, 0.78, WHITE)
    if inner == "umbrella":
        g = beach_glyph(WHITE if shape == "octagon" else STRUCT, 40 * SS)
        img.alpha_composite(g, (cx - g.width // 2, (cy if shape == "octagon" else 40 * SS) - g.height // 2))
    elif inner == "rocks":
        rr = (34 if shape == "octagon" else 19) * SS
        rocks(d, cx, cy if shape == "octagon" else 40 * SS, rr)
        if shape == "octagon":
            # aro rojo + barra sobre las rocas
            d.ellipse([cx - rr * 1.05, cy - rr * 1.05, cx + rr * 1.05, cy + rr * 1.05],
                      outline=RED, width=7 * SS)
            m = slash_mask(img.size, cx, cy, rr * 0.78, 5 * SS)
            img.paste(Image.new("RGBA", img.size, RED), (0, 0), m)
    return img.resize((96, 96), Image.LANCZOS)


W_SS = 96 * SS
opts = [
    ("A · octagono STOP + sombrilla", make_opt("octagon", "umbrella")),
    ("B · octagono STOP + rocas", make_opt("octagon", "rocks")),
    ("C · pin granate puro", make_opt("pin", "umbrella")),
]

# sheet: grande arriba, fila a tamano real (0.3x ~29px) sobre mar/arena
big_w = 130
sheet = Image.new("RGBA", (len(opts) * big_w + 20, big_w + 120), (245, 245, 245, 255))
x = 10
from PIL import ImageFont
try:
    font = ImageFont.truetype("arial.ttf", 13)
except Exception:
    font = ImageFont.load_default()
for label, im in opts:
    sheet.alpha_composite(im.resize((110, 110), Image.LANCZOS), (x + 10, 10))
    d = ImageDraw.Draw(sheet)
    d.text((x + 10, big_w + 4), label, fill=(30, 30, 30), font=font)
    # mini escena: mar arriba, arena abajo, pin a 0.3x
    sc = Image.new("RGBA", (110, 80), SEA + (255,))
    ImageDraw.Draw(sc).rectangle([0, 44, 110, 80], fill=SAND + (255,))
    small = im.resize((29, 29), Image.LANCZOS)
    sc.alpha_composite(small, (40, 38))
    sheet.alpha_composite(sc, (x + 10, big_w + 22))
    x += big_w
sheet.save("scripts/out/structural-silhouettes.png")
print("ok")

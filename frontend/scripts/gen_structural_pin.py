# Regenera assets/icons/pin-structural.png: pin granate + cartel
# circular de prohibido (aro rojo + barra) con rocas dentro — la causa
# sigue visible sin triangulo de aviso (que leia "aviso", no "cerrada").
# Uso: python scripts/gen_structural_pin.py  (desde frontend/, con Pillow)
from PIL import Image, ImageDraw
import math

STRUCT = (140, 50, 42)      # #8c322a granate
STRUCT_DARK = (104, 36, 30)
RED = (198, 40, 40)
WHITE = (255, 255, 255)
NAVY = (22, 50, 63)

SS = 4
W, H = 96, 154            # signo arriba + pin abajo (geometria actual)


def pin_shape(d, s, scale, color, oy):
    c = s / 96

    def t(x, y):
        return (48 * c + (x - 48) * scale * c,
                48 * c + (y - 48) * scale * c + oy)

    e = [t(10, 2), t(86, 78)]
    d.ellipse([e[0][0], e[0][1], e[1][0], e[1][1]], fill=color)
    d.polygon([t(26, 60), t(70, 60), t(48, 94)], fill=color)


def beach_glyph(color, size=42):
    src = Image.open("assets/icons/beach.png").convert("RGBA")
    alpha = src.split()[3]
    tinted = Image.new("RGBA", src.size, color)
    tinted.putalpha(alpha)
    tinted.thumbnail((size, size), Image.LANCZOS)
    return tinted


def slash_mask(size, cx, cy, half_len, half_w, deg=45):
    m = Image.new("L", size, 0)
    dm = ImageDraw.Draw(m)
    a = math.radians(deg)
    dx, dy = math.cos(a), math.sin(a)
    px, py = -dy, dx
    pts = [
        (cx - dx * half_len - px * half_w, cy - dy * half_len - py * half_w),
        (cx + dx * half_len - px * half_w, cy + dy * half_len - py * half_w),
        (cx + dx * half_len + px * half_w, cy + dy * half_len + py * half_w),
        (cx - dx * half_len + px * half_w, cy - dy * half_len + py * half_w),
    ]
    dm.polygon(pts, fill=255)
    return m


img = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# --- pin (parte baja) ---
PIN_OY = 58 * SS
pin_shape(d, W * SS, 1.0, STRUCT, PIN_OY)
pin_shape(d, W * SS, 0.78, WHITE, PIN_OY)
g = beach_glyph(STRUCT, 42 * SS)
img.alpha_composite(
    g, (48 * SS - g.width // 2, (34 * SS - g.height // 2) + PIN_OY))

# --- cartel circular de prohibido ---
cx, cy, r = 48 * SS, 27 * SS, 25 * SS
d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE)
d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=RED, width=7 * SS)

# glifo: arista de talud + rocas cayendo
rr = r * 0.62
d.line([(cx - rr, cy - rr * 0.5), (cx - rr * 0.30, cy - rr * 0.5),
        (cx - rr * 0.30, cy + rr * 0.95), (cx - rr, cy + rr * 0.95)],
       fill=NAVY, width=int(2.2 * SS))
for rx, ry, sz in ((0.18, -0.30, 0.20), (0.44, 0.10, 0.16),
                   (0.24, 0.55, 0.13)):
    px, py = cx + rx * rr, cy + ry * rr
    d.polygon([(px - sz * rr, py + sz * rr * 0.7),
               (px + sz * rr, py + sz * rr * 0.7),
               (px, py - sz * rr * 1.1)], fill=STRUCT_DARK)

# barra diagonal roja del prohibido (dentro del aro)
m = slash_mask(img.size, cx, cy, r * 0.72, 4.2 * SS)
img.paste(Image.new("RGBA", img.size, RED), (0, 0), m)

img = img.resize((W, H), Image.LANCZOS)
img.save("assets/icons/pin-structural.png")
print("pin-structural.png regenerado", img.size)

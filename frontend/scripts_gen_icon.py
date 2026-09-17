# Genera icono + splash tematicos: check + ola sobre degradado mar
# Uso: python scripts_gen_icon.py  (desde frontend/, con Pillow)
from PIL import Image, ImageDraw
import math

S = 1024
DEEP = (7, 82, 118)      # #075276 mar profundo
TURQ = (23, 184, 206)    # #17b8ce turquesa
WHITE = (255, 255, 255)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(size):
    img = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        d.line([(0, y), (size, y)], fill=lerp(DEEP, TURQ, y / size))
    return img


def thick_line(d, pts, width, color):
    """Polilinea gruesa con extremos redondeados (para el check)."""
    width = int(round(width))
    d.line(pts, fill=color, width=width, joint="curve")
    r = width // 2
    for p in (pts[0], pts[-1]):
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=color)


def wave_poly(cx, cy, half_w, amp, wavelength, thickness):
    """Banda que sigue una senoide: borde superior + inferior invertido."""
    n = 120
    top = []
    for i in range(n + 1):
        x = cx - half_w + (2 * half_w * i / n)
        y = cy + amp * math.sin(2 * math.pi * (i / n) * (2 * half_w / wavelength))
        top.append((x, y - thickness / 2))
    bottom = [(x, y + thickness) for x, y in reversed(top)]
    return top + bottom


def draw_mark(size, scale=1.0):
    """Check + olas blancos sobre transparente, centrados en `size`."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size / 1024 * scale
    off = (size - 1024 * s) / 2

    def pt(x, y):
        return (x * s + off, y * s + off)

    # Check: brazo corto + cresta larga hacia arriba-derecha
    thick_line(
        d, [pt(280, 530), pt(430, 680), pt(760, 320)], 82 * s, WHITE
    )

    # Dos olas debajo del check
    for cy, half_w, amp, th, wl in (
        (810, 290, 24, 30, 200),
        (890, 230, 18, 24, 170),
    ):
        d.polygon(
            wave_poly(
                pt(512, 0)[0], pt(0, cy)[1],
                half_w * s, amp * s, wl * s, th * s,
            ),
            fill=WHITE + (235,),
        )
    return img


# --- icon.png: gradiente + marca ---
icon = gradient(S).convert("RGBA")
icon.alpha_composite(draw_mark(S))
icon.convert("RGB").save("assets/icon.png")

# --- android adaptive ---
draw_mark(512, scale=0.60).save("assets/android-icon-foreground.png")
gradient(512).save("assets/android-icon-background.png")
draw_mark(512, scale=0.60).save("assets/android-icon-monochrome.png")

# --- splash: marca blanca sobre transparente ---
draw_mark(1024, scale=0.55).save("assets/splash-icon.png")

icon.resize((64, 64), Image.LANCZOS).convert("RGB").save("assets/favicon.png")

# --- gradiente horizontal mar -> turquesa para headers ---
W, H = 512, 128
grad = Image.new("RGB", (W, H))
gd = ImageDraw.Draw(grad)
for x in range(W):
    gd.line([(x, 0), (x, H)], fill=lerp(DEEP, TURQ, x / W))
grad.save("assets/gradient-sea.png")

print("assets generados")

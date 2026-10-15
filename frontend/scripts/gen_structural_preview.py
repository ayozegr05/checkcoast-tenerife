# Preview: pictogramas para cierre por contaminacion dentro del pin.
# A bacterias, B gota turbia, C nadador tachado, D ola peligro.
from PIL import Image, ImageDraw, ImageFont
import math

RED_C = (213, 0, 0)
WHITE = (255, 255, 255)
NAVY = (22, 50, 63)
GREEN_B = (70, 110, 40)
MURK = (140, 110, 60)
SEA = (90, 178, 196)
SAND = (230, 215, 175)

SS = 4


def pin_shape(d, s, scale, color):
    c = s / 96

    def t(x, y):
        return (48 * c + (x - 48) * scale * c,
                48 * c + (y - 48) * scale * c)

    e = [t(10, 2), t(86, 78)]
    d.ellipse([e[0][0], e[0][1], e[1][0], e[1][1]], fill=color)
    d.polygon([t(26, 60), t(70, 60), t(48, 94)], fill=color)


def bacteria(d, cx, cy, rr, col):
    """Bacilos: capsulas inclinadas con pili."""
    for bx, by, ang in ((-0.35, -0.35, -30), (0.35, -0.25, 40),
                        (-0.15, 0.35, 15), (0.45, 0.45, -60)):
        x, y = cx + bx * rr * 2, cy + by * rr * 2
        w, h = rr * 0.55, rr * 0.28
        a = math.radians(ang)
        ca, sa = math.cos(a), math.sin(a)

        def rot(px, py):
            return (x + px * ca - py * sa, y + px * sa + py * ca)

        # capsula: rectangulo redondeado rotado
        pts = []
        for i in range(16):
            t = 2 * math.pi * i / 16
            ex = (w / 2) * math.cos(t)
            ey = (h / 2) * math.sin(t)
            pts.append(rot(ex, ey))
        d.polygon(pts, fill=col)
        # nucleo
        nc = [rot(w * 0.08 * math.cos(2 * math.pi * i / 10),
                  h * 0.35 * math.sin(2 * math.pi * i / 10)) for i in range(10)]
        d.polygon(nc, fill=WHITE)


def drop(d, cx, cy, rr):
    """Gota de agua turbia."""
    d.polygon([(cx, cy - rr), (cx + rr * 0.75, cy + rr * 0.3),
               (cx, cy + rr * 0.9), (cx - rr * 0.75, cy + rr * 0.3)],
              fill=MURK)
    d.ellipse([cx - rr * 0.75, cy - rr * 0.1, cx + rr * 0.75, cy + rr * 0.9],
              fill=MURK)
    d.ellipse([cx - rr * 0.3, cy + rr * 0.15, cx - rr * 0.05, cy + rr * 0.5],
              fill=(100, 75, 40))


def swimmer_ban(d, cx, cy, rr):
    """Nadador + aro y barra de prohibido."""
    # nadador: circulo cabeza + brazo en arco + linea de agua
    d.ellipse([cx - rr * 0.55, cy - rr * 0.75, cx - rr * 0.2, cy - rr * 0.4],
              fill=NAVY)
    d.line([(cx - rr * 0.4, cy - rr * 0.1), (cx + rr * 0.3, cy - rr * 0.35)],
           fill=NAVY, width=int(rr * 0.22))
    d.line([(cx - rr * 0.4, cy - rr * 0.1), (cx + rr * 0.6, cy)],
           fill=NAVY, width=int(rr * 0.22))
    for i, wy in enumerate((0.25, 0.55)):
        pts = [(cx - rr + i * 4, cy + wy * rr)]
        for k in range(1, 9):
            pts.append((cx - rr + k * rr * 0.25, cy + wy * rr + (rr * 0.12 if k % 2 else 0)))
        d.line(pts, fill=(46, 125, 160), width=int(rr * 0.14))
    # aro + barra roja
    d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=RED_C,
              width=int(rr * 0.22))
    d.line([(cx - rr * 0.68, cy - rr * 0.68), (cx + rr * 0.68, cy + rr * 0.68)],
           fill=RED_C, width=int(rr * 0.22))


def wave_danger(d, cx, cy, rr):
    """Ola turbia + triangulo de alerta."""
    for i, wy in enumerate((-0.1, 0.25, 0.6)):
        pts = [(cx - rr, cy + wy * rr)]
        for k in range(1, 9):
            pts.append((cx - rr + k * rr * 0.25,
                        cy + wy * rr + (rr * 0.14 if k % 2 else -rr * 0.02)))
        d.line(pts, fill=MURK, width=int(rr * 0.18))
    d.polygon([(cx + rr * 0.25, cy - rr * 0.8), (cx + rr * 0.95, cy - rr * 0.05),
               (cx - rr * 0.15, cy - rr * 0.05)], fill=(249, 168, 37),
              outline=NAVY)
    d.line([(cx + rr * 0.4, cy - rr * 0.55), (cx + rr * 0.4, cy - rr * 0.28)],
           fill=NAVY, width=int(rr * 0.12))
    d.ellipse([cx + rr * 0.34, cy - rr * 0.2, cx + rr * 0.46, cy - rr * 0.1],
              fill=NAVY)


def make_pin(draw_fn):
    img = Image.new("RGBA", (96 * SS, 96 * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pin_shape(d, 96 * SS, 1.0, RED_C)
    pin_shape(d, 96 * SS, 0.78, WHITE)
    draw_fn(d, 48 * SS, 34 * SS, 22 * SS)
    return img.resize((96, 96), Image.LANCZOS)


def scene(pin, px):
    sc = Image.new("RGBA", (150, 90), SEA + (255,))
    ImageDraw.Draw(sc).rectangle([0, 50, 150, 90], fill=SAND + (255,))
    small = pin.resize((px, px), Image.LANCZOS)
    sc.alpha_composite(small, (75 - px // 2, 45 - px))
    return sc


opts = [
    ("A bacterias", make_pin(lambda d, x, y, r: bacteria(d, x, y, r, GREEN_B))),
    ("B gota turbia", make_pin(drop)),
    ("C nadador prohibido", make_pin(swimmer_ban)),
    ("D ola peligro", make_pin(wave_danger)),
    ("Ref - sombrilla", Image.open("assets/icons/pin-closed.png").convert("RGBA")),
]

pad = 16
big = 110
W = pad + len(opts) * (big + pad)
H = pad + big + 34 + 3 * 90 + 10
sheet = Image.new("RGBA", (W, H), (245, 245, 245, 255))
df = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("arial.ttf", 13)
except Exception:
    font = ImageFont.load_default()

for i, (label, pin) in enumerate(opts):
    x = pad + i * (big + pad)
    sheet.alpha_composite(pin.resize((big, big), Image.LANCZOS), (x, pad))
    df.text((x, pad + big + 4), label, fill=(20, 20, 20), font=font)
    y = pad + big + 34
    for zl, px in (("19", 19), ("33", 33), ("35", 35)):
        sheet.alpha_composite(scene(pin, px), (x, y))
        y += 90

sheet.save("scripts/out/structural-silhouettes.png")
print("ok")

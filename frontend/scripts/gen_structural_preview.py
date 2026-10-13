# Preview de CONCEPTOS (no solo disenos de pin) para cierres
# estructurales: zona rayada, etiqueta de causa, banda costera,
# atenuacion. Uso: python scripts/gen_structural_preview.py
from PIL import Image, ImageDraw, ImageFont
import math
import os

SS = 3
STRUCT = (140, 50, 42)
STRUCT_DARK = (104, 36, 30)
STRUCT_A = (140, 50, 42, 110)
RED = (198, 40, 40)
WHITE = (255, 255, 255)
NAVY = (22, 50, 63)
SAND = (238, 230, 208)
SEA = (23, 184, 206)
ROAD = (255, 255, 255)

try:
    F_NAME = ImageFont.truetype("DejaVuSans-Bold.ttf", 20)
    F_DESC = ImageFont.truetype("DejaVuSans.ttf", 14)
    F_LBL = ImageFont.truetype("DejaVuSans-Bold.ttf", 12 * SS)
    F_BEACH = ImageFont.truetype("DejaVuSans-Bold.ttf", 13 * SS)
except OSError:
    F_NAME = F_DESC = F_LBL = F_BEACH = ImageFont.load_default()


def pin_shape(d, s, scale, color):
    c = s / 96

    def t(x, y):
        return (48 * c + (x - 48) * scale * c,
                48 * c + (y - 48) * scale * c)

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


def base_pin(color=STRUCT, s=96):
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pin_shape(d, s, 1.0, color)
    pin_shape(d, s, 0.78, WHITE)
    g = beach_glyph(color, int(42 * s / 96))
    img.alpha_composite(
        g, (s // 2 - g.width // 2, int(34 * s / 96) - g.height // 2))
    return img


PIN_G = base_pin(STRUCT)
PIN_R = base_pin(RED)


def coast_pts(w, h):
    """Polilinea de costa: mar a la izquierda, arena a la derecha."""
    pts = [(int(80 * SS + 26 * SS * math.sin(y / (44 * SS))), y)
           for y in range(-20, h + 20, 8)]
    return pts


def map_scene(w, h, draw_fn):
    img = Image.new("RGB", (w, h), SAND)
    d = ImageDraw.Draw(img)
    sea = [(0, -20), *coast_pts(w, h), (0, h + 20)]
    d.polygon(sea, fill=SEA)
    d.line([(w * 0.62, 0), (w * 0.74, h)], fill=ROAD, width=4 * SS)
    draw_fn(img, d)
    return img


def paste_pin(scene, pin, x, y, w):
    p = pin.resize((w, w), Image.LANCZOS)
    scene.paste(p, (int(x - w / 2), int(y - w)), p)


def label(scene, x, y, text, color=NAVY, font=F_BEACH):
    d = ImageDraw.Draw(scene)
    b = d.textbbox((0, 0), text, font=font)
    d.text((x - (b[2] - b[0]) / 2, y), text, font=font, fill=color,
           stroke_width=2 * SS, stroke_fill=WHITE)


def hatch_disc(scene, cx, cy, rx, ry):
    """Ovalo rayado en diagonal (convencion de zona restringida)."""
    lay = Image.new("RGBA", scene.size, (0, 0, 0, 0))
    dl = ImageDraw.Draw(lay)
    dl.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=STRUCT_A)
    mask = Image.new("L", scene.size, 0)
    ImageDraw.Draw(mask).ellipse(
        [cx - rx, cy - ry, cx + rx, cy + ry], fill=255)
    stripes = Image.new("RGBA", scene.size, (0, 0, 0, 0))
    ds = ImageDraw.Draw(stripes)
    for i in range(-20, 21):
        x0 = cx + i * 11 * SS
        ds.line([(x0 - 60 * SS, cy + 90 * SS), (x0 + 60 * SS, cy - 90 * SS)],
                fill=(140, 50, 42, 200), width=3 * SS)
    lay.paste(stripes, (0, 0), Image.composite(
        stripes.split()[3], Image.new("L", scene.size, 0), mask))
    dl.ellipse([cx - rx, cy - ry, cx + rx, cy + ry],
               outline=(140, 50, 42, 230), width=2 * SS)
    scene.paste(lay, (0, 0), lay)


def scene_actual(img, d):
    W, H = img.size
    pin = Image.open("assets/icons/pin-structural.png").convert("RGBA")
    paste_pin(img, pin, int(95 * SS), int(110 * SS), 46 * SS)
    label(img, 95 * SS, 116 * SS, "Playa")


def scene_zona(img, d):
    W, H = img.size
    hatch_disc(img, 92 * SS, 96 * SS, 52 * SS, 62 * SS)
    paste_pin(img, PIN_G, 95 * SS, 100 * SS, 40 * SS)
    label(img, 95 * SS, 106 * SS, "Playa")


def scene_etiqueta(img, d):
    W, H = img.size
    paste_pin(img, PIN_G, 95 * SS, 96 * SS, 46 * SS)
    label(img, 95 * SS, 102 * SS, "Playa")
    label(img, 95 * SS, 102 * SS + 17 * SS, "Desprendimientos",
          color=STRUCT, font=F_LBL)


def scene_banda(img, d):
    W, H = img.size
    pts = coast_pts(W, H)
    # tramo de costa clausurado junto a la playa
    seg = [p for p in pts if 55 * SS <= p[1] <= 165 * SS]
    d.line(seg, fill=STRUCT, width=7 * SS)
    d.line(seg, fill=WHITE, width=2 * SS)
    paste_pin(img, PIN_G, 118 * SS, 112 * SS, 40 * SS)
    label(img, 118 * SS, 118 * SS, "Playa")


def scene_atenuado(img, d):
    W, H = img.size
    # cerrada por contaminacion (viva, roja, late) al lado
    paste_pin(img, PIN_R, 120 * SS, 60 * SS, 42 * SS)
    label(img, 120 * SS, 66 * SS, "Otra playa")
    # estructural: mas pequeno y apagado — no compite
    dim = PIN_G.resize((34 * SS, 34 * SS), Image.LANCZOS)
    a = dim.split()[3].point(lambda x: x * 0.62)
    dim.putalpha(a)
    img.paste(dim, (int(92 * SS - 17 * SS), int(120 * SS - 34 * SS)), dim)
    label(img, 92 * SS, 126 * SS, "Playa")


def scene_combo(img, d):
    W, H = img.size
    hatch_disc(img, 92 * SS, 96 * SS, 52 * SS, 62 * SS)
    paste_pin(img, PIN_G, 95 * SS, 100 * SS, 38 * SS)
    label(img, 95 * SS, 104 * SS, "Playa")
    label(img, 95 * SS, 104 * SS + 16 * SS, "Desprendimientos",
          color=STRUCT, font=F_LBL)


def triangle_sign(size):
    """Cartel triangular de desprendimientos standalone."""
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.polygon([(s / 2, s * 0.05), (s * 0.96, s * 0.88), (s * 0.04, s * 0.88)],
              fill=RED)
    d.polygon([(s / 2, s * 0.20), (s * 0.83, s * 0.82), (s * 0.17, s * 0.82)],
              fill=WHITE)
    # arista + rocas
    d.line([(s * 0.34, s * 0.42), (s * 0.50, s * 0.42), (s * 0.50, s * 0.78)],
           fill=NAVY, width=int(s * 0.035))
    for rx, ry, rr in ((0.60, 0.50, 0.05), (0.70, 0.62, 0.04), (0.58, 0.72, 0.035)):
        cx, cy = s * rx, s * ry
        d.polygon([(cx - rr * s, cy + rr * s), (cx + rr * s, cy + rr * s),
                   (cx, cy - rr * s)], fill=STRUCT_DARK)
    return img.resize((size, size), Image.LANCZOS)


def scene_zona_actual_flotante(img, d):
    """Zona rayada + pin actual con cartel flotando."""
    W, H = img.size
    hatch_disc(img, 92 * SS, 96 * SS, 52 * SS, 62 * SS)
    pin = Image.open("assets/icons/pin-structural.png").convert("RGBA")
    paste_pin(img, pin, 95 * SS, 100 * SS, 46 * SS)
    label(img, 95 * SS, 106 * SS, "Playa")


def scene_zona_actual_pegado(img, d):
    """Zona rayada + cartel pegado al pin (un solo objeto)."""
    W, H = img.size
    hatch_disc(img, 92 * SS, 100 * SS, 52 * SS, 62 * SS)
    paste_pin(img, PIN_G, 95 * SS, 104 * SS, 42 * SS)
    tri = triangle_sign(20 * SS)
    img.paste(tri, (int(95 * SS - 10 * SS), int(104 * SS - 42 * SS - 16 * SS)),
              tri)
    label(img, 95 * SS, 110 * SS, "Playa")


def scene_zona_sin_pin(img, d):
    """Solo la zona rayada + cartel centrado, sin chincheta."""
    W, H = img.size
    hatch_disc(img, 92 * SS, 96 * SS, 52 * SS, 62 * SS)
    tri = triangle_sign(34 * SS)
    img.paste(tri, (int(92 * SS - 17 * SS), int(96 * SS - 17 * SS)), tri)
    label(img, 92 * SS, 132 * SS, "Playa")


SC_W, SC_H = 200 * SS, 230 * SS
concepts = [
    ("1 · zona rayada", "solo el area clausurada", scene_zona),
    ("Actual", "cartel + pin,\nsin zona", scene_actual),
    ("Zona + cartel flotante", "la zona da contexto\nal cartel", scene_zona_actual_flotante),
    ("Zona + cartel pegado", "cartel sobre el pin,\nun solo objeto", scene_zona_actual_pegado),
    ("Zona + solo cartel", "sin chincheta: la zona\ny la senal bastan", scene_zona_sin_pin),
]

COLS = len(concepts)
MARGIN = 24
COLW = 220
SC_DISP_W, SC_DISP_H = 200, 230

W = MARGIN * 2 + COLS * COLW
H = MARGIN + SC_DISP_H + 90 + MARGIN

sheet = Image.new("RGB", (W, H), (245, 245, 245))
sd = ImageDraw.Draw(sheet)


def text_center(x, y, s, f, fill=NAVY):
    b = sd.textbbox((0, 0), s, font=f)
    sd.text((x - (b[2] - b[0]) / 2, y), s, font=f, fill=fill)


for i, (name, desc, fn) in enumerate(concepts):
    x0 = MARGIN + i * COLW
    scene = map_scene(SC_W, SC_H, fn).resize(
        (SC_DISP_W, SC_DISP_H), Image.LANCZOS)
    sheet.paste(scene, (x0 + (COLW - SC_DISP_W) // 2, MARGIN))
    text_center(x0 + COLW // 2, MARGIN + SC_DISP_H + 8, name, F_NAME)
    for j, line in enumerate(desc.split("\n")):
        text_center(x0 + COLW // 2, MARGIN + SC_DISP_H + 34 + j * 16,
                    line, F_DESC, fill=(90, 90, 90))

os.makedirs("scripts/out", exist_ok=True)
out = "scripts/out/pin-structural-preview.png"
sheet.save(out)
print("escrito", out)

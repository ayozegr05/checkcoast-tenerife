# Preview: pin granate con la ilustracion real (recorte de la captura
# de ChatGPT, "A - Roca") dentro del disco blanco. El arte se recorta
# en circulo al disco; el pin queda granate como el actual.
from PIL import Image, ImageDraw, ImageFont

STRUCT = (140, 50, 42)
WHITE = (255, 255, 255)
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


def make_pin_art():
    img = Image.new("RGBA", (96 * SS, 96 * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pin_shape(d, 96 * SS, 1.0, STRUCT)
    pin_shape(d, 96 * SS, 0.78, WHITE)
    art = Image.open("scripts/out/rocks_A_art.png").convert("RGBA")
    # cubrir el disco blanco: el disco mide ~60px*SS -> el arte a ~46px*SS
    disc_r = int(30 * 0.78 * SS)  # aprox radio interior disco
    side = disc_r * 2
    # crop centrado del arte (es 125x102, cuadrado centrado)
    w, h = art.size
    m = min(w, h)
    art_sq = art.crop(((w - m) // 2, (h - m) // 2, (w + m) // 2, (h + m) // 2))
    art_sq = art_sq.resize((side, side), Image.LANCZOS)
    mask = Image.new("L", (side, side), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, side, side], fill=255)
    cx, cy = 48 * SS, 34 * SS
    img.paste(art_sq, (cx - side // 2, cy - side // 2), mask)
    return img.resize((96, 96), Image.LANCZOS)


def scene(pin, px):
    sc = Image.new("RGBA", (150, 90), SEA + (255,))
    ImageDraw.Draw(sc).rectangle([0, 50, 150, 90], fill=SAND + (255,))
    small = pin.resize((px, px), Image.LANCZOS)
    sc.alpha_composite(small, (75 - px // 2, 45 - px))
    return sc


pin_art = make_pin_art()
pin_art.save("scripts/out/pin-structural-art.png")

opts = [
    ("Pin + ilustracion real", pin_art),
    ("Actual - sombrilla", Image.open("assets/icons/pin-closed.png").convert("RGBA")),
]

pad = 20
big = 120
W = pad + len(opts) * (big + pad)
H = pad + big + 34 + 3 * 90 + 10
sheet = Image.new("RGBA", (W, H), (245, 245, 245, 255))
df = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("arial.ttf", 14)
except Exception:
    font = ImageFont.load_default()

for i, (label, pin) in enumerate(opts):
    x = pad + i * (big + pad)
    sheet.alpha_composite(pin.resize((big, big), Image.LANCZOS), (x, pad))
    df.text((x, pad + big + 4), label, fill=(20, 20, 20), font=font)
    y = pad + big + 34
    for zl, px in (("19px", 19), ("33px", 33), ("35px", 35)):
        sheet.alpha_composite(scene(pin, px), (x, y))
        y += 90

sheet.save("scripts/out/structural-silhouettes.png")
print("ok")

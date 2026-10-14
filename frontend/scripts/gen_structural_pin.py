# Regenera assets/icons/pin-structural.png: pin granate #8c322a con la
# misma geometria y glifo que el resto de pines (96x96). Replica
# make_pin de gen_icon.py a pelo (sin supersample: produce un trazado
# ligeramente distinto). La diferencia es solo el color — a tamano de
# mapa ningun glifo extra se lee, y el "cierre estructural" lo explican
# banner/leyenda/ficha. El halo fijo de CoastMap marca la zona cronica.
# Uso: python scripts/gen_structural_pin.py  (desde frontend/, con Pillow)
from PIL import Image, ImageDraw

STRUCT = (140, 50, 42)      # #8c322a granate
WHITE = (255, 255, 255)


def pin_shape(d, s, scale, color):
    c = s / 96

    def t(x, y):
        return (48 * c + (x - 48) * scale * c,
                48 * c + (y - 48) * scale * c)

    e = [t(10, 2), t(86, 78)]
    d.ellipse([e[0][0], e[0][1], e[1][0], e[1][1]], fill=color)
    d.polygon([t(26, 60), t(70, 60), t(48, 94)], fill=color)


def beach_glyph(color, size=40):
    src = Image.open("assets/icons/beach.png").convert("RGBA")
    alpha = src.split()[3]
    tinted = Image.new("RGBA", src.size, color)
    tinted.putalpha(alpha)
    tinted.thumbnail((size, size), Image.LANCZOS)
    return tinted


s = 96
img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
pin_shape(d, s, 1.0, STRUCT)
pin_shape(d, s, 0.78, WHITE)
glyph = beach_glyph(STRUCT, 42)
img.alpha_composite(glyph, (48 - glyph.width // 2, 34 - glyph.height // 2))
img.save("assets/icons/pin-structural.png")
print("pin-structural.png regenerado", img.size)

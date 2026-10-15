# Regenera assets/icons/pin-structural.png: pin granate #8c322a con la
# ilustracion de rocas cayendo (assets/icons/rockfall-art.png) dentro
# del disco blanco, recortada en circulo. Misma geometria 96x96 que el
# resto de pines; la diferenciacion = color + pictograma + halo fijo
# (CoastMap). El arte procede de una ilustracion generada con LLM —
# reproducible: cualquier imagen cuadrada sirve como fuente.
# Uso: python scripts/gen_structural_pin.py  (desde frontend/, con Pillow)
from PIL import Image, ImageDraw

STRUCT = (140, 50, 42)      # #8c322a granate
WHITE = (255, 255, 255)

SS = 4


def pin_shape(d, s, scale, color):
    c = s / 96

    def t(x, y):
        return (48 * c + (x - 48) * scale * c,
                48 * c + (y - 48) * scale * c)

    e = [t(10, 2), t(86, 78)]
    d.ellipse([e[0][0], e[0][1], e[1][0], e[1][1]], fill=color)
    d.polygon([t(26, 60), t(70, 60), t(48, 94)], fill=color)


img = Image.new("RGBA", (96 * SS, 96 * SS), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
pin_shape(d, 96 * SS, 1.0, STRUCT)
pin_shape(d, 96 * SS, 0.78, WHITE)

# ilustracion recortada en circulo dentro del disco blanco —
# sobredimensionada ~25% para llenar el disco (las esquinas se pierden
# en la mascara circular, no importa)
art = Image.open("assets/icons/rockfall-art.png").convert("RGBA")
side = int(30 * 0.78 * SS) * 2
art_side = int(side * 1.2)
w, h = art.size
m = min(w, h)
art_sq = art.crop(((w - m) // 2, (h - m) // 2, (w + m) // 2, (h + m) // 2))
art_sq = art_sq.resize((art_side, art_side), Image.LANCZOS)
mask = Image.new("L", (art_side, art_side), 0)
ImageDraw.Draw(mask).ellipse([0, 0, art_side, art_side], fill=255)
cx, cy = 48 * SS, 34 * SS
# desplazada abajo-izq: el talud del dibujo cae a ese lado
img.paste(art_sq, (cx - art_side // 2 - int(2 * SS), cy - art_side // 2 + int(3 * SS)), mask)

img = img.resize((96, 96), Image.LANCZOS)
img.save("assets/icons/pin-structural.png")
print("pin-structural.png regenerado", img.size)

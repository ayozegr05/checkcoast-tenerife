# Regenera assets/icons/pin-closed.png: pin rojo #c62828 (cierre por
# contaminacion) con la ilustracion de un emisario vertiendo agua
# turbia (assets/icons/contam-art.png) dentro del disco blanco,
# recortada en circulo. Misma geometria 96x96 que el resto de pines.
# El arte procede de una ilustracion generada con LLM — reproducible:
# cualquier imagen apaisada sirve como fuente.
# Uso: python scripts/gen_contam_pin.py  (desde frontend/, con Pillow)
from PIL import Image, ImageDraw

RED_C = (198, 40, 40)       # #c62828
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
pin_shape(d, 96 * SS, 1.0, RED_C)
pin_shape(d, 96 * SS, 0.78, WHITE)

# ilustracion recortada en circulo dentro del disco blanco — el eje
# vertical llena el disco; el ancho se comprime para que la ventana
# circular vea ~35% mas de la foto a cada lado (mas lodo visible)
art = Image.open("assets/icons/contam-art.png").convert("RGBA")
side = int(30 * 0.78 * SS) * 2
h_art = side
w_art = int(side * 1.35)
art_r = art.resize((w_art, h_art), Image.LANCZOS)
mask = Image.new("L", (w_art, h_art), 0)
ImageDraw.Draw(mask).ellipse(
    [(w_art - side) // 2, (h_art - side) // 2,
     (w_art + side) // 2, (h_art + side) // 2], fill=255)
cx, cy = 48 * SS, 34 * SS
img.paste(art_r, (cx - w_art // 2, cy - h_art // 2), mask)

img = img.resize((96, 96), Image.LANCZOS)
img.save("assets/icons/pin-closed.png")
print("pin-closed.png regenerado", img.size)

# Regenera assets/icons/pin-closed.png: pin rojo de contaminacion con
# badge circular flotante arriba que lleva la ilustracion del emisario
# vertiendo (assets/icons/contam-art.png). Canvas 96x136: pin normal
# abajo (misma caja que el resto) + badge con aro propio arriba.
# Uso: python scripts/gen_contam_pin.py  (desde frontend/, con Pillow)
from PIL import Image, ImageDraw

RED_C = (213, 0, 0)         # #d50000 — rojo puro, casa con theme.status.closed
WHITE = (255, 255, 255)

SS = 4
BADGE_D = 46                # diametro del badge en px de salida
H = 136                     # alto del canvas: 96 pin + 40 badge
BADGE_Y = 1                 # margen superior del badge


def tint_pin(color):
    """pin-open.png teñido: todo lo no-blanco/no-transparente pasa al
    color de estado (aro, punta y sombrilla)."""
    pin = Image.open("assets/icons/pin-open.png").convert("RGBA")
    pin = pin.resize((96 * SS, 96 * SS), Image.LANCZOS)
    px = pin.load()
    for x in range(96 * SS):
        for y in range(96 * SS):
            r, g, b, a = px[x, y]
            if a > 0 and not (r > 240 and g > 240 and b > 240):
                if not (r > 200 and g > 200):
                    px[x, y] = (*color, a)
    return pin


img = Image.new("RGBA", (96 * SS, H * SS), (0, 0, 0, 0))
img.alpha_composite(tint_pin(RED_C), (0, H * SS - 96 * SS))

# badge circular con la ilustracion, aro blanco + aro del color del pin
bd = BADGE_D * SS
art = Image.open("assets/icons/contam-art.png").convert("RGBA")
aw, ah = art.size
m = min(aw, ah)
art = art.crop(((aw - m) // 2, (ah - m) // 2, (aw + m) // 2, (ah + m) // 2))
art = art.resize((bd, bd), Image.LANCZOS)
mask = Image.new("L", (bd, bd), 0)
ImageDraw.Draw(mask).ellipse([0, 0, bd, bd], fill=255)

bx, by = (96 * SS - bd) // 2, BADGE_Y * SS
ring = Image.new("RGBA", (bd + 10 * SS, bd + 10 * SS), (0, 0, 0, 0))
rd = ImageDraw.Draw(ring)
rd.ellipse([0, 0, bd + 10 * SS, bd + 10 * SS], fill=WHITE)
rd.ellipse([3 * SS, 3 * SS, bd + 7 * SS, bd + 7 * SS], fill=RED_C)
img.alpha_composite(ring, (bx - 5 * SS, by - 5 * SS))
img.paste(art, (bx, by), mask)

img = img.resize((96, H), Image.LANCZOS)
img.save("assets/icons/pin-closed.png")
print("pin-closed.png regenerado", img.size)

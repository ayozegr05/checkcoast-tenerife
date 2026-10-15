# Regenera assets/icons/pin-closed.png: pin rojo (cierre por
# contaminacion) con la ilustracion de un emisario vertiendo agua
# turbia — el pin viene YA DIBUJADO en assets/icons/contam-pin-art.png
# (RGBA con fondo transparente); solo hay que escalarlo a 96x96
# manteniendo el disco al mismo tamano que el resto de pines.
# Uso: python scripts/gen_contam_pin.py  (desde frontend/, con Pillow)
from PIL import Image

SS = 4

art = Image.open("assets/icons/contam-pin-art.png").convert("RGBA")
aw, ah = art.size

# El disco del arte ocupa ~el 76% superior; en los demas pines el
# disco es ~79% de los 96px -> escala el arte para que coincida
target_h = int(96 * SS * 0.79 / 0.76)
target_w = int(aw * target_h / ah)
art_r = art.resize((target_w, target_h), Image.LANCZOS)

img = Image.new("RGBA", (96 * SS, 96 * SS), (0, 0, 0, 0))
img.paste(art_r, ((96 * SS - target_w) // 2, 0), art_r)
img = img.resize((96, 96), Image.LANCZOS)
img.save("assets/icons/pin-closed.png")
print("pin-closed.png regenerado", img.size)

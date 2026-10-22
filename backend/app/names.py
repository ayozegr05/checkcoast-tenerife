"""Normalización de nombres de playa compartida entre la app y la
ingesta (antes vivía en scripts/ingest_osm_beaches, lo que obligaba a
app/ a depender de scripts/)."""

import re
import unicodedata

# Sufijo de punto de muestreo del censo Náyade ("PM1", "PM4") —
# una playa extensa tiene varios PMs. Única regex del sufijo:
# los consumidores que agrupan por playa física la comparten
PM_SUFFIX = re.compile(r"\s+PM\d+$", re.IGNORECASE)


def pm_label(name: str) -> str | None:
    """'PLAYA JARDIN PM4' → 'PM4'; None si no es punto de muestreo."""
    m = re.search(r"PM(\d+)\s*$", name, re.IGNORECASE)
    return f"PM{m.group(1)}" if m else None


def normalize_text(name: str) -> str:
    """Mayúsculas, sin acentos, espacios colapsados — conserva el
    sufijo PM. Base de `normalize_beach_name`; también sirve para
    texto libre (observaciones, evaluaciones, municipios)."""
    s = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip().upper()


def normalize_beach_name(name: str) -> str:
    """`normalize_text` + sin sufijo PM — las oficiales acaban en
    PM1, PM4... Agrupa los PMs de una misma playa física."""
    return PM_SUFFIX.sub("", normalize_text(name))


# Calas del mismo arenal con nombre propio en el censo: MITECO
# bautizó cada punto ("MEDANO-CHICA", "MEDANO-LEOCADIO MACHADO")
# aunque comparten el mismo arenal — agrupan como zonas de la raíz.
# Curado, NO una regla por guion: "VALLESECO- EL BLOQUE" es playa
# aparte aunque comparta raíz con Valleseco
ARENAL_BASES: dict[str, str] = {
    "PLAYA MEDANO (EL)-CHICA": "PLAYA MEDANO (EL)",
    "PLAYA MEDANO (EL)-LEOCADIO MACHADO": "PLAYA MEDANO (EL)",
}


def arenal_base(name: str) -> str:
    """Base del complejo multi-punto: sin sufijo PM y con las calas
    del mismo arenal fusionadas a su raíz (`ARENAL_BASES`)."""
    core = normalize_beach_name(name)
    return ARENAL_BASES.get(core, core)


def zone_tag(name: str) -> str | None:
    """Token que distingue al punto dentro de su complejo: el sufijo
    de nombre propio si lo tiene ("CHICA"), si no la etiqueta PM
    ("PM4"). Dos calas pueden compartir número de PM — Chica y
    Leocadio Machado son ambas PM1 — el número solo no basta."""
    core = normalize_beach_name(name)
    base = ARENAL_BASES.get(core, core)
    suffix = core[len(base) :].lstrip(" -") if core.startswith(base) else ""
    return suffix or pm_label(name)

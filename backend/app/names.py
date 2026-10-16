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

"""Alias de calas/zonas dentro de complejos multi-PM.

Los bandos municipales y la prensa nombran calas ("Playa Grande
centro", "Charcón derecha") mientras el censo Náyade solo conoce PMs
("PLAYA JARDIN PM4"). Este mapa curado relaciona cada alias con su PM
y permite acotar una noticia casada a todo el complejo: si el titular,
el nombre extraído o el cuerpo nombran una cala, el ítem se asigna solo
a su PM; si ningún texto nombra zona, se devuelven todos los PMs
(conservador: para el bañista un falso negativo es el riesgo real).

El mapa es curado — la correspondencia cala↔PM se infiere por
geografía y por la evidencia oficial acumulada (el cierre de agosto
2026 de "Punta Brava" cayó en la incidencia oficial de PM4). Solo se
aplica dentro del complejo ya casado: "Playa Grande" existe como playa
censal en otros municipios, pero aquí solo compite contra sus PMs
hermanos.

Claves: (nombre base normalizado sin sufijo PM, municipio normalizado).
Los alias van normalizados igual que `_normalize` (mayúsculas, sin
acentos) y se buscan con límites de palabra.
"""

import re

from app.models import Beach
from app.news_matching import _MIN_NAME_LEN, _name_in_title, _norm_muni
from scripts.ingest_osm_beaches import _normalize

# aliases: inequívocos, valen en titular/extracted Y en cuerpo.
# weak_aliases: topónimos que el cuerpo suele citar como contexto — el
# barrio, el emisario, el castillo ("...el emisario de Punta Brava",
# "una playa chica") — solo cuentan en titular/extracted, donde su
# rol referencial es claro; en cuerpo producirían falsos positivos
_ZONE_GROUPS: dict[tuple[str, str], dict[str, dict]] = {
    # Playa Jardín (Puerto de la Cruz) — complejo de 3 calas, este→oeste
    ("PLAYA JARDIN", "PUERTO DE LA CRUZ"): {
        "PM1": {
            "name": "El Castillo",
            "aliases": ("PLAYA DEL CASTILLO",),
            "weak_aliases": ("SAN FELIPE", "EL CASTILLO"),
        },
        "PM5": {
            "name": "El Charcón",
            "aliases": ("CHARCON",),
            "weak_aliases": ("PLAYA CHICA",),
        },
        "PM4": {
            "name": "Punta Brava",
            "aliases": ("PLAYA GRANDE", "MARIA JIMENEZ"),
            "weak_aliases": ("PUNTA BRAVA",),
        },
    },
}

_PM_SUFFIX = re.compile(r"\s+PM(\d+)\s*$")


def _pm_label(beach: Beach) -> str | None:
    m = _PM_SUFFIX.search(beach.name)
    return f"PM{m.group(1)}" if m else None


def _zone_map(hits: list[Beach]) -> dict[str, Beach] | None:
    """{PM_label: beach} si los hits son ≥2 PMs de un mismo complejo
    con alias de zona configurados; si no, None."""
    if len(hits) < 2:
        return None
    bases = {
        (_normalize(_PM_SUFFIX.sub("", b.name)), _norm_muni(b.municipality))
        for b in hits
    }
    if len(bases) != 1:
        return None
    zones = _ZONE_GROUPS.get(next(iter(bases)))
    if not zones:
        return None
    out = {label: b for b in hits if (label := _pm_label(b)) in zones}
    return out if len(out) >= 2 else None


def narrow_hits_by_zone(
    hits: list[Beach], *texts: str | None, body: str | None = None
) -> list[Beach]:
    """Restringe los hits a los PMs cuya cala aparece en los textos.

    `texts` (titular, extracted_beach…) buscan alias fuertes y débiles;
    `body` solo los fuertes — en el cuerpo los topónimos contextuales
    (el barrio, el emisario de Punta Brava) serían falsos positivos.
    Sin mención de zona devuelve los hits intactos — el fallback
    conservador es "todo el complejo"."""
    zones = _zone_map(hits)
    if zones is None:
        return hits
    base = next(
        iter(
            {
                (
                    _normalize(_PM_SUFFIX.sub("", b.name)),
                    _norm_muni(b.municipality),
                )
                for b in hits
            }
        )
    )
    wanted: set[str] = set()
    for text in texts:
        t = _normalize(text or "")
        if not t:
            continue
        for label in zones:
            z = _ZONE_GROUPS[base][label]
            for alias in (*z["aliases"], *z.get("weak_aliases", ())):
                if len(alias) >= _MIN_NAME_LEN and _name_in_title(alias, t):
                    wanted.add(label)
    t = _normalize(body or "")
    if t:
        for label in zones:
            for alias in _ZONE_GROUPS[base][label]["aliases"]:
                if len(alias) >= _MIN_NAME_LEN and _name_in_title(alias, t):
                    wanted.add(label)
    if not wanted:
        return hits
    return [b for label, b in zones.items() if label in wanted]


def zone_display_name(beach: Beach) -> str | None:
    """Nombre común de la cala para la UI ("Punta Brava" en vez de
    "zona 4"); None si el PM no pertenece a un complejo mapeado."""
    label = _pm_label(beach)
    if label is None:
        return None
    key = (
        _normalize(_PM_SUFFIX.sub("", beach.name)),
        _norm_muni(beach.municipality),
    )
    zone = _ZONE_GROUPS.get(key, {}).get(label)
    return zone["name"] if zone else None

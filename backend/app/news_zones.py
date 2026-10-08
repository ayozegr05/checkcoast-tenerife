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
    # Valleseco (Santa Cruz): Los Charcos (PM1) y El Bloque (PM1),
    # dos tramos del mismo litoral con nombre base distinto
    ("PLAYA VALLESECO", "SANTA CRUZ DE TENERIFE"): {
        "PM1": {
            "name": "Los Charcos",
            "aliases": ("LOS CHARCOS", "CHARCOS DE VALLESECO"),
            "weak_aliases": (),
        },
    },
    ("PLAYA VALLESECO- EL BLOQUE", "SANTA CRUZ DE TENERIFE"): {
        "PM1": {
            "name": "El Bloque",
            "aliases": ("EL BLOQUE",),
            "weak_aliases": (),
        },
    },
}

# Playas hermanas del mismo litoral con nombre base distinto: forman
# un complejo de zonas aunque el base no coincida
_ZONE_COMPLEXES: dict[str, list[frozenset[str]]] = {
    "SANTA CRUZ DE TENERIFE": [
        frozenset({"PLAYA VALLESECO", "PLAYA VALLESECO- EL BLOQUE"}),
    ],
}

_PM_SUFFIX = re.compile(r"\s+PM(\d+)\s*$")


def _pm_label(beach: Beach) -> str | None:
    m = _PM_SUFFIX.search(beach.name)
    return f"PM{m.group(1)}" if m else None


def _zone_entry(beach: Beach) -> dict | None:
    """Entrada de zona del PM en su complejo; None si la playa no
    está en un complejo mapeado."""
    label = _pm_label(beach)
    if label is None:
        return None
    zones = _ZONE_GROUPS.get(
        (
            _normalize(_PM_SUFFIX.sub("", beach.name)),
            _norm_muni(beach.municipality),
        )
    )
    return zones.get(label) if zones else None


def _complex_key(beach: Beach) -> tuple[str, frozenset[str]]:
    """(municipio, {bases hermanas}) del complejo del PM. Las calas
    hermanas con nombre base distinto se agrupan vía _ZONE_COMPLEXES
    (Valleseco ↔ Valleseco-El Bloque)."""
    base = _normalize(_PM_SUFFIX.sub("", beach.name))
    muni = _norm_muni(beach.municipality)
    for group in _ZONE_COMPLEXES.get(muni, ()):
        if base in group:
            return (muni, group)
    return (muni, frozenset({base}))


def narrow_hits_by_zone(
    hits: list[Beach],
    *texts: str | None,
    body: str | None = None,
    all_beaches: list[Beach] | None = None,
) -> list[Beach]:
    """Restringe los hits a los PMs cuya cala aparece en los textos.

    `texts` (titular, extracted_beach…) buscan alias fuertes y débiles;
    `body` solo los fuertes — en el cuerpo los topónimos contextuales
    (el barrio, el emisario de Punta Brava) serían falsos positivos.
    Sin mención de zona devuelve los hits intactos — el fallback
    conservador es "todo el complejo".

    Con `all_beaches` las calas hermanas del complejo compiten aunque
    no estén en hits: si el texto nombra la cala real con un alias
    fuerte ("El Bloque") y la extracción casó la playa hermana
    ("Valleseco"), la noticia se asigna a la cala nombrada. Los hits
    de otros complejos o sin zona mapeada se conservan."""
    zones = {b.id: _zone_entry(b) for b in hits}
    zones = {i: z for i, z in zones.items() if z is not None}
    if not zones:
        return hits
    unmapped = [b for b in hits if b.id not in zones]
    by_complex: dict[tuple[str, frozenset[str]], list[Beach]] = {}
    for b in hits:
        if b.id in zones:
            by_complex.setdefault(_complex_key(b), []).append(b)
    out = list(unmapped)
    for (muni, bases), comp_hits in by_complex.items():
        members = list(comp_hits)
        seen = {b.id for b in members}
        if all_beaches is not None:
            for b in all_beaches:
                if (
                    b.id not in seen
                    and _norm_muni(b.municipality) == muni
                    and _normalize(_PM_SUFFIX.sub("", b.name)) in bases
                    and _zone_entry(b)
                ):
                    members.append(b)
                    seen.add(b.id)
        if len(members) < 2:
            out.extend(comp_hits)
            continue
        hit_ids = {b.id for b in comp_hits}
        wanted: set[int] = set()
        for text in texts:
            t = _normalize(text or "")
            if not t:
                continue
            for b in members:
                zone = _zone_entry(b)
                # una cala fuera de hits solo entra por alias fuerte:
                # una mención contextual no debe mover la noticia
                aliases = (
                    (*zone["aliases"], *zone.get("weak_aliases", ()))
                    if b.id in hit_ids
                    else zone["aliases"]
                )
                if any(
                    len(a) >= _MIN_NAME_LEN and _name_in_title(a, t)
                    for a in aliases
                ):
                    wanted.add(b.id)
        t = _normalize(body or "")
        if t:
            for b in members:
                if any(
                    len(a) >= _MIN_NAME_LEN and _name_in_title(a, t)
                    for a in _zone_entry(b)["aliases"]
                ):
                    wanted.add(b.id)
        out.extend(
            (b for b in members if b.id in wanted) if wanted else comp_hits
        )
    return out


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

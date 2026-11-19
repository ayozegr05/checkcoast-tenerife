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

from app.models import Beach
from app.names import arenal_base
from app.names import normalize_beach_name as _normalize
from app.names import zone_tag as _tag_of
from app.news_matching import _MIN_NAME_LEN, _name_in_title, _norm_muni


def _drop_shadowed[T](matches: list[tuple[T, str]]) -> set[T]:
    """Claves cuyo alias casado no es sub-alias de otro hit.

    El alias más largo gana: "CHARCON DERECHA" (PM1) y "CHARCON"
    (PM5) casan a la vez en el texto "Charcón derecha" — la mención
    específica decide y la genérica no replica en la cala vecina."""
    hit_aliases = {a for _, a in matches}
    return {
        key
        for key, a in matches
        if not any(a != other and a in other for other in hit_aliases)
    }


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
            # "Charcón derecha" es la ubicación oficial Náyade del
            # punto (la poza junto al castillo); un bando que cita el
            # nombre sanitario no debe caer en PM5 por "Charcón"
            "aliases": ("PLAYA DEL CASTILLO", "CHARCON DERECHA"),
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
    # Valleseco (Santa Cruz): Playa Valleseco (PM1) y El Bloque (PM1),
    # dos tramos del mismo litoral con nombre base distinto. Los
    # Charcos es punto propio del censo desde nov-2026 — sus alias
    # viven en press_aliases de esa playa, no aquí
    ("PLAYA VALLESECO", "SANTA CRUZ DE TENERIFE"): {
        "PM1": {
            "name": "Playa Valleseco",
            "aliases": (),
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
    # El Cabezo–Paseo de las Palmeras (Güímar): PM1 es el extremo de la
    # playa canina; PM4 es el tramo principal junto al muelle del
    # Puertito. "Playa de El Cabezo" NO es alias de PM4: en prensa es
    # el nombre del complejo entero — como alias fijaría cada titular
    # genérico en una sola zona. "Los Perros" sí es topónimo inequívoco
    ("PLAYA CABEZO (EL)-PASEO DE LAS PALMERAS", "GUIMAR"): {
        "PM1": {
            "name": "Playa de los Perros",
            "ref": "playa de los Perros",
            "aliases": ("PLAYA DE LOS PERROS", "PLAYA PARA PERROS"),
            "weak_aliases": (),
        },
        "PM4": {
            "name": "Playa de El Cabezo",
            "ref": "playa de El Cabezo",
            "aliases": (),
            "weak_aliases": (),
        },
    },
    # Las Teresitas (Santa Cruz): accesos numerados 0-11 de San Andrés
    # (acceso 1, donde para la guagua 910) hacia el dique. Los cierres
    # parciales se anuncian por acceso ("a la altura del acceso
    # número 8"), no por cala. Correspondencia acceso↔PM verificada
    # in situ: acceso 8 = tramo de PM2. El resto de PMs no tiene
    # acceso conocido — nombre neutro de zona, sin topónimo inventado
    ("PLAYA TERESITAS (LAS)", "SANTA CRUZ DE TENERIFE"): {
        "PM1": {
            "name": "Zona 1",
            "aliases": (),
            "weak_aliases": (),
        },
        "PM2": {
            "name": "Acceso 8",
            "ref": "acceso 8",
            "aliases": (
                "ACCESO 8",
                "ACCESO N O 8",
                "ACCESO OCHO",
                "ACCESO NUMERO 8",
                "ACCESO NUMERO OCHO",
            ),
            "weak_aliases": (),
        },
        "PM3": {
            "name": "Zona 3",
            "aliases": (),
            "weak_aliases": (),
        },
        "PM4": {
            "name": "Zona 4",
            "aliases": (),
            "weak_aliases": (),
        },
    },
    # El Médano (Granadilla): tres puntos del mismo arenal con nombre
    # propio en el censo — se indexan por sufijo porque Chica y
    # Leocadio Machado comparten la etiqueta PM1
    ("PLAYA MEDANO (EL)", "GRANADILLA DE ABONA"): {
        "PM3": {
            "name": "playa central",
            "ref": "playa central",
            "aliases": ("PLAYA CENTRAL",),
            "weak_aliases": (),
        },
        "CHICA": {
            "name": "Playa Chica",
            "ref": "playa Chica",
            # "playa chica" a secas es adjetivo en cuerpo ("una playa
            # chica de la zona") — solo inequívoca en titular
            "aliases": ("PLAYA CHICA DE EL MEDANO", "MEDANO CHICA"),
            "weak_aliases": ("PLAYA CHICA",),
        },
        "LEOCADIO MACHADO": {
            "name": "Leocadio Machado",
            "ref": "playa de Leocadio Machado",
            "aliases": ("LEOCADIO MACHADO",),
            "weak_aliases": (),
        },
    },
    # Bajamar (La Laguna): el arenal del Castillo/San Juan y las
    # piscinas naturales son zonas de baño distintas del mismo
    # núcleo. La prensa dice "la playa de Bajamar" para el arenal —
    # el 10-jul-2020 el bando cerró "la playa" y "el resto de las
    # zonas de baño" (las pozas) siguió abierto — y "las piscinas
    # (naturales) de Bajamar" para las pozas. "Bajamar" a secas no
    # nombra zona: réplica a todas (conservador)
    ("PLAYA CASTILLO-BAJAMAR (SAN JUAN)", "SAN CRISTOBAL DE LA LAGUNA"): {
        "PM1": {
            "name": "Playa de Bajamar",
            "ref": "playa de Bajamar",
            "aliases": ("PLAYA DE BAJAMAR", "PLAYA DEL CASTILLO"),
            "weak_aliases": (),
        },
    },
    ("PLAYA PISCINAS NATURALES DE BAJAMAR", "SAN CRISTOBAL DE LA LAGUNA"): {
        "PM1": {
            "name": "Piscinas naturales",
            "ref": "piscinas naturales",
            "aliases": (
                "PISCINAS NATURALES DE BAJAMAR",
                "PISCINAS DE BAJAMAR",
                "PISCINA NATURAL DE BAJAMAR",
            ),
            "weak_aliases": (),
        },
        "PM2": {
            "name": "Piscinas naturales",
            "ref": "piscinas naturales",
            "aliases": (
                "PISCINAS NATURALES DE BAJAMAR",
                "PISCINAS DE BAJAMAR",
                "PISCINA NATURAL DE BAJAMAR",
            ),
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
    # Bajamar: el arenal (Castillo-Bajamar) y las piscinas naturales
    # compiten como zonas del mismo núcleo aunque el base difiera
    "SAN CRISTOBAL DE LA LAGUNA": [
        frozenset(
            {
                "PLAYA CASTILLO-BAJAMAR (SAN JUAN)",
                "PLAYA PISCINAS NATURALES DE BAJAMAR",
            }
        ),
    ],
}


def _zone_entry(beach: Beach) -> dict | None:
    """Entrada de zona del punto en su complejo; None si la playa no
    está en un complejo mapeado. La sub-clave es el token distintivo
    (`zone_tag`): sufijo de nombre propio o etiqueta PM."""
    tag = _tag_of(beach.name)
    if tag is None:
        return None
    zones = _ZONE_GROUPS.get(
        (arenal_base(beach.name), _norm_muni(beach.municipality) or "")
    )
    return zones.get(tag) if zones else None


def _complex_key(beach: Beach) -> tuple[str, frozenset[str]]:
    """(municipio, {bases hermanas}) del complejo del punto. Las calas
    hermanas con nombre base distinto se agrupan vía _ZONE_COMPLEXES
    (Valleseco ↔ Valleseco-El Bloque); las del mismo arenal ya
    comparten raíz por `arenal_base` (las tres del Médano)."""
    base = arenal_base(beach.name)
    muni = _norm_muni(beach.municipality) or ""
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
                    and arenal_base(b.name) in bases
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
            matches: list[tuple[int, str]] = []
            for b in members:
                zone = _zone_entry(b)
                if zone is None:
                    continue
                # una cala fuera de hits solo entra por alias fuerte:
                # una mención contextual no debe mover la noticia
                aliases = (
                    (*zone["aliases"], *zone.get("weak_aliases", ()))
                    if b.id in hit_ids
                    else zone["aliases"]
                )
                matches.extend(
                    (b.id, a)
                    for a in aliases
                    if len(a) >= _MIN_NAME_LEN and _name_in_title(a, t)
                )
            wanted |= _drop_shadowed(matches)
        # El cuerpo solo aporta zonas cuando el titular/extracted no
        # nombró ninguna: si la extracción ya dice la cala afectada
        # ("Playa Grande"), las zonas de episodios pasados citadas
        # como historia en el cuerpo no deben colarse como hits.
        if not wanted:
            t = _normalize(body or "")
            if t:
                matches = [
                    (b.id, a)
                    for b in members
                    if (zone := _zone_entry(b)) is not None
                    for a in zone["aliases"]
                    if len(a) >= _MIN_NAME_LEN and _name_in_title(a, t)
                ]
                wanted = _drop_shadowed(matches)
        out.extend(
            (b for b in members if b.id in wanted) if wanted else comp_hits
        )
    return out


def named_zones(titles: list, base: str, municipality: str | None) -> set[str]:
    """Etiquetas PM de las calas del complejo que los títulos nombran.

    Sirve para saber QUÉ zona cubre un episodio fusionado: una pieza
    que dice "la cala Punta Brava sigue cerrada" marca PM4 aunque la
    noticia también haya acabado replicada en otros PMs. Alias fuertes
    y débiles cuentan — el campo ya es titular, el contexto seguro."""
    zones = _ZONE_GROUPS.get(
        (_normalize(base), _norm_muni(municipality) or "")
    )
    if not zones:
        return set()
    out: set[str] = set()
    for t in titles:
        nt = _normalize(t or "")
        if not nt:
            continue
        matches = [
            (pm, a)
            for pm, z in zones.items()
            for a in (*z["aliases"], *z.get("weak_aliases", ()))
            if len(a) >= _MIN_NAME_LEN and _name_in_title(a, nt)
        ]
        out |= _drop_shadowed(matches)
    return out


def zone_display_name(beach: Beach) -> str | None:
    """Nombre común de la cala para la UI ("Punta Brava" en vez de
    "zona 4"); None si el punto no pertenece a un complejo mapeado."""
    tag = _tag_of(beach.name)
    if tag is None:
        return None
    key = (arenal_base(beach.name), _norm_muni(beach.municipality) or "")
    zone = _ZONE_GROUPS.get(key, {}).get(tag)
    return zone["name"] if zone else None

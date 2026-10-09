"""Matching conservador artículo↔playa (Hito 8.5).

Reutiliza `_normalize` de la ingesta OSM (sin acentos, mayúsculas, sin
sufijo PM) y añade una clave de comparación `_press_key` que además:

- quita el prefijo genérico "PLAYA (DE/DEL/DE LA/DE LOS/DE LAS)"
- desinvierte el artículo del censo MITECO: "CABEZO (EL)" → "EL CABEZO",
  "TERESITAS (LAS)" → "LAS TERESITAS"

Un candidato es cualquier playa cuya clave sea igual al nombre extraído
o lo contenga en cualquier dirección ("EL CABEZO" ⊂ "EL CABEZO-PASEO DE
LAS PALMERAS"). La playa aporta una clave por su nombre del censo y una
por cada `press_alias` — nombres populares que usa la prensa ("Los
Guanches" para Candelaria).

- Un match exacto de clave gana a las contenciones del mismo
  municipio: "El Médano" es playa censal propia aunque existan
  "El Médano-Chica"/"-Leocadio Machado" (la prensa nombra las
  sub-playas cuando las quiere). Si la hermana está en OTRO
  municipio ("El Cabezo", "La Arena"), la ambigüedad se mantiene.
- Con municipio extraído: casa si todas las candidatas de ese
  municipio comparten clave — varios PMs de una misma playa
  ("CABEZO (EL)-PASEO DE LAS PALMERAS PM1/PM4") cuentan como una y
  la noticia se sirve en cada ficha.
- Titulares multi-playa ("El Médano y El Socorro cierran"): cada
  clave candidata casa si aparece literal en el titular y no es
  homónima entre municipios. Además el titular se escanea contra
  TODAS las claves (nombre + alias), no solo las candidatas del
  nombre extraído — el LLM a veces devuelve solo una playa o un
  nombre popular ("Playa Grande en Playa Jardín") y el otro nombre
  real está literal en el titular.
- Si las candidatas del nombre extraído son todas la misma playa
  base en un municipio (alias distintos del mismo complejo, p. ej.
  "Playa Grande y Charcón" → PM4+PM5 de Playa Jardín), casan todas.
- Sin municipio: casa solo si el grupo final comparte clave y
  municipio — la contención sin municipio y los nombres repetidos
  entre zonas se rechazan.

Ante la duda devuelve []: una noticia sin casar no se muestra.
"""

import re
from dataclasses import replace

from app.models import Beach
from app.news_llm import EventExtraction
from scripts.ingest_osm_beaches import _normalize

# Grafías que usa la prensa → municipio oficial (límites OSM en BD)
MUNICIPALITY_ALIASES = {
    "LA LAGUNA": "SAN CRISTOBAL DE LA LAGUNA",
    "GRANADILLA": "GRANADILLA DE ABONA",
}

# Los 31 municipios de Tenerife, normalizados: el municipio que extrae
# el LLM solo cuenta si es uno de ellos. "Tenerife", barrios como
# "Valleseco" o cualquier invento se ignoran y se resuelve por
# nombre/titular — mejor ambiguo que vetado. Un municipio REAL pero
# contradictorio con la playa casada sigue vetando (puede ser un lugar
# homónimo que no es la playa).
_ISLAND_MUNICIPALITIES = frozenset(
    _normalize(m)
    for m in (
        "Adeje",
        "Arafo",
        "Arico",
        "Arona",
        "Buenavista del Norte",
        "Candelaria",
        "Fasnia",
        "Garachico",
        "Granadilla de Abona",
        "La Guancha",
        "Guía de Isora",
        "Güímar",
        "Icod de los Vinos",
        "La Matanza de Acentejo",
        "La Orotava",
        "Puerto de la Cruz",
        "Los Realejos",
        "El Rosario",
        "San Cristóbal de La Laguna",
        "San Juan de la Rambla",
        "San Miguel de Abona",
        "Santa Cruz de Tenerife",
        "Santa Úrsula",
        "Santiago del Teide",
        "El Sauzal",
        "Los Silos",
        "Tacoronte",
        "El Tanque",
        "Tegueste",
        "La Victoria de Acentejo",
        "Vilaflor de Chasna",
    )
)

_MIN_NAME_LEN = 5
# Primera palabra de un municipio que NO sirve para nombrarlo en un
# titular ("EL Tanque", "SANTA Cruz…", "PUERTO de la Cruz")
_GENERIC_MUNI_WORD = {
    "EL",
    "LA",
    "LOS",
    "LAS",
    "SAN",
    "SANTA",
    "PUERTO",
    "DE",
    "DEL",
}

# El "D " final solo vale si va seguido de espacio ("PLAYA D X"):
# "D\s*" sin espacio se comía la D inicial del nombre
# ("PLAYA DUQUE" → "UQUE", "PLAYA DIEGO HERNANDEZ" → "IEGO…")
_GENERIC_PREFIX = re.compile(
    r"^PLAYA\s+(DE\s+(LA|LOS|LAS)\s+|DEL\s+|DE\s+|D\s+)?|^PLAYA\s*"
)
_PAREN_ARTICLE = re.compile(r"\s*\((EL|LA|LAS|LOS)\)")
# Paréntesis que NO es el artículo invertido del censo ("(playa
# chica)", "(San Juan)"): la variante sin él casa el nombre popular
# de la prensa ("La Viuda" ↔ "Playa de la Viuda (playa chica)")
_PAREN_NOISE = re.compile(r"\s*\((?!EL|LA|LAS|LOS\))[^)]*\)")
# Preposición interior que la prensa añade o quita: "Punta del
# Hidalgo" ↔ "… PISCINA NATURAL PUNTA HIDALGO"
_INNER_PREP = re.compile(r"\s+(?:DE\s+LA|DE\s+LOS|DE\s+LAS|DEL|DE)\s+")
# Prefijo de instalación que la prensa omite al nombrar el lugar:
# "PISCINAS NATURALES DE BAJAMAR" → "BAJAMAR", "PISCINA NATURAL DE
# JOVER" → "JOVER". En claves compuestas se aplica a la cola tras
# " - " ("EL ARENISCO - PISCINA NATURAL PUNTA HIDALGO" → "PUNTA
# HIDALGO")
_FACILITY_PREFIX = re.compile(
    r"^PISCINAS?\s+NATURAL(?:ES)?\s+(?:DE\s+|DEL\s+)?"
)
# Artículo inicial del nombre censal: la prensa lo omite a menudo
# ("playa del Bollullo" ↔ "PLAYA BOLLULLO (EL)") — el match por clave
# exacta tolera su ausencia
_LEADING_ARTICLE = re.compile(r"^(?:EL|LA|LOS|LAS)\s+")
_HYPHEN = re.compile(r"\s*-\s*")


def _key_variants(name: str) -> list[str]:
    """Claves alternativas de un mismo nombre: con y sin paréntesis
    no-artículo, sin preposiciones interiores y sin el prefijo de
    instalación ("PISCINA NATURAL …") del censo."""
    keys = []
    for n in (name, _PAREN_NOISE.sub("", name)):
        for key in (
            _press_key(n),
            _INNER_PREP.sub(" ", _press_key(n)),
        ):
            variants = {key}
            # Cola tras guion como clave propia: el censo compone
            # "COMPLEJO - CALA" ("VALLESECO- EL BLOQUE", "CABEZO
            # (EL)-PASEO DE LAS PALMERAS") y la prensa nombra la cala
            # sola — se toleran guion con/sin espacios
            tail = _HYPHEN.split(key)[-1]
            short = _FACILITY_PREFIX.sub("", tail)
            if short and short != key:
                variants.add(short)
            for k in variants:
                if k and k not in keys:
                    keys.append(k)
    return keys


def _beach_keys(b: Beach) -> list[str]:
    """Todas las claves que aporta una playa: nombre del censo y
    aliases de prensa, cada uno con sus variantes."""
    keys = []
    for n in [b.name, *(getattr(b, "press_aliases", None) or [])]:
        for k in _key_variants(n):
            if k not in keys:
                keys.append(k)
    return keys


def _press_key(name: str) -> str:
    """Clave comparable playa↔titular: normaliza el censo invertido
    ("CABEZO (EL)" → "EL CABEZO") y el prefijo "PLAYA DE…"."""
    s = _normalize(name)
    s = _GENERIC_PREFIX.sub("", s, count=1)
    m = _PAREN_ARTICLE.search(s)
    if m:
        s = f"{m.group(1)} {_PAREN_ARTICLE.sub('', s)}"
    return re.sub(r"\s+", " ", s).strip(" -")


def _norm_muni(name: str | None) -> str | None:
    if not name:
        return None
    n = _normalize(name)
    return MUNICIPALITY_ALIASES.get(n, n)


# Accidente geográfico que NO es playa encabezando un nombre propio:
# "Barranco de Masca" habla del sendero, no de "Playa de Masca" — la
# contención "MASCA" ⊂ "BARRANCO DE MASCA" no vale ni en extracción ni
# en titular. Los match exactos siguen sirviendo ("Playa del Barranco
# de Erques" SÍ es playa y su clave incluye el BARRANCO)
_NON_BEACH_FEATURE = re.compile(
    r"^(?:BARRANCO|CAMINO|SENDERO|SENDA|MIRADOR|PARQUE)\s+"
    r"(?:DEL\s+|DE\s+(?:LA\s+|LOS\s+|LAS\s+)?|DE\s+)"
)
# Misma idea mirando hacia atrás desde la ocurrencia de la clave en el
# titular: "DE MASCA" tras BARRANCO/CAMINO/… (pero no tras "PLAYA DEL
# BARRANCO DE…", que sí nombra una playa)
_FEATURE_BEFORE = re.compile(
    r"(?:^|\s)(PLAYA\s+(?:DEL\s+|DE\s+(?:LA\s+|LOS\s+|LAS\s+)?|DE\s+)?)?"
    r"(?:BARRANCO|CAMINO|SENDERO|SENDA|MIRADOR|PARQUE)\s+"
    r"(?:DEL\s+|DE\s+(?:LA\s+|LOS\s+|LAS\s+)?|DE\s+)$"
)

# La clave aparece literal pero NO nombra la playa: es el nombre del
# municipio/ayuntamiento ("en el municipio tinerfeño de Candelaria") o
# el color de la bandera ("con bandera amarilla" ≠ Playa Amarilla).
# Solo cuenta si tras el sustantivo vienen conectores hasta la clave
_SPURIOUS_BEFORE = re.compile(
    r"(?:MUNICIPIOS?|AYUNTAMIENTO|VILLA|PUEBLO|BANDERA)"
    r"(?:\s+(?:DE|DEL|LA|EL|LOS|LAS|EN|AL|A|PARA|POR|CON|"
    r"TINERFEN[AO]S?|CANARI[OA]S?|SITUAD[AO]S?|UBICAD[AO]S?))*\s*$"
)


def _name_in_title(key: str, title_norm: str) -> bool:
    """La clave aparece como nombre literal en el titular (límites de
    palabra: "LA ARENA" no casa dentro de "ARENITA"; y no cuenta dentro
    de un accidente no-playa — "Barranco de Masca" ≠ "Playa de Masca" —
    ni nombrando el municipio/ayuntamiento ni como color de bandera).
    Entre palabras de la clave el titular puede añadir la preposición
    ("PUNTA HIDALGO" casa "Punta del Hidalgo") — se tolera sobre el
    titular ORIGINAL: deprepsionarlo perdería el "DE" que delata los
    contextos vetados ("BARRANCO DE", "MUNICIPIO DE")."""
    flex = r"(?:\s+(?:DE\s+LA|DE\s+LOS|DE\s+LAS|DEL|DE)\s+|\s+)".join(
        re.escape(w) for w in key.split() if w not in {"DE", "DEL"}
    )
    for m in re.finditer(rf"(?<![A-Z0-9]){flex}(?![A-Z0-9])", title_norm):
        before = title_norm[: m.start()]
        if _SPURIOUS_BEFORE.search(before):
            continue
        feat = _FEATURE_BEFORE.search(before)
        if not feat or feat.group(1):
            return True
    return False


def _multi_beach_hits(
    cands: list[tuple[Beach, str]],
    title_norm: str,
    title_map: dict[str, list[Beach]],
) -> list[Beach]:
    """Titulares con varias playas ("El Médano y El Socorro cierran"):
    cada clave distinta casa si aparece literal en el titular y sus
    candidatas están en un solo municipio. Claves que se contienen
    nombran el mismo topónimo ("ROQUE" ⊂ "EL ROQUE") y si cruzan
    municipios decide el contexto: los municipios de las demás playas
    nombradas en el titular."""
    keys = {k for _, k in cands}
    if len(keys) <= 1:
        return []
    hits: dict[str, list[Beach]] = {}
    for k in keys:
        members = [(b, kk) for b, kk in cands if kk == k]
        if len(
            {_norm_muni(b.municipality) for b, _ in members}
        ) == 1 and _name_in_title(k, title_norm):
            hits[k] = [b for b, _ in members]
    out: list[Beach] = []
    for g in _toponym_groups(hits):
        members = []
        seen_ids: set[int] = set()
        for k in g:
            for b in hits[k]:
                if b.id not in seen_ids:
                    seen_ids.add(b.id)
                    members.append(b)
        if len({_norm_muni(b.municipality) for b in members}) > 1:
            narrowed = _narrow_by_context(members, g, title_map, [])
            if not narrowed:
                continue
            members = narrowed
        out.extend(members)
    return out


def _toponym_groups(keys) -> list[list[str]]:
    """Agrupa claves que se contienen una a otra: nombran el mismo
    lugar en el titular ("ROQUE" dentro de "EL ROQUE") y compiten
    por la misma mención, no son dos playas distintas."""
    groups: list[list[str]] = []
    for k in keys:
        for g in groups:
            if any(k in kk or kk in k for kk in g):
                g.append(k)
                break
        else:
            groups.append([k])
    return groups


def _narrow_by_context(
    members: list[Beach],
    group: list[str],
    title_map: dict[str, list[Beach]],
    out: list[Beach],
) -> list[Beach]:
    """Acota un topónimo homónimo entre municipios usando el contexto:
    municipios de las playas ya casadas (`out`) y de las demás
    playas nombradas literalmente en el titular. "Almáciga y el Roque"
    habla del Roque de las Bodegas (Santa Cruz), no del de Fasnia."""
    ctx = {_norm_muni(b.municipality) for b in out}
    ctx |= {
        _norm_muni(b.municipality)
        for kk, bs in title_map.items()
        if kk not in group
        for b in bs
    }
    return [b for b in members if _norm_muni(b.municipality) in ctx]


def _base_key(b: Beach) -> tuple[str, str | None]:
    """Nombre base de la playa (sin sufijo PM) + municipio: los PMs
    de un mismo complejo comparten base."""
    return (
        re.sub(r"\s+PM\d+$", "", b.name),
        _norm_muni(b.municipality),
    )


def _title_key_hits(
    beaches: list[Beach], title_norm: str
) -> dict[str, list[Beach]]:
    """Claves de playa (nombre + alias) presentes literales en el
    titular. Una clave solo cuenta si todas sus candidatas están en
    un único municipio (los homónimos entre municipios se rechazan)."""
    groups: dict[str, list[Beach]] = {}
    for b in beaches:
        for k in _beach_keys(b):
            # Un mismo beach puede aportar la misma clave por nombre y
            # alias ("Playa de Tabaiba" + alias "Tabaiba") — una vez
            if len(k) >= _MIN_NAME_LEN:
                members = groups.setdefault(k, [])
                if all(m.id != b.id for m in members):
                    members.append(b)
    return {
        k: members
        for k, members in groups.items()
        if len({_norm_muni(b.municipality) for b in members}) == 1
        and _name_in_title(k, title_norm)
    }


def _conjoined(key: str, title_norm: str) -> bool:
    """El nombre va en enumeración multi-playa ("X y El Socorro",
    "El Médano, La Tejita"): precedido de 'y'/'e'/','. Así no se
    confunde con referencias locativas ("El Cabezo, en El Médano").
    Misma tolerancia a la preposición interior que _name_in_title."""
    flex = r"(?:\s+(?:DE\s+LA|DE\s+LOS|DE\s+LAS|DEL|DE)\s+|\s+)".join(
        re.escape(w) for w in key.split() if w not in {"DE", "DEL"}
    )
    return bool(
        re.search(rf"(?:\b[YE]\s+|,\s*){flex}(?![A-Z0-9])", title_norm)
    )


def match_beaches(
    ext: EventExtraction, beaches: list[Beach], title: str | None = None
) -> list[Beach]:
    """Playas a las que ligar la noticia. Varios PMs de la misma playa
    (misma clave + municipio) devuelven todos sus registros."""
    if title is None:
        title = getattr(ext, "title", None) or ""
    title_norm = _normalize(title)
    title_map = _title_key_hits(beaches, title_norm)

    def _merge(found: list[Beach]) -> list[Beach]:
        """Añade playas nombradas en el titular que la extracción no
        devolvió. Si la extracción no casó nada vale cualquier nombre
        literal (rescate: "Playa Grande en Playa Jardín"); si ya casó,
        solo suma nombres en enumeración ("X y El Socorro") o la clave
        canónica del propio complejo (alias → nombre real)."""
        seen = {b.id for b in found}
        found_bases = {_base_key(b) for b in found}
        out = list(found)
        # Rescate sin match de extracción: si el municipio extraído no
        # coincide con el de la playa literal, ese nombre del titular
        # no era la playa ("El Barranco de Masca" ≠ "Playa El Barranco"
        # de otro municipio). Con found no vacío no se filtra: las
        # enumeraciones multi-playa sí cruzan municipios.
        emuni = _norm_muni(ext.municipality)
        for g in _toponym_groups(title_map):
            members = [b for k in g for b in title_map[k]]
            if not found:
                # Una clave igual al nombre del municipio casi siempre
                # nombra el pueblo, no la playa: en rescate no vale
                # ("Los Guanches, en Candelaria" ≠ "PLAYA CANDELARIA").
                # Si la extracción casa por vía normal, no pasa por
                # aquí — solo se filtra el rescate literal.
                members = [
                    b
                    for b in members
                    if not any(k == _norm_muni(b.municipality) for k in g)
                ]
                if emuni:
                    members = [
                        b
                        for b in members
                        if _norm_muni(b.municipality) == emuni
                    ]
                if not members:
                    continue
            k_bases = {_base_key(b) for b in members}
            if not (
                not found
                or any(_conjoined(k, title_norm) for k in g)
                or k_bases <= found_bases
            ):
                continue
            # Topónimo homónimo entre municipios: decide el contexto
            # (playas ya casadas + otras del titular). "Almáciga y el
            # Roque" es el Roque de las Bodegas, no el de Fasnia
            if len({_norm_muni(b.municipality) for b in members}) > 1:
                narrowed = _narrow_by_context(members, g, title_map, out)
                if not narrowed:
                    continue
                members = narrowed
            out.extend(b for b in members if b.id not in seen)
            seen.update(b.id for b in members)
        return out

    if not ext.beach_name:
        return _merge([])
    target = _press_key(ext.beach_name)
    if len(target) < _MIN_NAME_LEN:
        return _merge([])
    muni = _norm_muni(ext.municipality)
    # Municipio extraído que no es municipio de Tenerife ("Tenerife"
    # como si lo fuera, un barrio como "Valleseco", cualquier invento
    # del LLM): se ignora también en el rescate por titular, que vuelve
    # a leer ext.municipality en _merge. Un municipio REAL pero
    # contradictorio con la playa casada sigue vetando (puede ser un
    # lugar homónimo que no es la playa).
    if muni not in _ISLAND_MUNICIPALITIES:
        muni = None
        ext = replace(ext, municipality=None)
    # La prensa añade/quita la preposición interior ("Punta del
    # Hidalgo" vs "PUNTA HIDALGO" en el censo): ambas formas casan
    targets = [target]
    deprepped = _INNER_PREP.sub(" ", target)
    if deprepped != target:
        targets.append(deprepped)

    # Extracción multi-playa ("El Socorro y El Médano"): cada parte se
    # casa por separado — "EL SOCORRO" no es substring contiguo del
    # conjunto y se perdería. Titulares genéricos ("Se cierran dos
    # playas") dependen de esta vía porque el titular no nombra.
    parts = re.split(r"\s+[YE]\s+", target)
    # Listas de numeración ("Troya I y II"): la parte corta no es un
    # nombre propio sino el numerador que completa a la anterior —
    # "II" expande a "TROYA II" heredando la base
    expanded = [parts[0]]
    for p in parts[1:]:
        if len(p) < _MIN_NAME_LEN and " " in expanded[-1]:
            stem = expanded[-1].rsplit(" ", 1)[0]
            expanded.append(f"{stem} {p}")
        else:
            expanded.append(p)
    parts = expanded
    if len(parts) > 1 and all(len(p) >= _MIN_NAME_LEN for p in parts):
        out: list[Beach] = []
        seen_ids: set[int] = set()
        for p in parts:
            for b in match_beaches(
                replace(ext, beach_name=p), beaches, title=title
            ):
                if b.id not in seen_ids:
                    seen_ids.add(b.id)
                    out.append(b)
        return _merge(out)

    candidates = []
    for b in beaches:
        # La playa aporta todas sus claves: nombre del censo + aliases
        # de prensa ("Los Guanches" → PLAYA CANDELARIA), con variantes
        keys = _beach_keys(b)
        # El exacto (nombre o alias) gana a las contenciones: si no,
        # "Bajamar" casaría por substring contra "PISCINAS NATURALES DE
        # BAJAMAR" antes de llegar a su alias exacto y la contención
        # con "CASTILLO-BAJAMAR" dejaría el match ambiguo
        # El veto de accidente no-playa se evalúa sobre el target
        # original: la variante sin preposición ("BARRANCO MASCA")
        # perdería el "DE" que delata el "BARRANCO DE …"
        not_feature = not _NON_BEACH_FEATURE.match(target)
        hit = next((k for k in keys if k in targets), None) or next(
            (
                k
                for k in keys
                for t in targets
                if t in k
                or (len(k) >= _MIN_NAME_LEN and k in t and not_feature)
            ),
            None,
        )
        if hit is not None:
            candidates.append((b, hit))

    # Fallback por alias de zona: la prensa extrae nombres de cala que
    # el censo no tiene ("Punta Brava" → PLAYA JARDIN PM4). Solo cuando
    # ningún nombre/alias de playa casó — una playa real del mismo
    # nombre siempre gana ("Playa Grande" de Arico vs alias de PM4)
    if not candidates:
        from app.news_zones import _zone_entry

        artless_targets = {_LEADING_ARTICLE.sub("", t) for t in targets}
        for b in beaches:
            zone = _zone_entry(b)
            if zone is None:
                continue
            aliases = (*zone["aliases"], *zone.get("weak_aliases", ()))
            if any(
                _LEADING_ARTICLE.sub("", a) in artless_targets for a in aliases
            ):
                candidates.append((b, target))

    if muni is None:
        # Un match exacto gana a las contenciones solo si no hay
        # ambigüedad entre municipios: "El Médano" es playa propia
        # aunque existan "El Médano-Chica"/"-Leocadio Machado" en el
        # mismo municipio; "El Cabezo"/"La Arena" siguen ambiguos
        # porque la hermana vive en otro municipio
        munis = {_norm_muni(b.municipality) for b, _ in candidates}
        pool = candidates
        if len(munis) == 1:
            exact = [(b, k) for b, k in candidates if k in targets]
            if exact:
                pool = exact
        keys = {k for _, k in pool}
        munis = {_norm_muni(b.municipality) for b, _ in pool}
        if len(pool) >= 1 and len(keys) == 1 and len(munis) == 1:
            artless_targets = {_LEADING_ARTICLE.sub("", t) for t in targets}
            # "Clave exacta" tolera el artículo censal que la prensa
            # omite: "Bollullo" extraído ↔ "EL BOLLULLO" en el censo
            if any(
                _LEADING_ARTICLE.sub("", k) in artless_targets for k in keys
            ):
                return _merge([b for b, _ in pool])
        return _merge(_multi_beach_hits(pool, _normalize(title), title_map))

    hits = [
        (b, k) for b, k in candidates if _norm_muni(b.municipality) == muni
    ]
    # El municipio extraído desambigua homónimos entre municipios
    # ("El Cabezo" en Güímar vs Granadilla). Solo se duda de él cuando
    # el titular aporta contra-evidencia — el LLM a veces lo deduce
    # mal (El Cabezo de Güímar adjudicado a Granadilla), pero ese
    # error se delata si el texto nombra otro municipio de la isla o
    # una cala hermana de otro municipio ("…y Paseo de las Palmeras").
    cand_munis = {_norm_muni(b.municipality) for b, _ in candidates}
    if len(cand_munis) > 1:
        norm_title = _normalize(title)
        muni_in_title = (
            muni in norm_title
            or muni.split()[0] in norm_title
            or any(
                a in norm_title
                for a, off in MUNICIPALITY_ALIASES.items()
                if off == muni
            )
        )
        if not muni_in_title:
            # El titular nombra otro municipio candidato →
            # contradicción literal con la extracción. "La Orotava"
            # cuenta por nombre completo; la primera palabra solo si
            # es distintiva ("GRANADILLA" sí, "EL"/"SANTA"/"PUERTO" no)
            def _muni_named(om: str) -> bool:
                w = om.split()[0]
                return (
                    om in norm_title
                    or (
                        len(w) >= _MIN_NAME_LEN
                        and w not in _GENERIC_MUNI_WORD
                        and w in norm_title
                    )
                    or any(
                        a in norm_title
                        for a, off in MUNICIPALITY_ALIASES.items()
                        if off == om
                    )
                )

            if any(_muni_named(om) for om in cand_munis - {muni}):
                # Sin rescate: el municipio extraído está desmentido
                # por el titular y _merge confiaría en él de nuevo
                return []
            # Claves distintivas de las candidatas de otros
            # municipios: no vale la clave compartida que creó la
            # ambigüedad ("EL CABEZO"), solo las que distinguen a la
            # hermana ("PASEO DE LAS PALMERAS")
            artless_targets = {_LEADING_ARTICLE.sub("", t) for t in targets}
            other_keys = {
                k
                for b, _ in candidates
                if _norm_muni(b.municipality) != muni
                for k in _beach_keys(b)
                if _LEADING_ARTICLE.sub("", k) not in artless_targets
            }
            if any(_name_in_title(k, norm_title) for k in other_keys):
                return []
    # Dentro del municipio el exacto también gana a las contenciones
    exact = [(b, k) for b, k in hits if k in targets]
    pool = exact or hits
    keys = {k for _, k in pool}
    if len(pool) >= 1 and len(keys) == 1:
        return _merge([b for b, _ in pool])
    # Alias distintos del mismo complejo ("Playa Grande y Charcón" →
    # PM4+PM5 de Playa Jardín): mismo nombre base + municipio = misma
    # playa aunque casen claves distintas
    bases = {
        (re.sub(r"\s+PM\d+$", "", b.name), _norm_muni(b.municipality))
        for b, _ in pool
    }
    if len(pool) >= 1 and len(bases) == 1:
        return _merge([b for b, _ in pool])
    return _merge(_multi_beach_hits(pool, _normalize(title), title_map))

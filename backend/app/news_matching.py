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

from app.models import Beach
from app.news_llm import EventExtraction
from scripts.ingest_osm_beaches import _normalize

# Grafías que usa la prensa → municipio oficial (límites OSM en BD)
MUNICIPALITY_ALIASES = {
    "LA LAGUNA": "SAN CRISTOBAL DE LA LAGUNA",
    "GRANADILLA": "GRANADILLA DE ABONA",
}

_MIN_NAME_LEN = 5

_GENERIC_PREFIX = re.compile(
    r"^PLAYA\s+(DE\s+(LA|LOS|LAS)\s+|DEL\s+|DE\s+|D\s*)?|^PLAYA\s*"
)
_PAREN_ARTICLE = re.compile(r"\s*\((EL|LA|LAS|LOS)\)")


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


def _name_in_title(key: str, title_norm: str) -> bool:
    """La clave aparece como nombre literal en el titular (límites de
    palabra: "LA ARENA" no casa dentro de "ARENITA")."""
    return bool(
        re.search(
            rf"(?<![A-Z0-9]){re.escape(key)}(?![A-Z0-9])", title_norm
        )
    )


def _multi_beach_hits(
    cands: list[tuple[Beach, str]], title_norm: str
) -> list[Beach]:
    """Titulares con varias playas ("El Médano y El Socorro cierran"):
    cada clave distinta casa si aparece literal en el titular y sus
    candidatas están en un solo municipio."""
    keys = {k for _, k in cands}
    if len(keys) <= 1:
        return []
    ok = []
    for k in keys:
        members = [(b, kk) for b, kk in cands if kk == k]
        munis = {_norm_muni(b.municipality) for b, _ in members}
        if len(munis) == 1 and _name_in_title(k, title_norm):
            ok.extend(b for b, _ in members)
    return ok


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
        keys = [_press_key(b.name)] + [
            _press_key(a) for a in (getattr(b, "press_aliases", None) or [])
        ]
        for k in keys:
            if len(k) >= _MIN_NAME_LEN:
                groups.setdefault(k, []).append(b)
    return {
        k: members
        for k, members in groups.items()
        if len({_norm_muni(b.municipality) for b in members}) == 1
        and _name_in_title(k, title_norm)
    }


def _conjoined(key: str, title_norm: str) -> bool:
    """El nombre va en enumeración multi-playa ("X y El Socorro",
    "El Médano, La Tejita"): precedido de 'y'/'e'/','. Así no se
    confunde con referencias locativas ("El Cabezo, en El Médano")."""
    return bool(
        re.search(
            rf"(?:\b[YE]\s+|,\s*){re.escape(key)}(?![A-Z0-9])",
            title_norm,
        )
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
        for key, members in title_map.items():
            k_bases = {_base_key(b) for b in members}
            if (
                not found
                or _conjoined(key, title_norm)
                or k_bases <= found_bases
            ):
                out.extend(b for b in members if b.id not in seen)
                seen.update(b.id for b in members)
        return out

    if not ext.beach_name:
        return _merge([])
    target = _press_key(ext.beach_name)
    if len(target) < _MIN_NAME_LEN:
        return _merge([])
    muni = _norm_muni(ext.municipality)

    candidates = []
    for b in beaches:
        # La playa aporta todas sus claves: nombre del censo + aliases
        # de prensa ("Los Guanches" → PLAYA CANDELARIA)
        keys = [_press_key(b.name)] + [
            _press_key(a)
            for a in (getattr(b, "press_aliases", None) or [])
        ]
        # El exacto (nombre o alias) gana a las contenciones: si no,
        # "Bajamar" casaría por substring contra "PISCINAS NATURALES DE
        # BAJAMAR" antes de llegar a su alias exacto y la contención
        # con "CASTILLO-BAJAMAR" dejaría el match ambiguo
        hit = next((k for k in keys if k == target), None) or next(
            (
                k
                for k in keys
                if target in k or (len(k) >= _MIN_NAME_LEN and k in target)
            ),
            None,
        )
        if hit is not None:
            candidates.append((b, hit))

    if muni is None:
        # Un match exacto gana a las contenciones solo si no hay
        # ambigüedad entre municipios: "El Médano" es playa propia
        # aunque existan "El Médano-Chica"/"-Leocadio Machado" en el
        # mismo municipio; "El Cabezo"/"La Arena" siguen ambiguos
        # porque la hermana vive en otro municipio
        munis = {_norm_muni(b.municipality) for b, _ in candidates}
        pool = candidates
        if len(munis) == 1:
            exact = [(b, k) for b, k in candidates if k == target]
            if exact:
                pool = exact
        keys = {k for _, k in pool}
        munis = {_norm_muni(b.municipality) for b, _ in pool}
        if len(pool) >= 1 and len(keys) == 1 and len(munis) == 1:
            if any(k == target for k in keys):
                return _merge([b for b, _ in pool])
        return _merge(_multi_beach_hits(pool, _normalize(title)))

    hits = [
        (b, k) for b, k in candidates if _norm_muni(b.municipality) == muni
    ]
    # El LLM a veces deduce el municipio y se equivoca (El Cabezo de
    # Güímar adjudicado a Granadilla). Con playas homónimas en varios
    # municipios solo se confía en el municipio extraído si aparece
    # literalmente en el titular.
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
            return _merge([])
    # Dentro del municipio el exacto también gana a las contenciones
    exact = [(b, k) for b, k in hits if k == target]
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
    return _merge(_multi_beach_hits(pool, _normalize(title)))

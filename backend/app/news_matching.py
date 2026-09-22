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

- Con municipio extraído: casa solo si TODOS los candidatos de ese
  municipio comparten la misma clave — varios PMs de una misma playa
  ("CABEZO (EL)-PASEO DE LAS PALMERAS PM1/PM4") cuentan como una y la
  noticia se sirve en cada ficha.
- Sin municipio: casa solo si TODOS los candidatos de la isla comparten
  clave y municipio — la contención sin municipio y los nombres
  repetidos entre zonas (hay dos "El Cabezo") se rechazan.

Ante la duda devuelve []: una noticia sin casar no se muestra.
"""

import re

from app.models import Beach
from app.news_llm import EventExtraction
from scripts.ingest_osm_beaches import _normalize

# Grafías que usa la prensa → municipio oficial (límites OSM en BD)
MUNICIPALITY_ALIASES = {
    "LA LAGUNA": "SAN CRISTOBAL DE LA LAGUNA",
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


def match_beaches(
    ext: EventExtraction, beaches: list[Beach], title: str | None = None
) -> list[Beach]:
    """Playas a las que ligar la noticia. Varios PMs de la misma playa
    (misma clave + municipio) devuelven todos sus registros."""
    if title is None:
        title = getattr(ext, "title", None) or ""
    if not ext.beach_name:
        return []
    target = _press_key(ext.beach_name)
    if len(target) < _MIN_NAME_LEN:
        return []
    muni = _norm_muni(ext.municipality)

    candidates = []
    for b in beaches:
        # La playa aporta todas sus claves: nombre del censo + aliases
        # de prensa ("Los Guanches" → PLAYA CANDELARIA)
        keys = [_press_key(b.name)] + [
            _press_key(a)
            for a in (getattr(b, "press_aliases", None) or [])
        ]
        hit = next(
            (
                k
                for k in keys
                if k == target
                or target in k
                or (len(k) >= _MIN_NAME_LEN and k in target)
            ),
            None,
        )
        if hit is not None:
            candidates.append((b, hit))

    if muni is None:
        # Sin municipio: un solo grupo (misma clave + municipio)
        keys = {k for _, k in candidates}
        munis = {_norm_muni(b.municipality) for b, _ in candidates}
        if len(candidates) >= 1 and len(keys) == 1 and len(munis) == 1:
            if any(k == target for k in keys):
                return [b for b, _ in candidates]
        return []

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
            return []
    keys = {k for _, k in hits}
    if len(hits) >= 1 and len(keys) == 1:
        return [b for b, _ in hits]
    return []

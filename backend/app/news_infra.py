"""Eventos de infraestructura de vertido (Hito 11.2).

Segunda vía de la ingesta de prensa, en cascada tras `extract_event`:
solo se invoca cuando el pipeline de playa descartó el artículo
(no relevante o sin casar a una playa) y el titular casa el léxico de
infraestructura. El prompt y la extracción de playas quedan intactos.

Los ítems rescatados se guardan con `event_type="infra"`: etiqueta que
los identifica — no despiertan push, no alimentan `effective_states`
y el endpoint `/outfalls/{id}/news` los sirve por proximidad a una
playa o por topónimo del censo de vertidos.
"""

import re
import unicodedata
from collections.abc import Iterable
from dataclasses import replace

from app.news_llm import EventExtraction, NewsExtractor
from app.news_sources import RawArticle

INFRA_EVENT_TYPE = "infra"

# Léxico de infraestructura de vertido: puerta del segundo extractor
# en la ingesta y filtro de la sección de noticias del emisario.
# Cubre la instalación (emisario/depuradora/aliviadero/tubería/
# bombeo/colector), el suceso sobre ella (rotura/fisura/obstrucción/
# desborde/reboso/atasco/sobrecarga — cuando el sistema supera su
# capacidad vierte el sobrante) y el vertido en sí. Las siglas del
# censo van con límites de palabra ("quedar" contiene "edar").
INFRA_RE = re.compile(
    r"emisario|depuradora|aliviadero|saneamiento|tuber[ií]a|"
    r"bombeo|colector|fisura|rotura|vertido|"
    r"aguas?\s+(?:residuales|fecales)|"
    r"\bebar\b|\bedar\b|\bedam\b|\betar\b|"
    r"obstru|desbord|rebos|atasc|sobrecarg",
    re.IGNORECASE,
)

PROMPT_INFRA = """\
Eres un extractor de eventos para una app que monitoriza los puntos de
vertido al mar de Tenerife (emisarios submarinos, aliviaderos,
bombeos, depuradoras y la red de saneamiento que los alimenta). Te paso
un titular de prensa, su medio y, cuando lo hay, un extracto del cuerpo.

Decide si informa de un evento concreto sobre una infraestructura de
vertido o saneamiento de Tenerife: rotura, fisura, obstrucción,
atasco, desbordamiento o reboso, vertido activo o ilegal, reparación
u obras de la instalación, denuncia o investigación sobre ella.

Marca relevant=false cuando:
- la infraestructura no está en Tenerife (otras islas, península)
- es opinión o reportaje genérico sin evento concreto
- el suceso no es de un vertido ni de la red de saneamiento: rotura
  de tubería de AGUA POTABLE, obra vial, depuradora de otra isla
- es inauguración, inversión o acto administrativo sin incidencia
  ("ponen en marcha una depuradora", "presupuestan la red")
- el titular NIEGA o descarta el suceso ("descartan un vertido")

Si relevant=true extrae:
- beach_name: el LUGAR donde vierte la instalación o junto al que
  ocurre el suceso — playa, barrio, punta o núcleo tal como aparece
  en el texto ("Punta Brava", "Valle Guerra", "Radazul"). Si el texto
  no da un lugar concreto, déjalo vacío
- municipality: municipio de Tenerife SOLO si se menciona; nunca lo
  deduzcas por el lugar
- event_type: "infra"
- cause: qué ocurre con la instalación, en frase corta — "rotura del
  emisario", "fisura en la conducción", "vertido de aguas residuales",
  "retraso en la reparación", "obstrucción por toallitas", "denuncia
  por vertidos ilegales". El suceso, no la respuesta administrativa
- closed_since: solo si el texto afirma desde cuándo la instalación
  lleva rota o vertiendo y sigue así (ISO parcial YYYY[-MM[-DD]])
- confidence: 0-1, confianza en que el titular describe ese evento
"""


def extract_infra_event(
    article: RawArticle, extractor: NewsExtractor
) -> EventExtraction | None:
    """Extracción con PROMPT_INFRA; event_type queda fijado a "infra".

    `beach_name` guarda el lugar nombrado (playa, barrio, punta o
    núcleo): el matching intenta anclarlo a una playa y, si no, el
    endpoint del emisario lo resuelve por topónimo del censo.
    """
    ext = extractor.extract(article, prompt=PROMPT_INFRA)
    if ext is not None and ext.relevant:
        ext = replace(ext, event_type=INFRA_EVENT_TYPE)
    return ext


# --- Atribución por topónimo: qué noticias son "de este punto" ---
#
# La prensa nunca usa el nombre del censo ("Aliviadero EBAR El
# Caletón") — dice "el emisario de Punta Brava". Un titular NOMBRA un
# punto solo cuando junta la palabra de instalación con un topónimo
# propio; el topónimo a secas no basta ("Punta Brava" también es el
# barrio y el punto de muestreo de la playa).

# Palabra de instalación que delante de un topónimo nombra el punto
_FACILITY_RE = (
    r"(?:emisari\w*|aliviader\w*|depurador\w*|bombeo\w*|colector\w*|"
    r"tuber[ií]a\w*|rebosader\w*|saneamiento|\bebar\b|\bedar\b|"
    r"\bedam\b|\betar\b)"
)
# Conectores tolerados entre instalación y topónimo ("emisario
# SUBMARINO de Punta Brava", "depuradora DEL Valle de la Orotava")
_NAMED_CONNECTORS = (
    r"(?:\s+(?:de|del|la|el|los|las|en|submarino|submarina|comarcal|"
    r"municipal|nuevo|nueva|principal))*"
)

# Nomenclatura genérica del censo: se recorta de los bordes de cada
# fragmento hasta dejar el topónimo distintivo ("EBAR El Caletón" →
# "caleton")
_LEADING_GENERIC = {
    "emisario",
    "emisarios",
    "submarino",
    "submarina",
    "aliviadero",
    "aliviaderos",
    "depuradora",
    "depuradoras",
    "saneamiento",
    "instalacion",
    "vertido",
    "bombeo",
    "bombeos",
    "colector",
    "colectores",
    "tuberia",
    "tuberias",
    "punto",
    "conduccion",
    "desague",
    "emergencia",
    "ebar",
    "edar",
    "edam",
    "etar",
    "dpmt",
    "pluvial",
    "pluviales",
    "rebosadero",
    "rebosaderos",
    "estacion",
    "descarga",
    "red",
    "unitaria",
    "de",
    "del",
    "la",
    "el",
    "los",
    "las",
    "en",
    "comarcal",
    "municipal",
    "nuevo",
    "nueva",
}

# Filtro de titular de la sección de prensa del emisario: más
# estricto que INFRA_RE — exige que el titular hable de la
# instalación o del suceso (rotura, vertido, desborde, obstrucción).
# "Aguas fecales" a secas no basta: un cierre de playa por
# contaminación fecal ya vive en la ficha de la playa y repetirlo en
# la del emisario es ruido
INFRA_TITLE_RE = re.compile(
    _FACILITY_RE + r"|vertid\w*|fisura\w*|rotura\w*|obstru\w*|"
    r"desbord\w*|rebos\w*|atasc\w*|aguas?\s+residuales",
    re.IGNORECASE,
)

# Topónimos demasiado genéricos para atribuir un punto concreto
_GENERIC_TOPONYMS = {
    "puerto",
    "costa",
    "casco",
    "centro",
    "pueblo",
    "mar",
    "playa",
    "poligono",
    "poligono industrial",
    "zona",
    "urbano",
    # puntos cardinales: "EBAR Norte"/"Oeste" no son topónimos
    "norte",
    "sur",
    "este",
    "oeste",
}


def norm_txt(s: str | None) -> str:
    """Minúsculas sin acentos ni puntuación — la superficie común para
    casar topónimos del censo con titulares de prensa."""
    t = "".join(
        c
        for c in unicodedata.normalize("NFD", (s or "").lower())
        if unicodedata.category(c) != "Mn"
    )
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", t)).strip()


def _toponym_fragment(text: str) -> str | None:
    """Topónimo de un fragmento del censo tras recortar la
    nomenclatura genérica ("Aliviadero EBAR Playa Jardín" →
    "playa jardin")."""
    words = norm_txt(text).split()
    while words and words[0] in _LEADING_GENERIC:
        words.pop(0)
    while words and (len(words[-1]) == 1 or words[-1] in _LEADING_GENERIC):
        words.pop()
    if not 0 < len(words) <= 4:
        return None
    key = " ".join(words)
    if len(key) < 4 or key in _GENERIC_TOPONYMS:
        return None
    return key


def outfall_keys(outfall) -> set[str]:
    """Topónimos con los que la prensa puede nombrar ESTE punto
    ("punta brava", "caleton", "san telmo"). Salen de name/location/
    origin — NO de settlement: el núcleo es compartido (4 puntos del
    clúster Jardín tienen settlement "Punta Brava") y describe la
    zona, no el punto. Las claves iguales al municipio se descartan.
    """
    keys: set[str] = set()
    for field in (outfall.name, outfall.location, outfall.origin):
        if not field:
            continue
        for part in re.split(r"[-(/]", field):
            key = _toponym_fragment(part)
            if key:
                keys.add(key)
    muni = norm_txt(outfall.municipality)
    return {k for k in keys if not muni or (k not in muni and muni not in k)}


def _named_re(key: str) -> re.Pattern:
    """El texto nombra el punto cuando junta palabra de instalación
    con el topónimo: "emisario de Punta Brava", "aliviadero de Playa
    Jardín"."""
    return re.compile(
        _FACILITY_RE + _NAMED_CONNECTORS + r"\s*" + re.escape(key) + r"\b"
    )


def outfall_named_patterns(
    outfall_id: int, outfalls: Iterable
) -> tuple[list[re.Pattern], list[re.Pattern]]:
    """(patrones que nombran ESTE punto, patrones de otros puntos).

    Un topónimo solo puede atribuir cuando es único en todo el censo:
    "Bajamar" lo comparten 5 puntos del clúster — la noticia que dice
    "el aliviadero de Bajamar" no distingue y no se atribuye a ninguno.
    """
    owners: dict[str, set[int]] = {}
    for o in outfalls:
        for k in outfall_keys(o):
            owners.setdefault(k, set()).add(o.id)
    own: list[re.Pattern] = []
    other: list[re.Pattern] = []
    for key, ids in owners.items():
        if len(ids) != 1:
            continue
        (own if outfall_id in ids else other).append(_named_re(key))
    return own, other

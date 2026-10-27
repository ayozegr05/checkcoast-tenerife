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
from datetime import date, datetime, timedelta

from geoalchemy2 import Geography, Geometry
from sqlalchemy import cast, func, literal, or_

from app.models import Beach, NewsItem, Outfall
from app.news_llm import EventExtraction, NewsExtractor
from app.news_sources import RawArticle
from app.queries import clean_cause_text
from app.schemas import OutfallEpisodeBeachOut, OutfallEpisodesOut

INFRA_EVENT_TYPE = "infra"


def infra_cause_of(n: NewsItem) -> str | None:
    """Hecho de infraestructura del artículo ("rotura del emisario",
    "obstrucción por toallitas").

    - `infra_cause` lo guarda la pasada de cuerpo sobre ítems duales
      playa+infra (su `cause` sigue siendo la del evento de playa).
    - En ítems puramente infra (`event_type='infra'`) la causa YA es
      el hecho de infraestructura: se reutiliza tal cual.
    """
    if n.infra_cause:
        return n.infra_cause
    if n.event_type == INFRA_EVENT_TYPE:
        return n.cause
    return None


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

# "En la zona" es contexto de infraestructura: una reapertura u otro
# ítem sin evento de vertido propio solo cuenta si el titular nombra
# la INSTALACIÓN. "Reabre la playa… y cierran Jardín por vertidos"
# narra la playa y el vertido puede ser de otro lugar (caso real:
# el aliviadero de Playa San Juan mostraba un vertido de Puerto de
# la Cruz); "reabre, pero el emisario sigue roto" sí es noticia de
# infra — la instalación es la protagonista
_FACILITY_TITLE_RE = re.compile(_FACILITY_RE, re.IGNORECASE)
_EVENT_FREE_TYPES = {"reopening", "other", ""}


def _zone_title_ok(n: NewsItem) -> bool:
    """Titular apto para 'en la zona' de la ficha del emisario."""
    if not INFRA_TITLE_RE.search(n.title or ""):
        return False
    if (n.event_type or "") in _EVENT_FREE_TYPES:
        return _FACILITY_TITLE_RE.search(n.title or "") is not None
    return True


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
    # edificios y servicios cívicos: "el emisario del ayuntamiento"
    # habla del consistorio, no de un punto del censo (caso real:
    # el Aliviadero EBAR Ayuntamiento - Aparcamiento se tragaba las
    # noticias de "la depuradora del Ayuntamiento" de toda la isla)
    "ayuntamiento",
    "aparcamiento",
    "plaza",
    "mercado",
    "iglesia",
    "colegio",
    "instituto",
    "polideportivo",
    "oficina",
    "garaje",
    "nave",
    "piscina",
    "piscinas",
    "tour",
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


def _toponym_owners(outfalls: Iterable) -> dict[str, set[int]]:
    """topónimo del censo → ids de puntos que lo comparten.

    Un topónimo solo puede atribuir cuando es único en todo el censo:
    "Bajamar" lo comparten 5 puntos del clúster — la noticia que dice
    "el aliviadero de Bajamar" no distingue y no se atribuye a ninguno.

    Y una clave que es prefijo de otra clave del censo tampoco puede
    atribuir, aunque sea única: "Puertito" (El Puertito de Tabaiba)
    es prefijo de "puertito de guimar" y "puertito de radazul" — la
    prensa que dice "el emisario del Puertito" no distingue entre
    los tres Puertitos de la isla.
    """
    owners: dict[str, set[int]] = {}
    for o in outfalls:
        for k in outfall_keys(o):
            owners.setdefault(k, set()).add(o.id)
    ambiguous = {
        k
        for k in owners
        for k2 in owners
        if k2 != k and k2.startswith(k + " ")
    }
    return {k: ids for k, ids in owners.items() if k not in ambiguous}


def outfall_named_patterns(
    outfall_id: int, outfalls: Iterable
) -> tuple[list[re.Pattern], list[re.Pattern]]:
    """(patrones que nombran ESTE punto, patrones de otros puntos)."""
    own: list[re.Pattern] = []
    other: list[re.Pattern] = []
    for key, ids in _toponym_owners(outfalls).items():
        if len(ids) != 1:
            continue
        (own if outfall_id in ids else other).append(_named_re(key))
    return own, other


def infra_outfall_for_text(text: str, outfalls: Iterable) -> int | None:
    """id del punto que el TEXTO nombra (instalación + topónimo
    único) — None si ninguno o si nombra a varios distintos.

    Sirve igual para titular que para cuerpo: "el cuerpo cuenta que la
    fisura está en el emisario de Punta Brava" → id de ese emisario.
    Si el artículo menciona "el emisario de Punta Brava" y también
    "la depuradora de Valle Guerra" (dos puntos distintos), la
    atribución es ambigua → None, y el ítem queda en zona.
    """
    t = norm_txt(text)
    found = {
        next(iter(ids))
        for key, ids in _toponym_owners(outfalls).items()
        if len(ids) == 1 and _named_re(key).search(t)
    }
    return found.pop() if len(found) == 1 else None


# --- Sección de prensa del emisario (endpoint + landing) ---

OUTFALL_NEWS_RADIUS_M = 2000
# Sin tope de ítems: la ficha ya acota con la vista por años y el
# "Ver más" — truncar escondía hemeroteca que ya viajaba en `named`

# Familias semánticas para agrupar las noticias "de este punto": la
# causa del LLM es texto libre ("vertido de aguas residuales" vs
# "contaminación por vertidos…"), así que el grupo se decide por
# palabras clave. El hecho (infra_cause/cause) manda sobre el
# titular; "Vertido" va de cajón final — una denuncia o reparación
# por vertido sigue siendo noticia de denuncia/reparación
# "Roturas y reparaciones" es UNA familia: la reparación es el
# capítulo dos de la rotura — lo que no se rompe no se repara.
# Dos regex con el mismo label conservan la precedencia original:
# la reparación se detecta antes que la denuncia (la respuesta es
# lo más accionable) y la rotura después.
_INFRA_FAMILIES: list[tuple[str, re.Pattern]] = [
    (
        "Roturas y reparaciones",
        re.compile(r"repara|obra|arregl|licit|concurso|retras", re.I),
    ),
    (
        "Denuncias e investigaciones",
        re.compile(
            r"denunc|investig|fiscal|sanci[oó]n|multa|judi|archiv", re.I
        ),
    ),
    (
        "Roturas y reparaciones",
        re.compile(r"rotur|fisur|revent|aver[ií]a|derrame", re.I),
    ),
    ("Obstrucciones", re.compile(r"obstru|atasc|toallita|colaps", re.I)),
    ("Vertidos", re.compile(r"vertido|rebos|desbord|saneamiento", re.I)),
]
_INFRA_FAMILY_OTHER = "Otros sucesos"


def _infra_family(n: NewsItem) -> str:
    # Cada familia se busca en el hecho Y en el titular, en orden de
    # especificidad: "denuncia por vertidos" es Denuncia (el titular
    # dice "La Fiscalía denuncia…") aunque el hecho extraído solo
    # diga "vertido" — Vertido es el cajón final, no el primero
    primary = norm_txt(f"{n.infra_cause or ''} {n.cause or ''}")
    if n.event_type != INFRA_EVENT_TYPE and not n.infra_cause:
        primary = ""  # causa de playa: no decide la familia de infra
    title = norm_txt(n.title)
    for label, rx in _INFRA_FAMILIES:
        if rx.search(primary) or rx.search(title):
            return label
    return _INFRA_FAMILY_OTHER


# Palabras que NO distinguen un hecho: "vertido de aguas
# residuales" y "contaminación por vertidos de aguas residuales"
# son el mismo suceso con otra prosa — su firma (las palabras que
# quedan tras quitar estas) es idéntica y comparten bloque
_FACT_GENERIC = frozenset(
    """
    de la el en por del al a y o un una los las con sin para que su
    sus se es más tras desde hasta ante durante varios nuevo nueva
    vertido vertidos aguas residuales fecales contaminación
    contaminacion mar costa zona caso casos problema problemas
    saneamiento submarino
    """.split()
)


def _fact_key(fact: str) -> frozenset:
    """Palabras que de verdad distinguen un hecho: {fisura, emisario}
    vs {rotura, emisario} son sucesos distintos; dos paráfrasis del
    vertido genérico caen en la firma vacía y se fusionan."""
    return frozenset(
        w for w in norm_txt(fact).split() if w not in _FACT_GENERIC
    )


def _items_by_fact_signature(
    items: list[tuple[NewsItem, str | None]],
) -> list[tuple[NewsItem, str | None]]:
    """Ordena las fuentes de una familia por firma del hecho: las
    filas que describen el mismo suceso quedan contiguas (fisura
    junto a fisura, rotura junto a rotura) en vez de intercaladas —
    la repetición del lead se lee como corroboración ordenada, no
    como caos. Cada bloque se ordena por su noticia más reciente;
    dentro, fecha desc."""
    groups: dict[frozenset, list[tuple[NewsItem, str | None]]] = {}
    for pair in items:
        n, _ = pair
        fact = clean_cause_text(infra_cause_of(n)) or n.title
        groups.setdefault(_fact_key(fact), []).append(pair)
    ordered = sorted(
        groups.values(),
        key=lambda g: max((n.published_at or datetime.min) for n, _ in g),
        reverse=True,
    )
    return [p for g in ordered for p in g]


def news_by_year_family(
    pairs: list[tuple[NewsItem, str | None]],
) -> list[dict]:
    """Ítems agrupados año (desc) → familias → fuentes.

    Un solo bloque por año con TODAS las familias dentro — no un
    "2026" repetido por cada causa. El hecho ya no es un nivel de
    agrupación: cada fuente lo lleva como lead propio (ver
    `_news_fact_row`/app), y la firma semántica solo se usa para
    ORDENAR las filas — mismo suceso contiguo. Cada familia lleva
    `count` (total de noticias) e `items` planos. Sirve igual para
    named que para zone.
    """
    by_fam: dict[tuple[int, str], list[tuple[NewsItem, str | None]]] = {}
    for pair in pairs:
        n, _ = pair
        year = n.published_at.year if n.published_at else 0
        by_fam.setdefault((year, _infra_family(n)), []).append(pair)
    # Con labels repetidos (rotura+reparación comparten familia) el
    # orden manda la primera aparición, no la última
    order: dict[str, int] = {}
    for i, (label, _) in enumerate(_INFRA_FAMILIES):
        order.setdefault(label, i)
    years: dict[int, list[dict]] = {}
    for (year, fam), items in by_fam.items():
        years.setdefault(year, []).append(
            {
                "family": fam,
                "count": len(items),
                "items": _items_by_fact_signature(items),
            }
        )
    out: list[dict] = []
    for year, fams in years.items():
        fams.sort(key=lambda f: order.get(f["family"], len(order)))
        out.append({"year": year or None, "families": fams})
    out.sort(key=lambda g: -(g["year"] or 0))
    return out


def gather_infra_news(
    db, outfall
) -> tuple[
    list[tuple[NewsItem, str | None]],
    list[tuple[NewsItem, str | None]],
    dict | None,
    dict,
]:
    """(named, zone) de la ficha del emisario, como (item, playa).

    - Solo puntos de residual: pluviales, salmueras y piscinas no
      son infra de saneamiento — su ficha no lleva sección.
    - Dos fuentes de candidatos:
      a) `infra_outfall_id` = este punto — atribución persistida por
         el escáner de titular/cuerpo; no exige playa cercana ni
         titular con léxico (el nombre puede salir solo en el cuerpo);
      b) noticias `relevant` casadas a playas a <2 km.
    - El filtro de titular INFRA_TITLE_RE aplica solo a la vía (b):
      un cierre de playa por contaminación fecal ya vive en la ficha
      de la playa. Un ítem con atribución persistida a ESTE punto se
      sirve aunque el titular no hable de infra — el cuerpo ya
      demostró que lo nombra.
    - `named` = atribución persistida propia, o instalación +
      topónimo propio único en el titular; `zone` = infra sin punto
      concreto. Si el ítem nombra OTRO punto (columna o titular), se
      omite — cada ficha habla de lo suyo.
    - `infra_checked_at` marca cuerpo ya escaneado: si no hay
      `infra_outfall_id`, el ítem no nombra a nadie → zona (nunca
      "named" por re-juzgar el titular con otros criterios).
    - La proximidad es contexto de prensa: nunca implica causalidad.
    - Devuelve además `summary` (dict {"named_count", "causes"} o
      None): la línea resumen "de este punto" — recuento sobre TODAS
      las named — y `groups`
      ({"named": [...], "zone": [...]}), ambas listas agrupadas
      año → familia semántica (la zona también tiene ruido: mismas
      réplicas apiladas bajo el mismo hecho).
    """
    empty: tuple[list, list, None, dict] = (
        [],
        [],
        None,
        {"named": [], "zone": []},
    )
    if "residual" not in (outfall.nature or "").lower():
        return empty
    outfall_geog = cast(literal(outfall.geom, type_=Geometry), Geography)
    beach_names = {
        b.id: b.name
        for b in db.query(Beach.id, Beach.name)
        .filter(
            func.ST_DWithin(
                Beach.geom.cast(Geography),
                outfall_geog,
                OUTFALL_NEWS_RADIUS_M,
            )
        )
        .all()
    }
    cond = NewsItem.infra_outfall_id == outfall.id
    if beach_names:
        cond = or_(cond, NewsItem.beach_id.in_(beach_names))
    rows = (
        db.query(NewsItem)
        .filter(NewsItem.relevant.is_(True), cond)
        .order_by(NewsItem.published_at.desc().nulls_last())
        .all()
    )
    if not rows:
        return empty
    own_res, other_res = outfall_named_patterns(
        outfall.id, db.query(Outfall).all()
    )
    named: list[tuple[NewsItem, str | None]] = []
    zone: list[tuple[NewsItem, str | None]] = []
    seen: set[str] = set()  # dedup por URL: réplicas en cada PM
    seen_piece: set[tuple[str, str]] = set()  # mismo artículo, URL gemela
    for n in rows:
        if n.url in seen:
            continue
        seen.add(n.url)
        # Segundo cerrojo: Google News envuelve el MISMO artículo con
        # URLs distintas (y la fecha puede bailar un día) — la réplica
        # caza por URL, el wrapper gemelo solo por (titular, medio)
        piece = (norm_txt(n.title or ""), (n.source or "").lower())
        if piece in seen_piece:
            continue
        seen_piece.add(piece)
        pair = (n, beach_names.get(n.beach_id))
        if n.infra_outfall_id is not None:
            # Atribución persistida (titular o cuerpo): propio →
            # named; otro punto → fuera de esta ficha
            if n.infra_outfall_id == outfall.id:
                named.append(pair)
            continue
        if n.infra_checked_at is not None:
            # Cuerpo ya escaneado sin punto concreto: solo zona si el
            # titular habla de la instalación/suceso
            if _zone_title_ok(n):
                zone.append(pair)
            continue
        # Sin revisión infra persistida: clasificación por titular
        if not _zone_title_ok(n):
            continue
        text = norm_txt(n.title)
        if any(p.search(text) for p in own_res):
            named.append(pair)
        elif not any(p.search(text) for p in other_res):
            zone.append(pair)
        # nombra otro punto concreto → fuera de esta ficha
    summary = None
    if named:
        causes = list(
            dict.fromkeys(c for n, _ in named if (c := infra_cause_of(n)))
        )
        summary = {"named_count": len(named), "causes": causes[:3]}
    return (
        named,
        zone,
        summary,
        {
            "named": news_by_year_family(named),
            "zone": news_by_year_family(zone),
        },
    )


# Ventana del agregado de episodios: misma convención que la ficha de
# playa ("los últimos 5 años")
EPISODE_YEARS = 5


def gather_nearby_episodes(
    db, outfall, radius_m: int = 2000, years: int = EPISODE_YEARS
) -> OutfallEpisodesOut | None:
    """Episodios de contaminación en playas del entorno — contexto de
    la ficha del emisario (Hito 11.3); la proximidad NUNCA implica
    causalidad.

    Cuenta episodios fusionados (actas oficiales + reconstruidos por
    analítica/prensa) cuya causa es de la familia agua
    (CONTAMINATION_CAUSES) en los últimos `years` años, agregados por
    playa base. `None` en puntos no residuales — sin sección, igual
    que la prensa."""
    if "residual" not in (outfall.nature or "").lower():
        return None
    from sqlalchemy.orm import selectinload

    from app.queries import CONTAMINATION_CAUSES

    # Import local: routers.beaches carga FastAPI y medio backend;
    # share_context hace lo mismo con beach_incidents
    from app.routers.beaches import _collect_episodes, _merged_episode_rows

    outfall_geog = cast(literal(outfall.geom, type_=Geometry), Geography)
    beaches = (
        db.query(Beach)
        .options(
            selectinload(Beach.incidents),
            selectinload(Beach.measurements),
            selectinload(Beach.news_items),
        )
        .filter(
            func.ST_DWithin(Beach.geom.cast(Geography), outfall_geog, radius_m)
        )
        .all()
    )
    if not beaches:
        return OutfallEpisodesOut()
    today = date.today()
    cutoff = today - timedelta(days=365 * years)
    rows = [
        r
        for r in _merged_episode_rows(
            _collect_episodes(beaches, today, include_measurement=True)
        )
        if r.cause in CONTAMINATION_CAUSES and r.opened_at >= cutoff
    ]
    by_beach: dict[tuple[str | None, str | None], dict] = {}
    for r in rows:
        b = by_beach.setdefault(
            (r.beach_name, r.municipality),
            {
                "beach_id": r.beach_id,
                "name": r.beach_name,
                "municipality": r.municipality,
                "episodes": 0,
                "closures": 0,
                "last": None,
            },
        )
        b["episodes"] += 1
        b["closures"] += r.kind == "closure"
        if b["last"] is None or r.opened_at > b["last"]:
            b["last"], b["beach_id"] = r.opened_at, r.beach_id
    return OutfallEpisodesOut(
        total=len(rows),
        closures=sum(r.kind == "closure" for r in rows),
        last=max((r.opened_at for r in rows), default=None),
        beaches=[
            OutfallEpisodeBeachOut(**b)
            for b in sorted(
                by_beach.values(),
                key=lambda x: (-x["episodes"], x["name"] or ""),
            )
        ],
    )

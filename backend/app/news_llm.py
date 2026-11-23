"""Extracción de eventos de playa desde titulares de prensa (Hito 8.5).

`extract_event(article)` es la interfaz estable — devuelve un
`EventExtraction` o None si el proveedor falló (el artículo se reintenta
en la siguiente pasada). La implementación de referencia es
`GeminiExtractor`: Gemini Flash free tier vía REST, salida JSON forzada
por esquema y thinking desactivado. Cambiar de proveedor = otra clase
con el mismo método `extract`.
"""

import json
import logging
import re
import time
from dataclasses import dataclass, replace
from typing import Any, Protocol

import requests

from app.config import settings
from app.news_sources import RawArticle

log = logging.getLogger(__name__)


@dataclass
class EventExtraction:
    relevant: bool
    confidence: float
    beach_name: str | None = None
    municipality: str | None = None
    # closure | reopening | resolved | warning | pollution | other
    event_type: str | None = None
    cause: str | None = None
    # Alcance del cierre (solo event_type='closure'): whole | partial |
    # access_point | facility. None se trata como 'whole'
    scope: str | None = None
    # Inicio real del evento según el texto ("cerrada desde julio de
    # 2024" → "2024-07"), no la fecha de publicación. ISO parcial
    closed_since: str | None = None
    # El texto afirma que el cierre/prohibición declarado NUNCA se
    # ejecutó en la playa ("sigue abierta al baño", "sin que se haya
    # cerrado"): el cierre existió en el registro, no en la arena
    closure_not_enforced: bool | None = None
    # Cita literal comprobada contra el texto enviado, no una explicación
    # inventada por el modelo. Se conserva para poder revisar la decisión.
    evidence_quote: str | None = None


class NewsExtractor(Protocol):
    def extract(
        self,
        article: RawArticle,
        prompt: str | None = None,
        candidates: list | None = None,
    ) -> EventExtraction | None: ...


_CAUSE_REWRITES: tuple[tuple[re.Pattern, str], ...] = (
    # El parámetro es siempre "E. coli" — el modelo alterna grafías
    # ("Escherichia coli", "E-coli", "niveles de E. Coli") que son
    # ruido en la ficha y en la cola de revisión
    (
        re.compile(r"escherichia\s+coli|\be[\s.\-]*coli\b", re.IGNORECASE),
        "E. coli",
    ),
    # Raíz "enterococ-": enterococos/enterococo terminan en -o/-os,
    # enterococcus lleva -cus
    (
        re.compile(
            r"enterococos\s+intestinales|enterococ(?:cus|os?)\b",
            re.IGNORECASE,
        ),
        "enterococos",
    ),
    # "210 ufc/100 ml" → "210 UFC/100 mL" (el número se conserva)
    (re.compile(r"ufc\s*/\s*100\s*m\.?l\.?", re.IGNORECASE), "UFC/100 mL"),
    (re.compile(r"\bufc\b", re.IGNORECASE), "UFC"),
    # "E. coli (E. coli)" — paréntesis redundante tras canonizar
    (re.compile(r"\b(E\. coli|enterococos)\s*\(\1\)", re.IGNORECASE), r"\1"),
)

# Lista de organismos: "bacterias fecales, Enterococos y E. coli" es lo
# mismo que "E. coli y enterococos" — las etiquetas vacías ("bacterias",
# "contaminación fecal") no añaden nada cuando el organismo ya está
# nombrado. Solo colapsa si TODA la causa son organismos y etiquetas:
# "E. coli y vertido de aguas residuales" conserva el vertido porque
# aporta información que no es un organismo
_CAUSE_TOKEN_FILLER = re.compile(
    r"^(?:bacterias?|contaminaci[óo]n)(?:\s+fecales?)?$", re.IGNORECASE
)
_CAUSE_TOKEN_PREFIX = re.compile(
    r"^(?:bacterias?|contaminaci[óo]n)(?:\s+fecales?)?\s+", re.IGNORECASE
)
_CAUSE_ORGANISM = re.compile(
    r"^\(?\s*(E\. coli|enterococos)\s*\)?$", re.IGNORECASE
)
_CAUSE_ORGANISM_DISPLAY = {"e. coli": "E. coli", "enterococos": "enterococos"}


def _collapse_organism_list(s: str) -> str:
    parts = [p for p in re.split(r"[,;]|\s+y\s+|\s+e\s+", s) if p.strip()]
    found = []
    for part in parts:
        token = part.strip()
        if _CAUSE_TOKEN_FILLER.match(token):
            continue
        m = _CAUSE_ORGANISM.match(_CAUSE_TOKEN_PREFIX.sub("", token))
        if not m:
            return s
        found.append(m.group(1).lower())
    if not found:
        return s
    return " y ".join(_CAUSE_ORGANISM_DISPLAY[o] for o in sorted(set(found)))


# Envolturas vacías que solo admiten colapsar si el organismo es TODO
# lo que queda: "niveles de E. coli" → "E. coli", pero "niveles de
# E. coli superiores a lo permitido" conserva su matiz
_CAUSE_FILLER_RE = re.compile(
    r"^(?:altos\s+|elevados\s+)?"
    r"(?:niveles|presencia|concentraci[óo]n|exceso|[íi]ndices|valores)"
    r"\s+de\s+(?=(?:E\. coli|enterococos)\s*$)",
    re.IGNORECASE,
)


def canonicalize_cause(cause: str | None) -> str | None:
    """Causa en forma canónica: mismo hecho, una sola redacción.

    La extracción elige cada vez una grafía distinta para el mismo
    parámetro; normalizarla evita fichas inconsistentes y reviews
    que solo difieren en la escritura."""
    if not cause:
        return cause
    s = cause.strip()
    for pattern, repl in _CAUSE_REWRITES:
        s = pattern.sub(repl, s)
    s = _CAUSE_FILLER_RE.sub("", s)
    s = re.sub(r"\s+", " ", s).strip()
    return _collapse_organism_list(s)


SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "relevant": {"type": "BOOLEAN"},
        "beach_name": {"type": "STRING", "nullable": True},
        "municipality": {"type": "STRING", "nullable": True},
        "event_type": {"type": "STRING", "nullable": True},
        "cause": {"type": "STRING", "nullable": True},
        "scope": {"type": "STRING", "nullable": True},
        "closed_since": {"type": "STRING", "nullable": True},
        "closure_not_enforced": {"type": "BOOLEAN", "nullable": True},
        "confidence": {"type": "NUMBER"},
        "evidence_quote": {"type": "STRING", "nullable": True},
    },
    "required": ["relevant", "confidence"],
}

# ISO parcial: "2024", "2024-07" o "2024-07-15" — nada más se acepta
_CLOSED_SINCE_RE = re.compile(r"^\d{4}(-\d{2})?(-\d{2})?$")
BODY_LIMIT = 6000


def literal_evidence(quote: object, article: RawArticle) -> str | None:
    """Solo admite citas presentes en el texto que realmente vio el modelo."""
    if not isinstance(quote, str) or not 12 <= len(quote) <= 1000:
        return None

    def normalize(s: str) -> str:
        return " ".join(s.split()).casefold()

    needle = normalize(quote)
    if any(
        needle in normalize(text)
        for text in (article.title, (article.body or "")[:BODY_LIMIT])
    ):
        return quote.strip()
    return None


# Palabras de modalidad/futuro: un cierre anunciado o en estudio no es un
# evento efectivo ("estudia cerrar", "podría cerrar", "para reabrir").
_MODAL_WORDS = (
    r"estudia\w*|estudian|planea\w*|prev[ée]\w*|prever|podrí\w*|posible|"
    r"pretend\w*|valor\w*|intenci[óo]n|proyecto|a punto de|a la espera|"
    r"para|antes de"
)
# Futuro en la propia palabra marcada: "cerrará", "reabrirán" no son hechos.
_FUTURE_SUFFIX = r"(?:rar|rir)[áa]n?$"
# Verbos que invierten el sentido: "retirada la bandera roja" NO prueba un
# cierre aunque contenga "bandera roja". Se comprueban igual que la modalidad.
_REVERSE_WORDS = r"retir\w*|levant\w*|baj\w*|quit\w*|elimin\w*|levantan"
# Referencias genéricas a la playa/baño para la comprobación del cuerpo.
_BEACH_REFS = (
    r"la playa|las playas|el baño|al baño|del baño|el litoral|"
    r"zona de baño|el arenal|la cala|piscina natural|charco"
)


def _grounded(pattern: str, text: str, anti: str = "") -> bool:
    """Un marcador prueba el evento salvo modalidad, futuro o dirección
    contraria (`anti`: "retirada la bandera roja" no prueba un cierre)."""
    for m in re.finditer(pattern, text, re.IGNORECASE):
        word = re.match(r"\w+", text[m.start() :])
        if word and re.search(_FUTURE_SUFFIX, word.group(0), re.IGNORECASE):
            continue
        before = text[max(0, m.start() - 80) : m.start()]
        if re.search(
            rf"(?:{_MODAL_WORDS})(?:\W+\w+){{0,4}}\W*$", before, re.IGNORECASE
        ):
            continue
        if anti and re.search(
            rf"(?:{anti})(?:\W+\w+){{0,4}}\W*$", before, re.IGNORECASE
        ):
            continue
        return True
    return False


def _body_supports(
    pattern: str, body: str, beach_key: str, anti: str = ""
) -> bool:
    """Una frase del cuerpo prueba el evento si nombra la playa o el baño.

    El cuerpo entero no vale: San Marcos mencionaba una avenida cerrada.
    Exigir la referencia a playa en la MISMA frase descarta ese caso.
    """
    refs = _BEACH_REFS
    key = " ".join(
        w
        for w in (beach_key or "").casefold().split()
        if w not in {"playa", "de", "del", "el", "la", "los", "las", "en"}
    )
    if key:
        refs = re.escape(key) + "|" + refs
    for sent in re.split(r"(?<=[.!?])\s+|\n+", body):
        if re.search(refs, sent, re.IGNORECASE) and _grounded(
            pattern, sent, anti
        ):
            return True
    return False


def supported_event(
    ext: EventExtraction, title: str = "", body: str = ""
) -> EventExtraction:
    """Una afirmación de cierre/reapertura sin cita no decide el estado.

    Se conserva como contexto; la falta de cita nunca borra una noticia.
    La reextracción histórica retiene esta propuesta para revisión.
    El titular también sirve de evidencia: es texto que el modelo vio y
    suele afirmar el evento aunque la cita elegida no repita el verbo.
    Del cuerpo solo prueban frases que nombran la playa o el baño:
    San Marcos mencionaba una avenida cerrada, no la playa.
    """
    # Es una condición necesaria, no un verificador semántico completo.
    # "Encara el camino de regreso" es una cita literal pero no prueba cierre.
    markers = {
        "closure": r"cerr(?:ar|ad[oa]s?|ó)|cierr[ae]|clausur|precint|"
        r"prohib|bandera\s+roja|no\s+(?:está|se)\s+permit",
        "reopening": r"\breabr(?:e|en|ió|ieron)\b|reabiert|reapertur|"
        r"abier\w*\s+al\s+bañ|abrir\s+al\s+bañ|vuelve\s+a\s+abrir|"
        r"(?:retir|levant|baj)\w*.{0,50}(?:prohibici|restricci|bandera)|"
        r"autoriz\w*.{0,30}(?:baño|bano)",
        # "episodio resuelto sin cierre": la cita debe afirmar la
        # no-ejecución o la normalización, si no cae a 'other'
        "resolved": r"no\s+se\s+cerr|sigui\w+\s+abiert|manteni\w*\s+abiert|"
        r"mantuv\w*\s+abiert|sin\s+cerrar|no\s+decret|no\s+lleg\w*\s+a\s+cerrar|"
        r"normaliz|se\s+resolvi|resuelt",
    }
    pattern = markers.get(ext.event_type or "")
    if not pattern:
        return ext
    # "retirada la bandera roja" contiene "bandera roja" pero no es cierre.
    anti = _REVERSE_WORDS if ext.event_type == "closure" else ""
    if _grounded(pattern, f"{ext.evidence_quote or ''}\n{title}", anti):
        return ext
    if _body_supports(pattern, body, ext.beach_name or "", anti):
        return ext
    return replace(
        ext,
        event_type="other",
        scope=None,
        closed_since=None,
        closure_not_enforced=None,
    )


PROMPT = """\
Eres un extractor de eventos para una app que monitoriza el estado de las
playas de Tenerife. Te paso un titular de prensa, su medio y, cuando lo
hay, un extracto del cuerpo de la noticia.

Decide si informa de un evento concreto que afecta a una playa concreta
de Tenerife: cierre, reapertura, contaminación, aviso de calidad del
agua, vertido, prohibición de baño, etc.

Marca relevant=false cuando:
- la playa no está en Tenerife (otras islas, península, extranjero)
- es opinión/reportaje genérico sin evento concreto
- habla de apps, webs, mapas o servicios sobre playas (meta-noticia)
- la playa no se nombra de forma identificable
- es un estado rutinario sin evento ("calidad del agua hoy en tu playa")
- la norma citada es general (prohibido fumar, horarios) sin incidencia del agua
- el titular NIEGA que el problema EXISTIÓ ("descartan un vertido",
  "desmienten la contaminación", "no hay evidencia de") — presta
  especial atención a estas negaciones: el titular puede contener la
  palabra del problema ("vertido", "contaminación") pero decir justo
  lo contrario. OJO: si el suceso SÍ existió, la negación NO lo
  descarta:
  · "detectan E. coli y no se cerró", "se normalizó sin cierre" →
    el motivo era real pero nadie actuó — la no-ejecución ES la
    noticia → relevant=true, event_type="resolved"
  · "mancha de algas, Sanidad descarta vertido" → el fenómeno es
    real aunque no fuera contaminación → relevant=true, "other"
- lo que cierra o se restringe es un servicio anexo y NO el baño:
  aparcamiento por aforo completo, chiringuito, paseo marítimo,
  duchas. Si el texto dice que la playa o el baño siguen abiertos,
  relevant=false — p.ej. "cierran el parking de la playa por aforo"
- el cierre es por AFORO, OCUPACIÓN o ACCESO DE VEHÍCULOS, no por el
  agua ni por riesgo físico: "cierran la playa por alta ocupación",
  "cerrado el acceso por aforo completo", "cierre por masificación",
  restricciones COVID de capacidad. Es gestión de visitantes, no un
  episodio de calidad del agua ni de seguridad del baño → relevant=false
  (aunque el titular diga literalmente "cierran la playa")

PERO OJO: un titular que AFIRMA que la playa sigue cerrada o afectada
HOY es relevant=true aunque el encuadre sea retrospectivo, de denuncia
o político — el cierre vigente ES el evento: "la playa cumple 13 años
cerrada", "crece el malestar por el cierre", "siete playas siguen
clausuradas por desprendimientos", "piden verla solo de lejos". Lo que
no vale es historia pura sin afirmación del estado actual: "un año del
cierre de...", "el verano de los cierres", aniversarios o balances que
no dicen si sigue cerrada hoy.

Si relevant=true extrae:
- beach_name: nombre de la playa tal como aparece en el titular. Si
  el texto nombra la cala o zona concreta afectada dentro de un
  complejo ("Playa Grande" dentro de "Playa Jardín"), usa la cala,
  no el nombre genérico. Las playas o zonas de episodios ANTERIORES
  citadas como historia ("el pasado 3 de septiembre…") no forman
  parte del evento actual: no las incluyas.
  Si el evento actual afecta a VARIAS playas distintas (no calas de
  un mismo complejo, sino playas separadas — incluso en municipios
  distintos), devuélvelas TODAS separadas por " y " o comas:
  "El Socorro y El Médano". Solo playas del evento actual
- municipality: municipio de Tenerife SOLO si se menciona en el titular;
  nunca lo deduzcas por la playa (hay playas homónimas en varios
  municipios: "El Cabezo" existe en Güímar, Granadilla y Adeje)
- event_type: "closure" | "reopening" | "resolved" | "warning" |
  "pollution" | "other"
  · "resolved": el episodio terminó SIN que se ejecutara el cierre que
    el motivo exigía — había motivo formal documentado (muestra sobre
    el límite, positivo confirmado) pero el texto afirma que la playa
    siguió abierta o que el episodio se resolvió sin cierre ("detectan
    E. coli y la playa no se cerró", "se normalizó antes de cualquier
    prohibición"). NO es una reapertura: nunca llegó a cerrarse
  · "reopening" SOLO si la playa YA está abierta de nuevo al baño.
    Obras autorizadas, anunciadas o en curso "para reabrir" no son
    reapertura → "other" (p.ej. "Costas autoriza obras para reabrir el
    acceso" = other, no reopening)
  · igual para "closure": anuncios de futuros cierres u obras son "other"
  · análisis político, balance o retrospectiva sobre cierres PASADOS
    ("achaca a episodios puntuales el cierre de playas", "el verano de
    los cierres", "un año del cierre de...") no es un cierre nuevo →
    "other"; solo vale "closure" si el texto afirma explícitamente que
    la playa SIGUE cerrada hoy
- scope: SOLO cuando event_type="closure" — qué cerró exactamente:
  · "whole": la playa NO se puede usar — prohibición de baño, clausura
    total de la playa, o corte de su ÚNICO acceso. Calas escondidas,
    barrancos y playas cuya única entrada es una escalera o sendero de
    bajada: "cierran el acceso a la playa de Los Patos/Benijo" = whole
    (cerrar la entrada = cerrar la playa). Si el texto habla de "el
    acceso" en singular como LA vía de bajada → whole
  · "partial": un tramo o zona queda acotado e inaccesible, pero el
    resto de la playa sigue abierta y usable ("cierran el último
    tramo", "acotan la zona sur")
  · "access_point": SOLO se cerró un acceso concreto (una escalera,
    bajada o entrada vallada) en una playa urbana o con varias
    entradas, y la zona sigue siendo accesible por otros puntos —
    la playa NO está cerrada
  · "facility": lo cerrado es una instalación anexa y no la playa:
    charco, piscina natural, sendero, paseo marítimo
  El scope se mide respecto al punto afectado, no respecto al
  complejo: si la cala o zona nombrada cerró entera ("prohíben el
  baño en Playa Grande"), es whole aunque sea parte de un complejo
  mayor ("Playa Jardín"). En la duda entre "whole" y un alcance
  menor, elige el menor. null para otros event_type
- cause: la RAZÓN del cierre/aviso para el bañista — el evento que
  afectó al agua o al acceso ("vertido de aguas residuales",
  "bacterias fecales", "gasoil", "riesgo de desprendimientos",
  "temporal de mar", "obras EN la playa").
  La causa es el evento, no el origen upstream de la avería que lo
  provocó: "obstrucción de la red de saneamiento que causó un vertido"
  → "vertido"; "rotura de tubería que vertió al mar" → "vertido".
  Si el texto nombra el parámetro o la sustancia concreta medida
  (E. coli, Escherichia coli, enterococos, gasoil, microalgas...),
  nómbrala en la causa — "niveles de E. coli" y no "bacterias
  fecales"; la etiqueta visible debe ser lo más específica que el
  texto permita. La causa puede proceder del TITULAR aunque la
  evidence_quote salga del cuerpo: toma la formulación más específica
  de todo el texto suministrado (titular incluido); no la degrades a
  la fórmula institucional de la frase que uses como cita. Si el
  texto da la cifra medida, inclúyela:
  "E. coli >800 UFC/100 mL", "enterococos 410 UFC/100 mL". Si cita
  varios parámetros, nómbralos TODOS: "E. coli y enterococos".
  NO son causa:
  · el propio cierre y su mecanismo ("acceso prohibido", "cierre de
    acceso", "vallado", "multas", "desalojo") — eso ES el cierre → null
  · la gestión posterior ("obras de emergencia", "rehabilitación",
    "proceso de emergencia") — es la respuesta al problema → null,
    salvo que el texto nombre la razón real (úsala)
  Si el texto no indica la razón → null.
- closed_since: SOLO para closure/warning/pollution VIGENTES, cuando
  el texto dice desde cuándo está realmente cerrada o afectada la
  playa — distinto de cuándo se publica la noticia. Ejemplos:
  "cerrada desde julio de 2024" → "2024-07"; "clausurada en 2024" →
  "2024"; "lleva cerrada desde el lunes 15" → "YYYY-MM-DD" si la
  fecha es deducible. Relativos ("este miércoles", "ayer", "la semana
  pasada") se resuelven contra la FECHA DE PUBLICACIÓN — nunca
  inventes el año. ISO parcial: YYYY, YYYY-MM o YYYY-MM-DD según
  la precisión que afirme el texto. Si el cierre ya quedó en el
  pasado ("estuvo cerrada en 2024 pero reabrió") no uses
  closed_since: marca event_type según el estado actual del texto
  (reopening si ya está abierta, other si es mera historia). Si no se
  indica → null
- closure_not_enforced: TRUE solo cuando el texto afirma que la playa
  SIGUIÓ ABIERTA pese a un cierre o prohibición declarado — la
  autoridad no llegó a ejecutarlo ("sigue abierta al baño", "sin que
  se haya cerrado", "no llegó a cerrarse", "permaneció abierta", "el
  ayuntamiento no la cerró"). Es una afirmación fuerte contra el
  registro oficial: exige que el texto lo diga explícitamente, no
  basta con que no se mencione el cierre. null en cualquier otro caso
- confidence: 0-1, confianza en que el titular describe ese evento en esa playa
"""

# Se evalúa primero en la auditoría: exigir la cita puede reducir cobertura.
# La ingesta conserva PROMPT hasta validar la candidata con casos reales.
EVIDENCE_PROMPT = (
    PROMPT
    + """
- evidence_quote: copia una frase LITERAL del titular o del cuerpo suministrado
  que justifique el evento y su alcance. No la reformules ni completes.
  Para closure/reopening es obligatoria: debe afirmar el cierre/prohibición
  o la reapertura YA efectiva de la playa identificada, o de su acceso.
  Prefiere la frase más corta que contenga la acción del evento (cerrar,
  precintar, prohibir, reabrir, retirar la bandera roja, abrir al baño);
  el propio titular puede ser la cita si la afirma.
  Un desprendimiento cerca de una playa no demuestra que se haya cerrado.
  "Una avenida se cerró en 2023" no prueba un cierre actual de la playa.
  Distingue la playa del paseo, aparcamiento, barranco o charco.
  Una promesa de reabrir no demuestra reapertura: conserva el contexto
  como other. Si no hay frase que justifique closure/reopening, no asignes
  esos tipos; usa other si hay contexto útil, o relevant=false si no lo hay.
  En artículos con varias playas no traslades el evento, la causa ni el
  alcance de una a otra. Si no puedes separar los hechos, usa other.
  La cita no necesita repetir la causa: si esta no se indica, cause=null.
  Devuelve siempre evidence_quote (null si no procede). Si usas el titular,
  cópialo tal como se ha suministrado, sin corregir sus comillas ni palabras.
  Cuando hay cuerpo, el nombre de playa y municipio pueden proceder del
  cuerpo, siempre de forma explícita; no los inventes por conocimiento externo.
"""
)


class GeminiExtractor:
    def __init__(
        self,
        api_key: str,
        model: str,
        fallback_model: str | None = None,
        require_evidence: bool = False,
    ) -> None:
        base = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            "{}:generateContent"
        )
        self.url = base.format(model)
        self.fallback_url = (
            base.format(fallback_model) if fallback_model else None
        )
        self.api_key = api_key
        self.last_error: str | None = None
        self.failures = 0
        self.require_evidence = require_evidence

    def _post(self, text: str):
        """Una petición acotada y un reintento corto para fallos transitorios.

        El caller también prueba el respaldo ante timeout/5xx, no solo
        ante cuota diaria. Nunca registra URLs con claves ni cuerpos HTTP.
        """
        # los modelos -lite no aceptan thinkingConfig
        gen_cfg: dict[str, Any] = {
            "responseMimeType": "application/json",
            "responseSchema": (
                {**SCHEMA, "required": [*SCHEMA["required"], "evidence_quote"]}
                if self.require_evidence
                else SCHEMA
            ),
        }
        if "-lite" not in self.url:
            gen_cfg["thinkingConfig"] = {"thinkingBudget": 0}
        resp = None
        for attempt in range(2):
            try:
                resp = requests.post(
                    self.url,
                    headers={
                        "x-goog-api-key": self.api_key,
                        "Content-Type": "application/json",
                    },
                    json={
                        "contents": [{"parts": [{"text": text}]}],
                        "generationConfig": gen_cfg,
                    },
                    timeout=(5, 20),
                )
            except requests.RequestException as exc:
                self.last_error = type(exc).__name__
                resp = None
            else:
                if resp.ok:
                    self.last_error = None
                    return resp
                self.last_error = f"HTTP {resp.status_code}"
                if resp.status_code not in (429, 500, 502, 503, 504):
                    return resp
                if resp.status_code == 429:
                    return resp
            if attempt == 0:
                time.sleep(1)
        return resp

    def extract(
        self,
        article: RawArticle,
        prompt: str | None = None,
        candidates: list | None = None,
    ) -> EventExtraction | None:
        # prompt alternativo para la segunda vía de extracción
        # (Hito 11.2, PROMPT_INFRA en news_infra); por defecto el de
        # playas
        text = (
            prompt or (EVIDENCE_PROMPT if self.require_evidence else PROMPT)
        ) + (f'\nTitular: "{article.title}"\nMedio: "{article.source or ""}"')
        if article.published_at:
            # Ancla temporal: "este miércoles"/"ayer" se resuelven con
            # la fecha real de la noticia — sin ella el modelo inventa
            # el año en closed_since
            text += f"\nFecha de publicación: {article.published_at:%Y-%m-%d}"
        if article.body:
            text += f'\nTexto de la noticia (extracto):\n"{article.body[:BODY_LIMIT]}"'
        if candidates:
            lines = "\n".join(
                f'- "{b.name}" ({b.municipality})'
                + (
                    " — piscina natural/charco (el punto ES la instalación)"
                    if re.search(r"PISCINA|CHARCO", b.name, re.IGNORECASE)
                    else ""
                )
                for b in candidates
            )
            text += (
                "\n\nPuntos monitorizados del censo que el filtro léxico "
                "ve en el texto — pueden ser varios, uno o ninguno:\n"
                + lines
                + "\nSi la noticia trata de un punto del censo, ES un "
                "punto de baño aunque sea piscina natural o charco: su "
                "cierre o reapertura es relevant y, si afecta a todo el "
                "punto, scope=whole — facility solo cuando lo cerrado es "
                "anexo a un punto distinto (paseo, acceso, chiringuito). "
                "Si ninguno casa, extrae beach_name del texto igualmente."
            )
        resp = self._post(text)
        # Ante indisponibilidad del principal el resto de esta pasada
        # usa el respaldo. En la próxima pasada se prueba el principal.
        if (
            (resp is None or resp.status_code in (429, 500, 502, 503, 504))
            and self.fallback_url
            and self.url != self.fallback_url
        ):
            log.warning(
                "Gemini principal no disponible (%s); probando respaldo",
                self.last_error,
            )
            self.url = self.fallback_url
            resp = self._post(text)
        if resp is None or not resp.ok:
            self.failures += 1
            log.warning("Extracción Gemini fallida: %s", self.last_error)
            return None
        try:
            body = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
            data = json.loads(body)
            # Campos acotados por el esquema de news_items: un valor que
            # los excede es salida malformada (p.ej. razonamiento del
            # modelo colado en el JSON) → se descarta, no se persiste
            for key, limit in (
                ("beach_name", 255),
                ("municipality", 120),
                ("event_type", 20),
                ("scope", 20),
                ("closed_since", 10),
            ):
                v = data.get(key)
                if isinstance(v, str) and len(v) > limit:
                    self.last_error = f"campo demasiado largo: {key}"
                    self.failures += 1
                    return None
            closed_since = data.get("closed_since")
            if closed_since is not None and not _CLOSED_SINCE_RE.match(
                str(closed_since)
            ):
                closed_since = None
            # closed_since solo tiene sentido en eventos de cierre/
            # afectación; una reapertura o un "other" que lo traiga es
            # ruido del modelo → se descarta
            if data.get("event_type") not in (
                "closure",
                "warning",
                "pollution",
                "infra",
            ):
                closed_since = None
            scope = data.get("scope")
            # scope solo acompaña a un cierre; además se acota a los
            # valores del vocabulario — cualquier otra cosa es ruido
            if data.get("event_type") != "closure" or scope not in (
                "whole",
                "partial",
                "access_point",
                "facility",
            ):
                scope = None
            cne = data.get("closure_not_enforced")
            return EventExtraction(
                relevant=bool(data["relevant"]),
                confidence=float(data.get("confidence") or 0.0),
                beach_name=data.get("beach_name"),
                municipality=data.get("municipality"),
                event_type=data.get("event_type"),
                cause=canonicalize_cause(data.get("cause")),
                scope=scope,
                closed_since=closed_since,
                closure_not_enforced=cne if isinstance(cne, bool) else None,
                evidence_quote=literal_evidence(
                    data.get("evidence_quote"), article
                ),
            )
        except (
            json.JSONDecodeError,
            KeyError,
            IndexError,
            TypeError,
            ValueError,
        ):
            self.last_error = "respuesta JSON inválida"
            self.failures += 1
            log.warning("Extracción Gemini fallida: %s", self.last_error)
            return None


def extract_event(
    article: RawArticle,
    extractor: NewsExtractor | None = None,
    candidates: list | None = None,
) -> EventExtraction | None:
    """Extrae el evento de playa de un titular. None si el proveedor
    falla (el artículo se reintenta en la siguiente pasada).
    `candidates` son los puntos del censo que el matching léxico ve en
    el texto — contexto para que el modelo sepa que la piscina o el
    charco nombrado ES un punto monitorizado."""
    if extractor is None:
        extractor = GeminiExtractor(
            api_key=settings.gemini_api_key or "",
            model=settings.gemini_model,
            fallback_model=settings.gemini_fallback_model,
        )
    return extractor.extract(article, candidates=candidates)

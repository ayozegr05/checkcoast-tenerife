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

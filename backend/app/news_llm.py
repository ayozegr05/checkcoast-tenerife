"""Extracción de eventos de playa desde titulares de prensa (Hito 8.5).

`extract_event(article)` es la interfaz estable — devuelve un
`EventExtraction` o None si el proveedor falló (el artículo se reintenta
en la siguiente pasada). La implementación de referencia es
`GeminiExtractor`: Gemini Flash free tier vía REST, salida JSON forzada
por esquema y thinking desactivado. Cambiar de proveedor = otra clase
con el mismo método `extract`.
"""

import json
import time
from dataclasses import dataclass
from typing import Protocol

import requests

from app.config import settings
from app.news_sources import RawArticle


@dataclass
class EventExtraction:
    relevant: bool
    confidence: float
    beach_name: str | None = None
    municipality: str | None = None
    # closure | reopening | warning | pollution | other
    event_type: str | None = None
    cause: str | None = None


class NewsExtractor(Protocol):
    def extract(self, article: RawArticle) -> EventExtraction | None: ...


SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "relevant": {"type": "BOOLEAN"},
        "beach_name": {"type": "STRING", "nullable": True},
        "municipality": {"type": "STRING", "nullable": True},
        "event_type": {"type": "STRING", "nullable": True},
        "cause": {"type": "STRING", "nullable": True},
        "confidence": {"type": "NUMBER"},
    },
    "required": ["relevant", "confidence"],
}

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

Si relevant=true extrae:
- beach_name: nombre de la playa tal como aparece en el titular
- municipality: municipio de Tenerife SOLO si se menciona en el titular;
  nunca lo deduzcas por la playa (hay playas homónimas en varios
  municipios: "El Cabezo" existe en Güímar, Granadilla y Adeje)
- event_type: "closure" | "reopening" | "warning" | "pollution" | "other"
  · "reopening" SOLO si la playa YA está abierta de nuevo al baño.
    Obras autorizadas, anunciadas o en curso "para reabrir" no son
    reapertura → "other" (p.ej. "Costas autoriza obras para reabrir el
    acceso" = other, no reopening)
  · igual para "closure": anuncios de futuros cierres u obras son "other"
- cause: la RAZÓN de fondo del cierre/aviso — lo que provocó el problema
  ("vertido de aguas residuales", "bacterias fecales", "gasoil",
  "riesgo de desprendimientos", "temporal de mar", "obras EN la playa").
  NO son causa:
  · el propio cierre y su mecanismo ("acceso prohibido", "cierre de
    acceso", "vallado", "multas", "desalojo") — eso ES el cierre → null
  · la gestión posterior ("obras de emergencia", "rehabilitación",
    "proceso de emergencia") — es la respuesta al problema → null,
    salvo que el texto nombre la razón real (úsala)
  Si el texto no indica la razón → null.
- confidence: 0-1, confianza en que el titular describe ese evento en esa playa
"""


class GeminiExtractor:
    def __init__(self, api_key: str, model: str) -> None:
        self.url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent"
        )
        self.api_key = api_key

    def extract(self, article: RawArticle) -> EventExtraction | None:
        text = PROMPT + (
            f'\nTitular: "{article.title}"\nMedio: "{article.source or ""}"'
        )
        if article.body:
            text += f'\nTexto de la noticia (extracto):\n"{article.body[:3000]}"'
        resp = None
        for attempt in range(4):
            try:
                resp = requests.post(
                    self.url,
                    headers={
                        "x-goog-api-key": self.api_key,
                        "Content-Type": "application/json",
                    },
                    json={
                        "contents": [{"parts": [{"text": text}]}],
                        "generationConfig": {
                            "responseMimeType": "application/json",
                            "responseSchema": SCHEMA,
                            "thinkingConfig": {"thinkingBudget": 0},
                        },
                    },
                    timeout=60,
                )
            except requests.RequestException:
                resp = None
                time.sleep(10 * (attempt + 1))
                continue
            if resp.status_code not in (429, 500, 503):
                break
            time.sleep(10 * (attempt + 1))
        if resp is None or not resp.ok:
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
            ):
                v = data.get(key)
                if isinstance(v, str) and len(v) > limit:
                    return None
            return EventExtraction(
                relevant=bool(data["relevant"]),
                confidence=float(data.get("confidence") or 0.0),
                beach_name=data.get("beach_name"),
                municipality=data.get("municipality"),
                event_type=data.get("event_type"),
                cause=data.get("cause"),
            )
        except (json.JSONDecodeError, KeyError, IndexError, TypeError, ValueError):
            return None


def extract_event(
    article: RawArticle, extractor: NewsExtractor | None = None
) -> EventExtraction | None:
    """Extrae el evento de playa de un titular. None si el proveedor
    falla (el artículo se reintenta en la siguiente pasada)."""
    if extractor is None:
        extractor = GeminiExtractor(
            api_key=settings.gemini_api_key or "", model=settings.gemini_model
        )
    return extractor.extract(article)

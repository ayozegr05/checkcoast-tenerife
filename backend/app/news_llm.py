"""Extracción de eventos de playa desde titulares de prensa (Hito 8.5).

`extract_event(article)` es la interfaz estable — devuelve un
`EventExtraction` o None si el proveedor falló (el artículo se reintenta
en la siguiente pasada). La implementación de referencia es
`GeminiExtractor`: Gemini Flash free tier vía REST, salida JSON forzada
por esquema y thinking desactivado. Cambiar de proveedor = otra clase
con el mismo método `extract`.
"""

import json
import re
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
    # Inicio real del evento según el texto ("cerrada desde julio de
    # 2024" → "2024-07"), no la fecha de publicación. ISO parcial
    closed_since: str | None = None


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
        "closed_since": {"type": "STRING", "nullable": True},
        "confidence": {"type": "NUMBER"},
    },
    "required": ["relevant", "confidence"],
}

# ISO parcial: "2024", "2024-07" o "2024-07-15" — nada más se acepta
_CLOSED_SINCE_RE = re.compile(r"^\d{4}(-\d{2})?(-\d{2})?$")

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
- el titular NIEGA o DESCARTA el problema ("descartan un vertido",
  "desmienten la contaminación", "no hay evidencia de", "confirman que
  es un fenómeno natural") — presta especial atención a estas
  negaciones: el titular puede contener la palabra del problema
  ("vertido", "contaminación") pero decir justo lo contrario

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
- closed_since: SOLO para closure/warning/pollution VIGENTES, cuando
  el texto dice desde cuándo está realmente cerrada o afectada la
  playa — distinto de cuándo se publica la noticia. Ejemplos:
  "cerrada desde julio de 2024" → "2024-07"; "clausurada en 2024" →
  "2024"; "lleva cerrada desde el lunes 15" → "YYYY-MM-DD" si la
  fecha es deducible. ISO parcial: YYYY, YYYY-MM o YYYY-MM-DD según
  la precisión que afirme el texto. Si el cierre ya quedó en el
  pasado ("estuvo cerrada en 2024 pero reabrió") no uses
  closed_since: marca event_type según el estado actual del texto
  (reopening si ya está abierta, other si es mera historia). Si no se
  indica → null
- confidence: 0-1, confianza en que el titular describe ese evento en esa playa
"""


class GeminiExtractor:
    def __init__(
        self,
        api_key: str,
        model: str,
        fallback_model: str | None = None,
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

    def _post(self, text: str):
        """POST con retries ante 429/5xx. La cuota DIARIA agotada no se
        arregla esperando: se corta el retry en el primer 429 PerDay."""
        # los modelos -lite no aceptan thinkingConfig
        gen_cfg = {
            "responseMimeType": "application/json",
            "responseSchema": SCHEMA,
        }
        if "-lite" not in self.url:
            gen_cfg["thinkingConfig"] = {"thinkingBudget": 0}
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
                        "generationConfig": gen_cfg,
                    },
                    timeout=60,
                )
            except requests.RequestException:
                resp = None
                time.sleep(10 * (attempt + 1))
                continue
            if resp.status_code not in (429, 500, 503):
                break
            if resp.status_code == 429 and "PerDay" in resp.text:
                break
            time.sleep(10 * (attempt + 1))
        return resp

    def extract(self, article: RawArticle) -> EventExtraction | None:
        text = PROMPT + (
            f'\nTitular: "{article.title}"\nMedio: "{article.source or ""}"'
        )
        if article.body:
            text += f'\nTexto de la noticia (extracto):\n"{article.body[:3000]}"'
        resp = self._post(text)
        # Cuota diaria del modelo principal agotada → el resto de la
        # pasada va directo al fallback (cuota aparte por modelo)
        if (
            resp is not None
            and resp.status_code == 429
            and "PerDay" in resp.text
            and self.fallback_url
            and self.url != self.fallback_url
        ):
            self.url = self.fallback_url
            resp = self._post(text)
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
                ("closed_since", 10),
            ):
                v = data.get(key)
                if isinstance(v, str) and len(v) > limit:
                    return None
            closed_since = data.get("closed_since")
            if closed_since is not None and not _CLOSED_SINCE_RE.match(
                str(closed_since)
            ):
                closed_since = None
            return EventExtraction(
                relevant=bool(data["relevant"]),
                confidence=float(data.get("confidence") or 0.0),
                beach_name=data.get("beach_name"),
                municipality=data.get("municipality"),
                event_type=data.get("event_type"),
                cause=data.get("cause"),
                closed_since=closed_since,
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
            api_key=settings.gemini_api_key or "",
            model=settings.gemini_model,
            fallback_model=settings.gemini_fallback_model,
        )
    return extractor.extract(article)

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel


class PointGeometry(BaseModel):
    type: Literal["Point"] = "Point"
    coordinates: list[float]  # [lon, lat]


class Feature(BaseModel):
    type: Literal["Feature"] = "Feature"
    id: int
    geometry: PointGeometry
    properties: dict[str, Any]


class FeatureCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[Feature]


class BeachStatusIn(BaseModel):
    status: Literal["open", "closed", "warning"]
    source_url: str | None = None


class BeachStatusOut(BaseModel):
    beach_id: int
    beach_name: str
    status: str
    reported_at: datetime | None
    source_url: str | None


class NewsItemOut(BaseModel):
    id: int
    beach_id: int
    title: str
    url: str
    source: str | None
    published_at: datetime | None
    event_type: str | None
    cause: str | None


class BeachIncidentOut(BaseModel):
    id: int
    beach_id: int
    opened_at: date
    closed_at: date | None
    observations: str | None
    source_url: str | None
    # "official" = incidencia Náyade | "measurement" = ventana de
    # analítica prohibida sin incidencia | "press" = solo en prensa
    via: str = "official"
    # La ventana de analítica además la recogió la prensa — en la ficha
    # se muestra como CIERRE igual que uno oficial (fue real)
    press_confirmed: bool = False
    # closed_at es la última mención en prensa, no un cierre real —
    # la UI lo marca "~" en vez de mostrar duración exacta inventada
    end_estimated: bool = False
    # Titulares que sustentan o corroboran el episodio — la fila del
    # historial los despliega como evidencia ("según prensa")
    press_items: list[NewsItemOut] = []
    # El episodio (reconstruido por prensa, replicado a todos los PM
    # del arenal) en realidad corresponde al PM hermano con incidente
    # oficial solapado — la UI lo rotula "en el punto N"
    attributed_pm: str | None = None


class MunicipalityIncidentOut(BaseModel):
    id: int
    beach_id: int
    beach_name: str
    municipality: str | None
    kind: str  # "closure" (prohibición) | "warning" (resto)
    opened_at: date
    closed_at: date | None
    observations: str | None
    # "official" = incidencia Náyade | "measurement" = ventana de
    # analítica prohibida sin incidencia | "press" = solo en prensa
    via: str = "official"
    # Causa normalizada ("Contaminación", "Desprendimientos"...) — la
    # oficial se infiere de la prensa en ventana; un cierre de Sanidad
    # sin contexto es Contaminación por definición (solo mide agua)
    cause: str | None = None
    # closed_at = última mención en prensa (cota estimada), no cierre
    # corroborado — la UI lo marca "~"
    end_estimated: bool = False


class BeachMeasurementOut(BaseModel):
    id: int
    beach_id: int
    sampled_at: date
    ecoli: str | None
    enterococci: str | None
    evaluation: str | None
    source_url: str | None


class BeachStatsOut(BaseModel):
    beach_id: int
    closures: int  # incidentes con prohibición de baño
    warnings: int  # resto de incidentes
    closures_last_year: int
    bad_samples: int  # mediciones con evaluación "prohibido"
    # Evaluadas y NO aptas: "prohibido" + recomendación de no baño.
    # "Sin Calificar" no cuenta: Sanidad no pudo evaluar la muestra,
    # no afirma que el agua estuviera mal (ver is_ungraded_note)
    non_apta_samples: int = 0
    total_samples: int
    latest_evaluation: str | None
    latest_sampled_at: date | None
    # Episodios reconstruidos (analítica sin incidencia + cierres solo
    # en prensa): cuentan en el ranking pero no son BeachIncident
    reconstructed: int = 0
    # Conteo propio del PM, sin deduplicar entre hermanos: mismo
    # universo que la ficha (/beaches/{id}/incidents). Las playas
    # multi-PM (Playa Jardín) comparten la prensa replicada — cada
    # sub-fila de la lista muestra lo suyo
    own_closures: int = 0
    own_warnings: int = 0
    # Episodios de agua del PM: incidencias oficiales (Sanidad solo
    # mide agua) + clústeres de prensa con causa Contaminación fuera
    # de la ventana de una incidencia. Desprendimientos/obras/mar
    # agitado no cuentan — el agua no tuvo la culpa
    contam_episodes: int = 0


class OutfallNearbyBeachOut(BaseModel):
    outfall_id: int
    beach_id: int
    beach_name: str
    municipality: str | None
    distance_m: float


class BeachNearbyOutfallOut(BaseModel):
    outfall_id: int
    name: str
    kind: str | None
    status: str
    distance_m: float


class NewsSummaryOut(BaseModel):
    """Agregado determinista de las noticias casadas: el "por qué"
    dominante según prensa (moda de event_type/cause ya extraídos)."""

    event_type: str | None
    cause: str | None
    items_count: int
    outlets_count: int
    # primer titular del evento dominante ("desde el…")
    since: datetime | None
    # inicio real afirmado por el texto ("cerrada desde julio de
    # 2024" → "2024-07"), ISO parcial — si existe adelanta a `since`
    closed_since: str | None = None
    # El episodio resumido corresponde a un PM hermano del arenal
    # (tiene la evidencia oficial) — la UI dice "el punto N"
    attributed_pm: str | None = None


class BeachNewsOut(BaseModel):
    summary: NewsSummaryOut
    items: list[NewsItemOut]
    # Solo los titulares del último episodio de cobertura — el banner
    # de la ficha despliega estos, no el saco completo de `items`
    episode_items: list[NewsItemOut] = []


class DeviceIn(BaseModel):
    token: str
    platform: str | None = None


class ClientEventIn(BaseModel):
    """Error/evento reportado por la app instalada — /health lo cuenta
    en errors_24h.client (kind libre, p.ej. "push-register-failed")."""

    kind: str
    platform: str | None = None
    message: str | None = None


class AlertOut(BaseModel):
    beach_id: int
    beach_name: str
    municipality: str | None
    status: str
    # "official" (Náyade) | "press" (último evento que cambia estado en
    # noticias casadas = cierre/aviso, p.ej. Benijo: cerrada por orden
    # municipal sin registro sanitario). Metadato de procedencia; la UI
    # no lo distingue hoy.
    via: str = "official"
    # Por qué está en alerta: categoría corta ("Contaminación",
    # "Desprendimientos"...) de la incidencia oficial o de la prensa
    cause: str | None = None
    cause_via: str | None = None
    reported_at: datetime | None
    source_url: str | None
    longitude: float
    latitude: float

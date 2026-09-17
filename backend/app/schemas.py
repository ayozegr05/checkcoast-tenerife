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


class BeachIncidentOut(BaseModel):
    id: int
    beach_id: int
    opened_at: date
    closed_at: date | None
    observations: str | None
    source_url: str | None


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
    total_samples: int
    latest_evaluation: str | None
    latest_sampled_at: date | None


class DeviceIn(BaseModel):
    token: str
    platform: str | None = None


class AlertOut(BaseModel):
    beach_id: int
    beach_name: str
    municipality: str | None
    status: str
    reported_at: datetime | None
    source_url: str | None
    longitude: float
    latitude: float

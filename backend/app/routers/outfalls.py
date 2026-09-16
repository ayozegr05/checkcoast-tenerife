from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Outfall, OutfallStatus
from app.schemas import Feature, FeatureCollection, PointGeometry

router = APIRouter(tags=["outfalls"])


@router.get("/outfalls", response_model=FeatureCollection)
def list_outfalls(
    status: OutfallStatus | None = Query(
        None, description="Filtrar por legalidad del vertido"
    ),
    kind: str | None = Query(
        None,
        description="Filtrar por tipo de conducción (p. ej. 'Emisario submarino')",
    ),
    db: Session = Depends(get_db),
) -> FeatureCollection:
    q = db.query(
        Outfall.id,
        Outfall.name,
        Outfall.municipality,
        Outfall.kind,
        Outfall.status,
        Outfall.source_url,
        Outfall.fetched_at,
        func.ST_X(Outfall.geom).label("lon"),
        func.ST_Y(Outfall.geom).label("lat"),
    )
    if status is not None:
        q = q.filter(Outfall.status == status)
    if kind is not None:
        q = q.filter(Outfall.kind == kind)

    features = [
        Feature(
            id=row.id,
            geometry=PointGeometry(coordinates=[row.lon, row.lat]),
            properties={
                "name": row.name,
                "municipality": row.municipality,
                "kind": row.kind,
                "status": row.status.value,
                "source_url": row.source_url,
                "fetched_at": row.fetched_at.isoformat() if row.fetched_at else None,
            },
        )
        for row in q.all()
    ]
    return FeatureCollection(features=features)

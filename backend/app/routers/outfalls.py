from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2 import Geography
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Beach, Outfall, OutfallStatus
from app.schemas import (
    Feature,
    FeatureCollection,
    OutfallNearestBeachOut,
    PointGeometry,
)

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


@router.get(
    "/outfalls/{outfall_id}/nearest-beach",
    response_model=OutfallNearestBeachOut,
)
def outfall_nearest_beach(
    outfall_id: int, db: Session = Depends(get_db)
) -> OutfallNearestBeachOut:
    """Playa catalogada más cercana al vertido, con distancia en metros
    (geography). Contextualiza el impacto del vertido sobre el baño."""
    outfall = db.get(Outfall, outfall_id)
    if outfall is None:
        raise HTTPException(status_code=404, detail="Outfall not found")
    row = (
        db.query(
            Beach.id,
            Beach.name,
            Beach.municipality,
            func.ST_Distance(
                Beach.geom.cast(Geography),
                Outfall.geom.cast(Geography),
            ).label("distance_m"),
        )
        .filter(Outfall.id == outfall_id)
        .order_by("distance_m")
        .first()
    )
    return OutfallNearestBeachOut(
        outfall_id=outfall.id,
        beach_id=row.id,
        beach_name=row.name,
        municipality=row.municipality,
        distance_m=row.distance_m,
    )

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Beach
from app.queries import beaches_with_latest_status
from app.schemas import BeachStatusOut, Feature, FeatureCollection, PointGeometry

router = APIRouter(tags=["beaches"])


@router.get("/beaches", response_model=FeatureCollection)
def list_beaches(db: Session = Depends(get_db)) -> FeatureCollection:
    rows = (
        db.query(
            Beach.id,
            Beach.name,
            Beach.municipality,
            Beach.source_url,
            func.ST_X(Beach.geom).label("lon"),
            func.ST_Y(Beach.geom).label("lat"),
        )
        .order_by(Beach.name)
        .all()
    )
    return FeatureCollection(
        features=[
            Feature(
                id=row.id,
                geometry=PointGeometry(coordinates=[row.lon, row.lat]),
                properties={
                    "name": row.name,
                    "municipality": row.municipality,
                    "source_url": row.source_url,
                },
            )
            for row in rows
        ]
    )


@router.get("/beaches/{beach_id}/status", response_model=BeachStatusOut)
def beach_status(beach_id: int, db: Session = Depends(get_db)) -> BeachStatusOut:
    row = (
        beaches_with_latest_status(db)
        .filter(Beach.id == beach_id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Beach not found")

    beach, status = row
    return BeachStatusOut(
        beach_id=beach.id,
        beach_name=beach.name,
        status=status.status.value if status else "unknown",
        reported_at=status.reported_at if status else None,
        source_url=status.source_url if status else beach.source_url,
    )

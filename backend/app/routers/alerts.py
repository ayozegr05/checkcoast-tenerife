from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Beach, BeachState
from app.queries import beaches_with_latest_status
from app.schemas import AlertOut

router = APIRouter(tags=["alerts"])


@router.get("/alerts", response_model=list[AlertOut])
def list_alerts(db: Session = Depends(get_db)) -> list[AlertOut]:
    """Playas cuyo último estado conocido es 'closed' o 'warning'."""
    rows = beaches_with_latest_status(db).all()
    return [
        AlertOut(
            beach_id=beach.id,
            beach_name=beach.name,
            municipality=beach.municipality,
            status=status.status.value,
            reported_at=status.reported_at,
            source_url=status.source_url,
            longitude=db.scalar(func.ST_X(beach.geom)),
            latitude=db.scalar(func.ST_Y(beach.geom)),
        )
        for beach, status in rows
        if status is not None
        and status.status in (BeachState.closed, BeachState.warning)
    ]

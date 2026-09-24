from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Beach
from app.queries import effective_states
from app.schemas import AlertOut

router = APIRouter(tags=["alerts"])


@router.get("/alerts", response_model=list[AlertOut])
def list_alerts(db: Session = Depends(get_db)) -> list[AlertOut]:
    """Playas con alerta vigente según la matriz de estado efectivo
    (queries.effective_states): oficial + prensa con precedencia por
    fecha de evento real. `via` guarda la procedencia; el estado
    oficial crudo nunca se altera."""
    eff = effective_states(db)
    alerts: list[AlertOut] = []
    for beach_id, e in eff.items():
        if not e["alerted"]:
            continue
        beach = db.get(Beach, beach_id)
        if beach is None:
            continue
        alerts.append(
            AlertOut(
                beach_id=beach.id,
                beach_name=beach.name,
                municipality=beach.municipality,
                status=e["status"],
                via=e["via"],
                cause=e.get("cause"),
                cause_via=e.get("cause_via"),
                reported_at=e["reported_at"],
                source_url=e["source_url"],
                longitude=db.scalar(func.ST_X(beach.geom)),
                latitude=db.scalar(func.ST_Y(beach.geom)),
            )
        )
    return alerts

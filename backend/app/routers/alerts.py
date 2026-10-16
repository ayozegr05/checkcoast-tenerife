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
    alerted_ids = [bid for bid, e in eff.items() if e["alerted"]]
    if not alerted_ids:
        return []
    rows = db.execute(
        Beach.__table__.select()
        .with_only_columns(
            Beach.id,
            Beach.name,
            Beach.municipality,
            func.ST_X(Beach.geom).label("lon"),
            func.ST_Y(Beach.geom).label("lat"),
        )
        .where(Beach.id.in_(alerted_ids))
    ).all()
    by_id = {r.id: r for r in rows}
    alerts: list[AlertOut] = []
    for beach_id in alerted_ids:
        row = by_id.get(beach_id)
        if row is None:
            continue
        name, municipality, lon, lat = (
            row.name,
            row.municipality,
            row.lon,
            row.lat,
        )
        e = eff[beach_id]
        alerts.append(
            AlertOut(
                beach_id=beach_id,
                beach_name=name,
                municipality=municipality,
                status=e["status"],
                via=e["via"],
                cause=e.get("cause"),
                cause_via=e.get("cause_via"),
                reported_at=e["reported_at"],
                source_url=e["source_url"],
                longitude=lon,
                latitude=lat,
            )
        )
    return alerts

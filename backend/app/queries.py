from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from app.models import Beach, BeachStatus

# Subconsulta: último estado reportado por playa
_latest = (
    select(
        BeachStatus.beach_id.label("beach_id"),
        func.max(BeachStatus.reported_at).label("latest_at"),
    )
    .group_by(BeachStatus.beach_id)
    .subquery()
)

_LatestStatus = aliased(BeachStatus)


def beaches_with_latest_status(db: Session):
    """Devuelve filas (Beach, BeachStatus|None) con el estado más reciente."""
    return (
        db.query(Beach, _LatestStatus)
        .outerjoin(_latest, _latest.c.beach_id == Beach.id)
        .outerjoin(
            _LatestStatus,
            (_LatestStatus.beach_id == Beach.id)
            & (_LatestStatus.reported_at == _latest.c.latest_at),
        )
    )

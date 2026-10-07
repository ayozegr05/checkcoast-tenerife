from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ClientEvent, DeviceToken
from app.schemas import ClientEventIn, DeviceIn

router = APIRouter(tags=["devices"])


@router.post("/devices", status_code=201)
def register_device(payload: DeviceIn, db: Session = Depends(get_db)) -> dict:
    """Registra el Expo push token de un dispositivo (idempotente)."""
    if not payload.token.startswith("ExponentPushToken"):
        raise HTTPException(status_code=400, detail="Invalid Expo push token")
    exists = (
        db.query(DeviceToken)
        .filter(DeviceToken.token == payload.token)
        .one_or_none()
    )
    if exists is None:
        db.add(DeviceToken(token=payload.token, platform=payload.platform))
        db.commit()
    elif payload.platform and exists.platform != payload.platform:
        exists.platform = payload.platform
        db.commit()
    return {"ok": True}


@router.post("/client-events", status_code=201)
def report_client_event(
    payload: ClientEventIn, db: Session = Depends(get_db)
) -> dict:
    """La app reporta un error de cliente (p.ej. push no activado).

    Write-only y sin auth: es telemetría que el propio cliente emite —
    un campo truncado no vale un token de admin."""
    db.add(
        ClientEvent(
            kind=payload.kind[:40],
            platform=(payload.platform or "")[:20] or None,
            message=(payload.message or "")[:500] or None,
        )
    )
    db.commit()
    return {"ok": True}

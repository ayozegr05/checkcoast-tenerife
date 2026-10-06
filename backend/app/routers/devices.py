from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import DeviceToken
from app.schemas import DeviceIn

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

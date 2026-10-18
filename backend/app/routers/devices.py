import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app import app_check
from app.db import get_db
from app.models import ClientEvent, DeviceToken
from app.schemas import ClientEventIn, DeviceIn

router = APIRouter(tags=["devices"])

# /client-events es write-only y sin auth — sin tope, cualquiera
# podría inflar la tabla de telemetría. Ventana deslizante por IP
# en memoria: basta contra flood casual; un atacante serio con IPs
# rotadas ya lo cubre el proxy/CDN
_EVENT_WINDOW_S = 60
_EVENT_MAX_PER_IP = 20
_event_hits: dict[str, deque] = defaultdict(deque)


def _rate_limited(ip: str) -> bool:
    now = time.monotonic()
    hits = _event_hits[ip]
    while hits and now - hits[0] > _EVENT_WINDOW_S:
        hits.popleft()
    # Purga de IPs ya inactivas — sin esto el dict crece una entrada
    # por cada IP que haya reportado alguna vez
    if len(_event_hits) > 5000:
        for k in [k for k, v in _event_hits.items() if not v]:
            del _event_hits[k]
    if len(hits) >= _EVENT_MAX_PER_IP:
        return True
    hits.append(now)
    return False


@router.post("/devices", status_code=201)
def register_device(
    payload: DeviceIn, request: Request, db: Session = Depends(get_db)
) -> dict:
    """Registra el Expo push token de un dispositivo (idempotente)."""
    app_check.monitor(request.headers.get("x-firebase-appcheck"))
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
    payload: ClientEventIn,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    """La app reporta un error de cliente (p.ej. push no activado).

    Write-only y sin auth: es telemetría que el propio cliente emite —
    un campo truncado no vale un token de admin."""
    app_check.monitor(request.headers.get("x-firebase-appcheck"))
    ip = request.client.host if request.client else "?"
    if _rate_limited(ip):
        raise HTTPException(status_code=429, detail="Too many events")
    db.add(
        ClientEvent(
            kind=payload.kind[:40],
            platform=(payload.platform or "")[:20] or None,
            message=(payload.message or "")[:500] or None,
        )
    )
    db.commit()
    return {"ok": True}

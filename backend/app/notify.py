"""Notificaciones push vía Expo Push Service.

Cuando cambia el estado oficial de una playa (scraper de Náyade o alta
manual) se envía un mensaje a todos los dispositivos registrados en
`device_tokens`. Los tokens que Expo marca como DeviceNotRegistered se
purgan para no acumular dispositivos muertos.
"""

import re

import requests
from sqlalchemy.orm import Session

from app.models import Beach, BeachState, DeviceToken

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

_STATE_LABEL = {
    BeachState.closed: "Cierre de baño",
    BeachState.warning: "Aviso oficial activo",
    BeachState.open: "Reapertura",
}


def _display_name(name: str) -> str:
    """'PLAYA JARDIN PM4' -> 'Playa Jardin PM4'."""
    return re.sub(r"Pm(\d+)", r"PM\1", name.title())


def notify_beach_status(
    db: Session, beach: Beach, state: BeachState
) -> int:
    """Push a todos los dispositivos registrados. Devuelve los mensajes
    aceptados por Expo. Los errores de red se loguean, no se propagan:
    una notificación fallida no debe romper la ingesta ni la API."""
    tokens = [t for (t,) in db.query(DeviceToken.token).all()]
    if not tokens:
        return 0

    muni = beach.municipality or "Tenerife"
    messages = [
        {
            "to": token,
            "title": _display_name(beach.name),
            "body": f"{_STATE_LABEL[state]} · {muni}",
            "data": {"beach_id": beach.id},
            "sound": "default",
            "channelId": "alerts",
        }
        for token in tokens
    ]
    try:
        resp = requests.post(EXPO_PUSH_URL, json=messages, timeout=15)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"[push] error enviando: {e}")
        return 0

    # Poda de tokens que Expo reporta como dados de baja
    tickets = resp.json().get("data", [])
    dead = [
        token
        for token, ticket in zip(tokens, tickets)
        if ticket.get("details", {}).get("error") == "DeviceNotRegistered"
    ]
    if dead:
        db.query(DeviceToken).filter(DeviceToken.token.in_(dead)).delete(
            synchronize_session=False
        )
        db.commit()
    return len(messages) - len(dead)

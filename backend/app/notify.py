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


_PRESS_LABEL = {
    "closure": "Cierre de baño",
    "warning": "Aviso en la playa",
    "reopening": "Reapertura",
}


def _send(db: Session, tokens: list[str], messages: list[dict]) -> int:
    """POST al Expo Push Service + poda de tokens muertos. Devuelve los
    mensajes aceptados. Los errores de red se loguean, no se propagan:
    una notificación fallida no debe romper la ingesta ni la API."""
    try:
        resp = requests.post(EXPO_PUSH_URL, json=messages, timeout=15)
        resp.raise_for_status()
        tickets = resp.json().get("data", [])
    except Exception as e:
        # Red caída, 502 con HTML (json() revienta)... el push se
        # reintenta en la próxima pasada vía push_pending — aquí solo
        # se loguea y se sigue con el resto de playas
        print(f"[push] error enviando: {e}")
        return 0

    # Poda de tokens que Expo reporta como dados de baja
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


def _messages(db: Session, beach: Beach, body: str) -> tuple[list[str], list[dict]]:
    tokens = [t for (t,) in db.query(DeviceToken.token).all()]
    muni = beach.municipality or "Tenerife"
    return tokens, [
        {
            "to": token,
            "title": _display_name(beach.name),
            "body": body.format(muni=muni),
            "data": {"beach_id": beach.id},
            "sound": "default",
            "channelId": "alerts",
        }
        for token in tokens
    ]


def notify_beach_status(
    db: Session, beach: Beach, state: BeachState
) -> int:
    """Push a todos los dispositivos registrados al cambiar el estado
    oficial de una playa."""
    tokens, messages = _messages(db, beach, f"{_STATE_LABEL[state]} · {{muni}}")
    return _send(db, tokens, messages) if tokens else 0


def notify_press_event(db: Session, beach: Beach, event_type: str) -> int:
    """Push de una alerta detectada por prensa antes que por Sanidad.

    Mismo formato que la oficial con el matiz "según prensa" al final —
    la etiqueta que separa contexto de dato oficial en toda la app."""
    label = _PRESS_LABEL.get(event_type)
    if label is None:
        return 0
    tokens, messages = _messages(db, beach, f"{label} · {{muni}} · según prensa")
    return _send(db, tokens, messages) if tokens else 0

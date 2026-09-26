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


# Cuando muchas playas cambian en la misma pasada (temporal de levante,
# vertido grande) un push por playa es un bombardeo: a partir de
# _AGG_MIN cambios del mismo tipo se manda UN resumen agregado
_AGG_MIN = 4
_AGG_LIST_MAX = 5

_AGG_LABEL = {
    BeachState.closed: "cierres de baño",
    BeachState.warning: "avisos oficiales",
    BeachState.open: "reaperturas",
}


def _batch_body(beaches: list[Beach]) -> str:
    names = [_display_name(b.name) for b in beaches]
    body = ", ".join(names[:_AGG_LIST_MAX])
    extra = len(names) - _AGG_LIST_MAX
    return f"{body} y {extra} más" if extra > 0 else body


def notify_beach_states(
    db: Session, changes: list[tuple[Beach, BeachState]]
) -> int:
    """Push de una pasada de cambios oficiales. ≤3 playas del mismo
    tipo → push individual por playa; ≥4 → un único push agregado
    ("5 cierres de baño · Playa X, Playa Y…") por tipo."""
    groups: dict[BeachState, list[Beach]] = {}
    for beach, state in changes:
        groups.setdefault(state, []).append(beach)

    sent = 0
    for state, beaches in groups.items():
        if len(beaches) < _AGG_MIN:
            for b in beaches:
                sent += notify_beach_status(db, b, state)
            continue
        tokens = [t for (t,) in db.query(DeviceToken.token).all()]
        if not tokens:
            continue
        body = _batch_body(beaches)
        messages = [
            {
                "to": token,
                "title": f"{len(beaches)} {_AGG_LABEL[state]}",
                "body": body,
                "data": {"kind": "batch", "state": state.value},
                "sound": "default",
                "channelId": "alerts",
            }
            for token in tokens
        ]
        sent += _send(db, tokens, messages)
    return sent


def notify_press_event(db: Session, beach: Beach, event_type: str) -> int:
    """Push de una alerta detectada por prensa antes que por Sanidad.

    Mismo formato que la oficial con el matiz "según prensa" al final —
    la etiqueta que separa contexto de dato oficial en toda la app."""
    label = _PRESS_LABEL.get(event_type)
    if label is None:
        return 0
    tokens, messages = _messages(db, beach, f"{label} · {{muni}} · según prensa")
    return _send(db, tokens, messages) if tokens else 0

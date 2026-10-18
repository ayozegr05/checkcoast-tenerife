"""Firebase App Check en modo MONITOR — nunca rechaza una petición.

Los endpoints de escritura (`/devices`, `/client-events`) leen el
header `X-Firebase-AppCheck`; el token se verifica con firebase-admin
y el veredicto se acumula en `stats` (expuesto en `/health`). Cuando
el % de `valid` se estabilice en clientes reales, el enforcement
(401) se activa sin sorpresas: clientes viejos sin el módulo nativo
llegan como `missing`, no como `invalid`.
"""

import json
import logging

log = logging.getLogger(__name__)

stats = {"missing": 0, "valid": 0, "invalid": 0}

_app = None
_init_done = False


def _firebase_app():
    """firebase-admin de carga perezosa. Sin credenciales el monitor
    se queda inerte — un servicio externo mal configurado nunca tumba
    la API (es coherente con monitor: no verificar = no decidir)."""
    global _app, _init_done
    if _init_done:
        return _app
    _init_done = True
    try:
        from firebase_admin import credentials, initialize_app

        from app.config import settings

        raw = settings.firebase_service_account_json
        if not raw:
            return None
        _app = initialize_app(credentials.Certificate(json.loads(raw)))
    except Exception as e:
        log.warning("app-check: firebase init falló (%s)", e)
    return _app


def monitor(token: str | None) -> None:
    """Cuenta el veredicto del header de una petición. Fire-and-forget:
    cualquier fallo del verificador queda como 'invalid', nunca
    propaga."""
    if not token:
        stats["missing"] += 1
        return
    if _firebase_app() is None:
        return
    from firebase_admin import app_check

    try:
        app_check.verify_token(token, app=_app)
        stats["valid"] += 1
    except Exception as e:
        stats["invalid"] += 1
        log.info("app-check: token rechazado (%s)", e)

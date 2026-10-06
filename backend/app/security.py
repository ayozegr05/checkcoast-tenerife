import secrets

from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader

from app.config import settings

_admin_key_header = APIKeyHeader(name="X-Admin-Key", auto_error=False)


def require_admin(key: str | None = Security(_admin_key_header)) -> None:
    """Protege endpoints que alteran el estado público o disparan push.

    Falla cerrado: sin `ADMIN_API_KEY` configurada el endpoint queda
    deshabilitado en vez de abierto."""
    if not settings.admin_api_key:
        raise HTTPException(status_code=503, detail="Admin endpoint disabled")
    if key is None or not secrets.compare_digest(
        key.encode(), settings.admin_api_key.encode()
    ):
        raise HTTPException(status_code=401, detail="Invalid admin key")

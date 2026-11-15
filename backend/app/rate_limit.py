"""Rate limiting en memoria por IP para endpoints write-only sin auth.

Ventana deslizante por IP en memoria: basta contra flood casual; un
atacante serio con IPs rotadas ya lo cubre el proxy/CDN. Estado en el
proceso — hoy hay un solo worker; si hubiera varios haría falta estado
compartido (Redis).
"""

import time
from collections import defaultdict, deque


class RateLimiter:
    """Devuelve True cuando una IP supera max_per_window peticiones en window_s."""

    def __init__(self, max_per_window: int, window_s: float = 60.0):
        self.max_per_window = max_per_window
        self.window_s = window_s
        self._hits: dict[str, deque] = defaultdict(deque)

    def limited(self, ip: str) -> bool:
        now = time.monotonic()
        hits = self._hits[ip]
        while hits and now - hits[0] > self.window_s:
            hits.popleft()
        # Purga de IPs ya inactivas — sin esto el dict crece una entrada
        # por cada IP que haya llamado alguna vez
        if len(self._hits) > 5000:
            for k in [k for k, v in self._hits.items() if not v]:
                del self._hits[k]
        if len(hits) >= self.max_per_window:
            return True
        hits.append(now)
        return False


# POST /devices lo llama la app al arrancar con el token de push
# (idempotente, una vez por instalación). 30/min es muy generoso —
# cubre CG-NATs con muchos móviles por IP sin abrir la puerta a
# inflar la tabla de tokens.
devices_limiter = RateLimiter(max_per_window=30)

# POST /client-events: telemetría write-only — sin tope cualquiera
# podría inflar la tabla y el contador errors_24h de /health.
events_limiter = RateLimiter(max_per_window=20)

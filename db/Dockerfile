# postgis/postgis solo publica amd64 — la VM de Oracle (Ampere A1) es
# ARM64. postgres:16 es multi-arch; postgis va por apt encima y el
# comportamiento es idéntico en dev (amd64) y en la VM (arm64)
FROM postgres:16
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-postgis-3 \
    && rm -rf /var/lib/apt/lists/*

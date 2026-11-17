#!/usr/bin/env bash
# Ejecutar desde cron o a mano en la VM. El lock y el progreso viven en
# PostgreSQL; no se repiten URLs terminadas ni se solapan auditorías.
# El primer fallo del proveedor detiene el lote con salida no-cero.
set -euo pipefail
docker exec checkcoast-api python -u -m scripts.reextract_news \
  --max 60 --model gemini-3.5-flash-lite

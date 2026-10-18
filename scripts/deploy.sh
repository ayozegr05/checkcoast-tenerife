#!/usr/bin/env bash
# Deploy del backend a la VM (CI → ~/deploy-checkcoast.sh → este script).
# El git pull lo hace el wrapper ANTES de ejecutar este archivo — si lo
# hiciera el propio script, un cambio en deploy.sh se auto-modificaría
# en plena ejecución (bash lee el archivo sobre la marcha).
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose build api
docker compose up -d api

# Post-deploy: si la API no responde sana en ~60 s, el job sale rojo
for i in $(seq 1 12); do
  if curl -fsS http://localhost:8001/health | grep -q '"db": *"ok"'; then
    echo "deploy OK — /health responde db:ok"
    exit 0
  fi
  sleep 5
done
echo "deploy FAILED — /health no responde tras 60s" >&2
exit 1

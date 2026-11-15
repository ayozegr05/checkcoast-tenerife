#!/usr/bin/env bash
# Deploy del backend a la VM (CI → ~/deploy-checkcoast.sh → este script).
# El git pull lo hace el wrapper ANTES de ejecutar este archivo — si lo
# hiciera el propio script, un cambio en deploy.sh se auto-modificaría
# en plena ejecución (bash lee el archivo sobre la marcha).
#
# Rollback: antes de construir se retaguea la imagen actual como
# :previous. Si el health check post-deploy falla, se restaura
# automáticamente. Manual: ./scripts/deploy.sh --rollback
set -euo pipefail
cd "$(dirname "$0")/.."

# Nombre de imagen que genera compose para el servicio api (sin tag)
IMG=$(docker compose config --images | grep 'api' | head -1)
IMG=${IMG%%:*}

wait_healthy() {
  # Post-deploy: si la API no responde sana en ~60 s, el job sale rojo
  for _ in $(seq 1 12); do
    if curl -fsS http://localhost:8001/health | grep -q '"db": *"ok"'; then
      return 0
    fi
    sleep 5
  done
  return 1
}

rollback() {
  if ! docker image inspect "$IMG:previous" >/dev/null 2>&1; then
    echo "no existe $IMG:previous — nada a lo que volver" >&2
    return 1
  fi
  docker tag "$IMG:previous" "$IMG:latest"
  docker compose up -d api --force-recreate
}

if [ "${1:-}" = "--rollback" ]; then
  rollback
  wait_healthy && echo "rollback OK — /health responde db:ok" && exit 0
  echo "rollback FAILED — la versión anterior tampoco responde" >&2
  exit 1
fi

# Guarda la imagen en producción como :previous antes de reemplazarla
if docker image inspect "$IMG:latest" >/dev/null 2>&1; then
  docker tag "$IMG:latest" "$IMG:previous"
fi

docker compose build api
docker compose up -d api

if wait_healthy; then
  echo "deploy OK — /health responde db:ok"
  exit 0
fi

echo "deploy FAILED — /health no responde tras 60s; intentando rollback" >&2
if rollback && wait_healthy; then
  echo "rollback OK — versión anterior restaurada" >&2
else
  echo "rollback también falló — la API sigue caída" >&2
fi
exit 1

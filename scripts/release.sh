#!/usr/bin/env bash
# Release gate: e2e fresco antes de cada eas build.
# Lanza el workflow E2E contra origin/main, espera (~25 min) y solo si
# sale verde ejecuta el build con los args que le pases:
#   ./scripts/release.sh --platform android --profile production
#
# Por qué no vale "mirar el último run": el e2e corre sobre el código
# de GitHub. Un nocturno verde no cubre commits de frontend posteriores.
set -euo pipefail
cd "$(dirname "$0")/.."

# HEAD debe estar pusheado: si no, el e2e probaría código viejo y el
# build empaquetaría algo nunca testeado
git fetch origin main --quiet
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "HEAD no coincide con origin/main — pushea primero" >&2
  exit 1
fi

# Cambios sin commitear en frontend/ entrarían en el build pero el e2e
# nunca los vería (corre sobre el repo, no el working tree)
if ! git diff --quiet -- frontend/ || ! git diff --cached --quiet -- frontend/; then
  echo "hay cambios sin commitear en frontend/ — commitea y pushea antes" >&2
  exit 1
fi

echo "lanzando E2E contra main…"
TRIGGER_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
gh workflow run e2e.yml --ref main

# El run tarda unos segundos en aparecer en la API
sleep 10
RUN_ID=$(gh run list --workflow e2e.yml --limit 5 \
  --json databaseId,createdAt \
  -q "[.[] | select(.createdAt > \"$TRIGGER_TS\")][0].databaseId")

if [ -z "$RUN_ID" ] || [ "$RUN_ID" = "null" ]; then
  echo "no apareció el run de e2e — comprueba 'gh run list --workflow e2e.yml'" >&2
  exit 1
fi

echo "e2e corriendo: https://github.com/ayozegr05/checkcoast-tenerife/actions/runs/$RUN_ID"
if ! gh run watch "$RUN_ID" --exit-status >/dev/null; then
  echo "e2e en rojo — build abortado. Mira el run (artefactos incluidos)" >&2
  exit 1
fi

echo "e2e verde — lanzando eas build $*"
cd frontend
eas build "$@"

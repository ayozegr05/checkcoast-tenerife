# Revisión del proyecto como portfolio (2026-10-06)

Revisión externa del repo con ojos de reclutador / tech lead. Documento
temporal de trabajo: se puede borrar cuando estén resueltos los puntos.

## Puntos fuertes

- Problema real, datos reales y en producción (API HTTPS, landing y
  páginas públicas `/b/{id}`), no un clon de tutorial
- Full stack completo: FastAPI + PostGIS + Alembic, scrapers con
  reintentos, scheduler, LLM con salida estructurada, push y app nativa
  con mapa
- CI con PostGIS de servicio y tests con fixtures sintéticos
- `DECISIONS.md`: explica el *porqué* de cada decisión — muy útil en
  entrevistas
- Criterio de producto: oficial y prensa siempre separados, "abierta ≠
  segura", nunca ocultar cierres

## Pendientes (por prioridad)

| # | Tarea | Estado |
|---|-------|--------|
| 1 | **Seguridad**: `POST /beaches/{id}/status` abierto en producción y dispara push a todos los usuarios → exigir `X-Admin-Key` | ✅ Hecho (#2) — falta poner `ADMIN_API_KEY` en la VM y redesplegar |
| 2 | **Capturas / GIF / APK en el README** (hay un `TODO`) — es lo primero que mira un reclutador | Ya planificado en ROADMAP 9.2 / 9.6 |
| 3 | **Linter y formateador en el repo**: Ruff (lint + format) y Prettier están solo en el PC local, sin configuración versionada ni paso en CI. Hoy `ruff format --check` reformatearía 43 de 53 ficheros del backend y `prettier --check` marca 19 del frontend. Añadir `pyproject.toml`/`.prettierrc`, formatear de una vez en un commit aislado y ejecutar `ruff check`, `ruff format --check` y `prettier --check` en CI | ✅ Hecho (#4) |
| 4 | **Componentes grandes**: `CoastMap.tsx` (~2.260 líneas), `BeachDetail.tsx` (~1.690), `MunicipalityStats.tsx` (~1.600), `share.py` (~1.480, HTML en strings de Python). Trocear 1-2: p. ej. sacar el banner de alertas de `CoastMap` y pasar `share.py` a plantillas Jinja2 | Pendiente |
| 5a | Quitar el `Alert('Push debug')` de `frontend/lib/notifications.ts` | ✅ Hecho — el aviso al usuario si falla el push va en ROADMAP 10.8 |
| 5b | `Caddyfile` incluye otro proyecto (`controlpick`) → sacarlo del repo público o dejar solo el bloque de CheckCoast | ✅ Hecho — `import sites/*.caddy` + `caddy-sites/` fuera del repo |
| 5c | Mover `frontend/scripts_gen_icon.py` y `scripts_gen_mapstyle.py` a `frontend/scripts/`; `frontend/LICENSE` era la licencia de la plantilla de Expo | ✅ Hecho |
| 5d | Mensajes de commit: elegir un estilo (`feat:/fix:` Conventional Commits) y mantenerlo | Pendiente |
| 5e | ROADMAP 10.6 está desactualizado: la API key de Firebase ya no está restringida por app + SHA-1 (restricción de aplicación = "Ninguna"); falta limitarla por API (Firebase Installations, FCM, FCM Registration) | ✅ Nota actualizada — limitar la key por API sigue pendiente (consola GCP) |
| 6 | README en inglés (o bilingüe) para optar a remoto internacional | Opcional |

## Preparación para entrevistas

El repo deja ver que se ha trabajado con IA (`AGENTS.md`/`CLAUDE.md`,
historial muy rápido). No es negativo, pero preguntarán por el código.
Saber explicar sin mirar:

- Cómo se deriva el estado de una playa (`_derive_state`,
  `effective_states`, precedencia oficial/prensa)
- Cómo se casa una noticia con una playa (`match_beaches`, `_press_key`,
  ambigüedad entre municipios)
- Cómo se agrupan los episodios de prensa (`events.py`, reaperturas
  como frontera)
- Por qué PostGIS, por qué scraping de Náyade y por qué el LLM solo
  para prensa (ver `DECISIONS.md`)

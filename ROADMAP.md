# Roadmap — CheckCoast Tenerife

Documento vivo del proyecto. Se actualiza a medida que avanzamos.

**Leyenda:** ✅ completado · 🚧 en progreso · ⬜ pendiente

---

## Hito 0 — Fundaciones ✅
- [x] Monorepo: `/backend` (FastAPI) + `/frontend` (Expo/React Native)
- [x] `docker-compose.yml` con PostgreSQL 16 + PostGIS 3.4 en puerto **5433**
- [x] `.gitignore` (Python, Node, Docker, .env)
- [x] Venv de Python + `requirements.txt` (fastapi, uvicorn, sqlalchemy, geoalchemy2, psycopg2, asyncpg)
- [x] `GET /health` funcionando
- [x] Frontend Expo + TypeScript + `react-native-maps` con `CoastMap` centrado en Tenerife
- [x] Git init + commit inicial

## Hito 1 — Modelo de datos + migraciones ✅
- [x] Alembic configurado y conectado al contenedor PostGIS
- [x] `backend/app/db.py` (engine + sesión) y `config.py` (pydantic-settings)
- [x] Modelos SQLAlchemy/GeoAlchemy2:
  - [x] `Outfall` (emisario): `POINT`, legal/ilegal, municipio, fuente
  - [x] `Beach`: geometría, nombre, municipio
  - [x] `BeachStatus`/`Alert`: estado, timestamp, fuente oficial
- [x] Migración inicial aplicada (`alembic upgrade head`)

## Hito 2 — Ingesta de datos ✅
- [x] `backend/scripts/` con un script por fuente oficial
- [x] Emisarios: Censo de Vertidos Tierra-Mar 2025 (Gob. Canarias / SITCAN) — 180 puntos en Tenerife
- [x] Playas: Censo Nacional de Zonas de Aguas de Baño 2025 (MITECO / Náyade) — 61 puntos en Tenerife
- [x] Normalizar a SRID 4326 e insertar en PostGIS (UTM 28N → WGS84 con pyproj)
- [x] Trazabilidad: `source_url` + `fetched_at` por registro; upserts idempotentes por `external_id`
- Nota: alertas de cierre en tiempo real dependen del portal Náyade (sin API pública estable) → se aborda en Hito 5

## Hito 3 — API REST ✅
- [x] `GET /outfalls` (GeoJSON, filtros `status` y `kind`)
- [x] `GET /beaches` + `GET /beaches/{id}/status`
- [x] `GET /alerts` (cierres/avisos activos según último estado)
- [x] Schemas Pydantic, capa routers + `queries.py` (último estado por playa)
- [x] Tests con pytest + TestClient (8 tests)

## Hito 4 — Frontend: mapa real ✅
- [x] Consumir `/outfalls` y pintar markers (verde legal / rojo ilegal / ámbar en trámite)
- [x] Panel de detalle (`FeatureSheet`) al pulsar marker
- [x] Puntos de playa (azul) con indicador naranja si hay alerta activa
- [x] `EXPO_PUBLIC_API_URL` en `.env` / `.env.example`
- [x] Migración a **MapLibre + OpenStreetMap** (Expo Go SDK 57 trae la key de Google caducada — bug expo/expo#49323; MapLibre elimina la dependencia de Google y encaja con el stack open-data)
- [x] Development build con `eas build --profile development` — APK instalado en Android y funcionando contra la API real
- [x] Botón para alternar vista callejero/satélite (tiles raster Esri World Imagery)

## Hito 5 — Tiempo real ✅
- [x] Scraping de Náyade (Sistema Nacional de Información de Aguas de Baño, Ministerio de Sanidad): listado de zonas prov. 38 → ficha "Muestreos" por zona → incidentes con fecha apertura/cierre. Incidente sin cierre = alerta activa (`closed` si prohíbe el baño, `warning` resto). 60/61 playas casadas por nombre de PM
- [x] `POST /beaches/{id}/status` — alta manual de estados (respaldo del scraper y demos)
- [x] Scheduler APScheduler en el lifespan de FastAPI (`NAYADE_SYNC_SECONDS`, 1h por defecto)
- [x] Polling en la app: refetch de `/alerts` cada 5 min
- [x] Bonus: reparados 6 nombres de playa con mojibake (`?`) del censo MITECO usando la grafía oficial de Náyade
- [ ] (extensión futura) Ingesta de prensa local / LLM como fuente secundaria que *proponga* alertas pendientes de confirmación contra la oficial

## Hito 5b — Orientación al bañista 🚧

Funciones para acercar la app al objetivo: avisar al bañista del estado de cada playa.

1. [x] **Lista de playas** con buscador, orden por estado (cerradas primero) y filtro por municipio — vista rápida "¿dónde me baño hoy?"
2. [x] **Historial de incidentes** en el panel de detalle (fechas y motivo de cada cierre)
   - Soporte backend: tabla `beach_incidents`, scraper v2 (solo Tenerife + municipios), `GET /beaches/{id}/incidents`, `status` embebido en `/beaches`
3. [x] **Calidad del agua**: tabla `beach_measurements` (fecha, E. coli, enterococo, evaluación) scrapeada de la pestaña Muestreos de Náyade; `GET /beaches/{id}/quality` + "Último análisis" en el panel de detalle
4. [ ] **Notificaciones** al cambiar el estado de una playa (`expo-notifications` → requiere nuevo build EAS)
5. [x] **Capa de playas no monitorizadas** desde OSM (`natural=beach` vía Overpass; +106 playas, dedup vs censo oficial por nombre/distancia; gris en mapa y "No monitorizada" en lista)

## Hito 6 — Calidad y despliegue ⬜
- [ ] Tests backend (pytest) + componente (jest-expo)
- [ ] README con instrucciones
- [ ] CI básico (GitHub Actions: lint + tests)
- [ ] Servicio `api` dockerizado en compose
- [ ] Deploy backend (VPS/Railway/Fly) + app vía EAS Build

## Hito 7 — Portfolio polish ⬜
- [ ] Screenshots/GIF de la app
- [ ] Diagrama de arquitectura en README
- [ ] Documentar decisiones técnicas

---

### Estado actual
**Hito activo:** 6 — Calidad y despliegue
**Última actualización:** 2026-09-17

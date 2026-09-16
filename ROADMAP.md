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
- [ ] Development build con `eas build --profile development` (MapLibre es módulo nativo, no corre en Expo Go)

## Hito 5 — Tiempo real ⬜
- [ ] Polling (refetch cada N min) o SSE/WebSockets desde FastAPI
- [ ] Scheduler de ingesta (APScheduler/cron) que refresca estados
- [ ] Fuente de alertas de cierre de playas: Náyade (portal Struts sin API estable — evaluar scraping, WMS GetFeatureInfo de IDECanarias o fuentes municipales)

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
**Hito activo:** 5 — Tiempo real
**Última actualización:** 2026-09-16

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

## Hito 2 — Ingesta de datos ⬜
- [ ] `backend/scripts/` con un script por fuente oficial
- [ ] Emisarios: inventario oficial (MITECO / Gobierno de Canarias)
- [ ] Playas y alertas: calidad de aguas de baño (Sanidad / Gob. Canarias / ayuntamientos)
- [ ] Normalizar a SRID 4326 e insertar en PostGIS
- [ ] Trazabilidad: `source_url` + `fetched_at` por registro

## Hito 3 — API REST ⬜
- [ ] `GET /outfalls` (GeoJSON, filtro `legal|illegal`)
- [ ] `GET /beaches` + `GET /beaches/{id}/status`
- [ ] `GET /alerts` (cierres activos)
- [ ] Schemas Pydantic, capa routers/servicios
- [ ] Tests con pytest + TestClient

## Hito 4 — Frontend: mapa real ⬜
- [ ] Consumir `/outfalls` y pintar markers (verde legal / rojo ilegal)
- [ ] Bottom sheet con detalle al pulsar marker
- [ ] Badges de alertas de cierre en playas
- [ ] `EXPO_PUBLIC_API_URL` en `.env`

## Hito 5 — Tiempo real ⬜
- [ ] Polling (refetch cada N min) o SSE/WebSockets desde FastAPI
- [ ] Scheduler de ingesta (APScheduler/cron) que refresca estados

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
**Hito activo:** 2 — Ingesta de datos
**Última actualización:** 2026-09-16

# CheckCoast Tenerife — Contexto del proyecto

App cívica para avisar al bañista del estado de las playas de Tenerife
(cierres, avisos, calidad del agua) y mapear los puntos de vertido
(emisarios submarinos) de la isla. Proyecto portfolio.

## Estructura

- `backend/` — FastAPI + SQLAlchemy 2 + GeoAlchemy2 + Alembic, Python 3.12
  - `app/models.py` — `Outfall`, `Beach` (+`monitored`), `BeachStatus`,
    `BeachIncident`, `BeachMeasurement`
  - `app/routers/` — `outfalls.py`, `beaches.py`, `alerts.py`
  - `app/queries.py` — `beaches_with_latest_status` (join último estado)
  - `app/main.py` — lifespan con APScheduler (`_sync_beach_statuses` cada
    `NAYADE_SYNC_SECONDS`, 1 h por defecto; envuelto en try/except)
  - `scripts/` — `ingest_outfalls.py`, `ingest_beaches.py` (censo MITECO
    + solver ALTCHA), `ingest_beach_status.py` (scraper Náyade),
    `ingest_osm_beaches.py` (Overpass)
  - `alembic/` — migraciones (`alembic upgrade head`)
  - `tests/` — pytest: `test_api.py`, `test_nayade_parser.py`,
    `test_osm_ingest.py` (33 tests)
- `frontend/` — Expo SDK 57 + React Native + TypeScript + MapLibre
  - `App.tsx` — fetch inicial (outfalls/beaches/alerts), polling
    `/alerts` cada 5 min, tarjeta de bienvenida, BeachList modal
  - `components/CoastMap.tsx` — mapa OSM/satélite (Esri híbrido),
    capas GeoJSON, leyenda con switches ON/OFF, controles arriba-derecha
  - `components/BeachList.tsx` — buscador, chips municipio, sort
    estado/cierres/calidad; agrupa PMs por nombre base+municipio (filas
    expandibles con datos inline por PM); modal con `visible` (estado
    persistido); vista detalle interna con foto satélite Esri
    (`export?bbox=`) + atrás + «Ver en mapa» (fly-to); `initialMunicipality`
    permite abrirla pre-filtrada
  - `components/BeachDetail.tsx` — contenido de ficha de playa compartido
    (FeatureSheet sobre mapa + detalle dentro de BeachList)
  - `components/MunicipalityStats.tsx` — ranking por municipio (cerradas/
    avisos activos, incidentes, muestras no aptas) con barra de severidad;
    agrega `/beaches/stats` en cliente; al tocar un municipio abre
    `BeachList` filtrada
  - `components/FeatureSheet.tsx` — hoja overlay sobre el mapa: emisarios
    inline; playas delega en `BeachDetail`
  - `lib/api.ts` — tipos + fetchers
  - `frontend/AGENTS.md` exige leer docs de Expo v57 antes de escribir código
- `ROADMAP.md` — hitos 0-5b completados; pendientes: notificaciones push
  (punto 4, requiere rebuild EAS), Hito 6 (calidad/deploy), Hito 7 (portfolio)

## Comandos (desde raíz del repo)

```powershell
docker compose up -d                                    # PostGIS (una vez por sesión de PC)
cd backend
.venv\Scripts\uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
.venv\Scripts\alembic upgrade head                      # migraciones
.venv\Scripts\python -m pytest tests/ -q                # tests backend
.venv\Scripts\python -m scripts.ingest_beach_status     # scraper Náyade manual
.venv\Scripts\python -m scripts.ingest_osm_beaches      # playas OSM manual
cd ../frontend
npx expo start --dev-client --port 8082                 # OBLIGATORIO --port 8082
npx tsc --noEmit                                        # typecheck
```

## Puertos / URLs

- Postgres+PostGIS: host **5433** (`checkcoast-db`)
- API: **8001** (el 8000 lo usa otro proyecto del usuario)
- Metro/Expo: **8082** (el 8081 lo usa otro proyecto — el dev client del
  móvil debe apuntar a `http://192.168.1.71:8082` o escanear el QR nuevo)
- URL API por defecto backend:
  `postgresql+psycopg2://checkcoast:checkcoast@localhost:5433/checkcoast`

## Fuentes de datos y reglas de negocio

- **Emisarios**: Censo de Vertidos Tierra-Mar 2025 (Gob. Canarias) —
  180 puntos, status legal/illegal/unknown
- **Playas monitorizadas**: censo MITECO/Náyade 2025 — 61 PMs en Tenerife
- **Náyade** (`nayadeciudadano.sanidad.gob.es`, Min. Sanidad): portal
  Struts frágil — **da 500 intermitentes**; el scraper reintenta (4×,
  backoff). Flujo: `ciudadanoListaZonaAction.do` (prov 38) → por zona,
  pestanya=1 (Isla/Municipio, filtra solo TENERIFE) + pestanya=3
  (Muestreos: tabla mediciones + bloque `<!--INFORMACION INCIDENCIA-->`)
- **Estado de playa** (`_derive_state`): incidente abierto con
  "prohibido" → `closed`; otro incidente abierto → `warning`; si no hay
  incidentes, la **evaluación de la última medición** manda
  (prohibido→closed, Sin Calificar/recomendación→warning), salvo que un
  incidente se cerrara después de esa medición → `open`
- **Cierre sin fecha de cierre**: Náyade escribe `--` en fecha de cierre
- **Incidentes**: solo temporada activa (desde ~feb 2026). Mediciones:
  desde ene 2023 → para histórico multi-año usar `bad_samples`
  (evaluación "prohibido") de `/beaches/stats`
- **Playas OSM**: `natural=beach` con nombre, `monitored=False`,
  dedup vs censo por nombre normalizado o <400 m. Si una OSM casa con un
  PM de Náyade se promueve a `monitored=True`. Una playa solo casa con
  un PM por pasada (Náyade repite nombres entre zonas: "Caleta de Negros")
- **Matching PM↔playa**: por nombre normalizado (sin acentos, mayúsculas);
  `?` en nombres MITECO (mojibake) actúa como comodín de 1 carácter
- **Umbrales calidad** (RD 1341/2007, costeras): E. coli ≤250/≤500/>500,
  enterococo ≤100/≤200/>200 → Excelente/Buena/Insuficiente
- **Manual**: `POST /beaches/{id}/status` {"status": open|closed|warning}
  como respaldo del scraper
- **Nunca presentar "open" como "segura"**: significa "sin incidencia
  oficial activa". Valleseco PM1 no existe en Náyade → `unknown`

## Datos actuales (sept 2026)

- 167 playas: 61 oficiales + 106 OSM (gris = sin monitorizar)
- ~3200 mediciones, 13 incidentes, alertas vivas: Las Gaviotas (warning,
  muestra "Sin Calificar" pendiente desde jun), El Cabezo PM1 (closed,
  enterococo 410 → prohibido sin incidente formal)
- Frontend: iconos PNG Twemoji en `assets/icons/` (outfall_sil = SDF
  teñido legal/illegal/unknown; playas = círculo azul/naranja/gris +
  sombrilla)

## Gotchas conocidos

- **Náyade** se cae por horas: es normal, el scheduler lo tolera
- **Hot reload** con capas MapLibre da `[Error: 'id' cannot be changed]`
  → reiniciar con `npx expo start --dev-client -c`
- **Node 20.12.2** desactualizado (Expo pide ≥20.19.4) — funciona pero
  actualizar a Node 22 LTS
- **Emoji** en fuentes del sistema no renderiza en Android → usar PNGs
- Token de Expo expuesto en una sesión anterior → el usuario debe
  revocarlo en expo.dev (ya avisado)
- `nayade_muestreos.html` de debug: no commitear artefactos así

## Pendiente inmediato

- Punto 4 del Hito 5b: notificaciones push (`expo-notifications` es
  nativo → requiere nuevo build EAS)
- Hito 6: README, CI, dockerizar API, deploy backend
- Hito 7: screenshots, diagrama arquitectura

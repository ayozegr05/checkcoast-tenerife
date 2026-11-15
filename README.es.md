# CheckCoast Tenerife

[English](README.md) | **Español**

[![CI](https://github.com/ayozegr05/checkcoast-tenerife/actions/workflows/ci.yml/badge.svg)](https://github.com/ayozegr05/checkcoast-tenerife/actions/workflows/ci.yml)
[![backend coverage](https://img.shields.io/codecov/c/github/ayozegr05/checkcoast-tenerife?flag=backend&label=backend&logo=codecov)](https://codecov.io/gh/ayozegr05/checkcoast-tenerife/tree/main/backend)
[![frontend coverage](https://img.shields.io/codecov/c/github/ayozegr05/checkcoast-tenerife?flag=frontend&label=frontend&logo=codecov)](https://codecov.io/gh/ayozegr05/checkcoast-tenerife/tree/main/frontend)

App cívica para bañistas de Tenerife: **¿puedo bañarme hoy en esta playa?**

El portal oficial (Náyade, Ministerio de Sanidad) no recoge todos los
cierres — y cuando lo hace, no dice *por qué*. CheckCoast combina el
estado oficial con prensa local analizada por LLM: cierres que Sanidad
no captura (desprendimientos, obras, vertidos) más el motivo detrás de
los que sí, manteniendo ambas fuentes siempre separadas y etiquetadas.

**API en producción**: https://checkcoast.duckdns.org — docs
interactivas en `/docs`, página web pública por playa en `/b/{id}` y
por emisario en `/o/{id}` (los enlaces que comparte la app), más una
landing con el mapa en vivo.

<table>
<tr>
<td width="25%"><b>Toda la isla en un mapa</b></td>
<td width="25%"><b>Cierres que Náyade no explica</b></td>
<td width="25%"><b>Emisario ilegal, sin depurar, en zona protegida</b></td>
<td width="25%"><b>Emisarios cerca de la playa</b></td>
</tr>
<tr>
<td><img src="docs/screenshots/01-mapa.jpg"></td>
<td><img src="docs/screenshots/03-benijo-prensa.jpg"></td>
<td><img src="docs/screenshots/04-emisario-puntablanca.jpg"></td>
<td><img src="docs/screenshots/06-jardin-emisarios-calidad.jpg"></td>
</tr>
</table>

<details>
<summary><b>Más capturas</b></summary>
<br>
<table>
<tr>
<td width="25%"><b>Alertas activas</b></td>
<td width="25%"><b>Emisario en estado precario</b></td>
<td width="25%"><b>Ranking por municipio</b></td>
<td width="25%"><b>180 puntos de descarga en la isla</b></td>
</tr>
<tr>
<td><img src="docs/screenshots/02-alertas.jpg"></td>
<td><img src="docs/screenshots/05-emisario-sanjuan.jpg"></td>
<td><img src="docs/screenshots/07-municipios.jpg"></td>
<td><img src="docs/screenshots/08-mapa-emisarios.jpg"></td>
</tr>
</table>
</details>

## Qué hace

- 🗺️ **Mapa de la isla** — ~200 puntos de baño (62 monitorizados
  oficialmente + ~130 de OpenStreetMap) y ~180 puntos de vertido
  (emisarios submarinos), con alertas pulsantes sobre las playas
  cerradas
- 🚩 **Estado oficial en tiempo real** — scraper del portal Náyade con
  reintentos, sincronizado cada hora: abierta / aviso / cerrada
- 📰 **"En la prensa"** — pipeline Google News RSS → LLM (Gemini) que
  extrae playa + evento + causa (vertido, fuel, algas, obras…) y lo
  muestra etiquetado *"según prensa"* — nunca mezclado con el estado
  oficial
- 🔔 **Notificaciones push** — aviso cuando una playa se cierra o reabre
  (Expo Push Service)
- 🧪 **Calidad del agua** — histórico de mediciones (E. coli /
  enterococo, umbrales RD 1341/2007) con evolución y ranking por
  municipio
- 📊 **Vista Temporada** — episodios insulares (junio-septiembre)
  reconstruidos desde evidencia oficial + prensa, agrupados por playa
  base y municipio
- 🏭 **Índice de riesgo de emisarios** — estado legal de cada punto de
  vertido, estimación de riesgo propia y prensa casada al emisario o a
  su zona; los episodios cercanos llevan siempre disclaimer de
  no-causalidad
- 🔍 **Lista completa** — buscador, filtros por municipio y por estado,
  ordenación por estado/cierres/calidad del agua y modo **"Agua siempre
  apta"** (sin muestras malas ni contaminación oficial o de prensa);
  agrupa puntos de muestreo por playa
- 🔗 **Páginas web compartibles** — cada playa y emisario tiene página
  pública (`/b/{id}`, `/o/{id}`) con tarjeta social; la web pública
  muestra el mapa y los cierres en vivo — futuro punto de descarga
  de la app

## Arquitectura

```mermaid
flowchart LR
    subgraph Fuentes["Fuentes de datos"]
        N["Náyade / MITECO<br>estado oficial"]
        C["Gob. Canarias<br>censo vertidos"]
        O["OpenStreetMap<br>playas"]
        P["Google News RSS<br>prensa local"]
    end
    subgraph Backend["Backend — FastAPI + PostGIS"]
        S["Scrapers + scheduler<br>cada 1h"]
        L["Gemini LLM<br>extracción noticias"]
        DB[("PostgreSQL + PostGIS")]
        API["API REST · GeoJSON"]
    end
    subgraph App["App — Expo / React Native"]
        M["Mapa MapLibre"]
        LI["Lista + fichas"]
        PU["Push notifications"]
    end
    subgraph Web["Web — FastAPI + Jinja"]
        W["Landing + fichas /b/ /o/"]
    end
    N --> S
    C --> S
    O --> S
    P --> L
    S --> DB
    L --> DB
    DB --> API
    API --> M
    API --> LI
    API --> PU
    API --> W
```

- **Backend**: FastAPI · SQLAlchemy 2 + GeoAlchemy2 · Alembic ·
  APScheduler · Python 3.12
- **Datos**: PostgreSQL 16 + PostGIS 3.4
- **Frontend**: Expo SDK 57 · React Native 0.86 · TypeScript ·
  MapLibre (basemap OSM + satélite Esri) · Expo Notifications
- **Infra**: Docker Compose (DB + API) · GitHub Actions CI · EAS Build

## Puesta en marcha

### Opción A — todo en Docker

```bash
docker compose up -d        # PostGIS + API (alembic migra solo al arrancar)
```

API en `http://localhost:8001` — docs interactivas en `/docs`.

> **Variables de entorno**: crea un `.env` en la raíz con
> `GEMINI_API_KEY=...` ([aistudio.google.com](https://aistudio.google.com),
> free tier) para activar la extracción LLM de prensa. Sin ella el resto
> funciona igual — solo las noticias quedan sin procesar.
> `ADMIN_API_KEY` protege el cambio manual de estado (sin ella ese
> endpoint queda deshabilitado).
> `DATABASE_URL` tiene default local; el resto de vars
> (`NAYADE_SYNC_SECONDS`, `GEMINI_MODEL`…) también
> — ver `backend/app/config.py`.

### Opción B — API en local (desarrollo con `--reload`)

```bash
docker compose up -d db           # solo PostGIS
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows PowerShell
pip install -r requirements.txt
copy .env.example .env
alembic upgrade head
python -m scripts.ingest_outfalls     # ~180 puntos de vertido
python -m scripts.ingest_beaches      # 61 puntos de muestreo oficiales
python -m scripts.ingest_osm_beaches  # ~106 playas OSM
python -m scripts.ingest_beach_status # estado Náyade (primera carga)
uvicorn app.main:app --reload --port 8001
```

### Frontend

```bash
cd frontend
npm install
npx expo start --dev-client --port 8082
```

> **Nota:** la app usa MapLibre (módulo nativo) → necesita una
> *development build* instalada en el dispositivo
> (`eas build --profile development`), no funciona con Expo Go.
> `EXPO_PUBLIC_API_URL` apunta a la IP local del PC.

## API

| Endpoint | Descripción |
|---|---|
| `GET /beaches` | GeoJSON de playas con estado oficial + `reported_at` |
| `GET /beaches/{id}/quality` | Mediciones de calidad del agua |
| `GET /beaches/{id}/incidents` | Incidentes oficiales (cierres/aperturas) |
| `GET /beaches/{id}/news` | Noticias relacionadas (extracción LLM) |
| `GET /beaches/{id}/nearby-outfalls` | Emisarios cercanos a la playa |
| `GET /beaches/stats` | Agregados por municipio (ranking) |
| `GET /episodes` | Episodios insulares (oficiales + reconstruidos), por playa base |
| `GET /outfalls` | GeoJSON de vertidos (`?status=legal\|illegal\|unknown`) |
| `GET /outfalls/{id}/news` | Prensa casada al emisario o a su zona |
| `GET /alerts` | Alertas activas — campo `via`: `official` / `press` |
| `GET /health` | Salud de jobs + contadores de error (monitorización) |
| `POST /beaches/{id}/status` | Cambio manual de estado (respaldo del scraper) — requiere cabecera `X-Admin-Key` |
| `POST /devices` | Registro de Expo push tokens |

## Testing y CI

```bash
cd backend && .venv\Scripts\python -m pytest tests/ -q   # ~290 tests
cd frontend && npx tsc --noEmit && npm test              # typecheck + ~300 tests
cd backend && ruff check . && ruff format --check .      # lint + formato Python
cd frontend && npm run format:check                      # formato Prettier
```

GitHub Actions levanta un PostGIS de servicio, ejecuta
`alembic upgrade head`, pasa Ruff y Prettier y corre ambas suites con fixtures sintéticos
(sin dependencia de datos reales).

## Fuentes de datos oficiales

| Dato | Fuente |
|---|---|
| Emisarios y vertidos tierra-mar | Censo de Vertidos 2025 — Gobierno de Canarias ([SITCAN Open Data](https://opendata.sitcan.es/dataset/actualizacion-del-censo-de-vertidos-desde-tierra-al-mar-ano-2025)) |
| Zonas de baño y calidad del agua | Censo Nacional de Zonas de Aguas de Baño 2025 — MITECO / sistema Náyade |
| Estado de cierre en tiempo real | Portal Náyade — Ministerio de Sanidad (scraping) |
| Playas no monitorizadas | OpenStreetMap (`natural=beach`, vía Overpass) |
| Contexto de cierres | Google News RSS — medios locales de Tenerife |

## Notas de dominio

- **"Abierta" ≠ "segura"**: significa *sin incidencia oficial activa* —
  la app nunca promete seguridad, solo refleja datos oficiales
- Las playas OSM (gris) son **no monitorizadas**: el estado oficial no
  las cubre
- El contenido de prensa va siempre etiquetado y separado del estado
  oficial — ver [DECISIONS.md](DECISIONS.md)

## Estructura

```
├── backend/            # FastAPI + ingesta + pipeline de prensa
│   ├── app/            # routers, modelos, scraper, LLM, notify
│   ├── alembic/        # migraciones
│   ├── scripts/        # ingesta de fuentes oficiales
│   └── tests/          # pytest (fixtures sintéticos)
├── frontend/           # Expo + React Native + MapLibre
│   ├── components/     # mapa, lista, ficha, ranking municipal
│   └── lib/            # api, notificaciones, formato
├── docker-compose.yml  # PostGIS + API
└── .github/workflows/  # CI: backend + frontend
```

## Licencia

[MIT](LICENSE)

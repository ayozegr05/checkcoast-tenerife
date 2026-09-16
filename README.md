# CheckCoast Tenerife

Aplicación cívica de mapeo en tiempo real para Tenerife: localización de
emisarios submarinos y puntos de vertido (autorizados y no autorizados) y estado
de las zonas de baño, construida sobre fuentes de datos oficiales.

Stack: **FastAPI + PostGIS** (backend) · **Expo / React Native + MapLibre** (frontend) · **Docker Compose** (DB).

## Estructura

```
├── backend/            # API FastAPI + scripts de ingesta
│   ├── app/            # routers, modelos, schemas
│   ├── alembic/        # migraciones de base de datos
│   └── scripts/        # ingesta de fuentes oficiales
├── frontend/           # app Expo (React Native + MapLibre)
├── docker-compose.yml  # PostgreSQL 16 + PostGIS 3.4 (puerto 5433)
└── ROADMAP.md          # hitos del proyecto
```

## Puesta en marcha

### 1. Base de datos

```bash
docker compose up -d
```

PostgreSQL 16 + PostGIS en `localhost:5433` (usuario/db: `checkcoast`).

### 2. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows PowerShell
pip install -r requirements.txt
copy .env.example .env
alembic upgrade head          # crea el esquema
python -m scripts.ingest_outfalls   # 180 puntos de vertido (Tenerife)
python -m scripts.ingest_beaches    # 61 zonas de baño (Tenerife)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

API en `http://localhost:8001` — docs interactivas en `/docs`.

| Endpoint | Descripción |
|---|---|
| `GET /health` | Health check |
| `GET /outfalls` | GeoJSON de vertidos; filtros `?status=legal\|illegal\|unknown`, `?kind=` |
| `GET /beaches` | GeoJSON de zonas de baño |
| `GET /beaches/{id}/status` | Último estado conocido |
| `GET /alerts` | Playas con alerta de cierre activa |

Tests: `pytest tests/ -q`

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env          # ajusta EXPO_PUBLIC_API_URL a la IP local del PC
npx expo start --dev-client
```

> **Nota:** la app usa MapLibre (módulo nativo) → necesita una *development build*
> instalada en el dispositivo (`eas build --profile development`), no Expo Go.

## Fuentes de datos oficiales

| Dato | Fuente |
|---|---|
| Emisarios y vertidos tierra-mar | Censo de Vertidos 2025 — Gobierno de Canarias ([SITCAN Open Data](https://opendata.sitcan.es/dataset/actualizacion-del-censo-de-vertidos-desde-tierra-al-mar-ano-2025)) |
| Zonas de baño | Censo Nacional de Zonas de Aguas de Baño 2025 — MITECO / sistema Náyade |

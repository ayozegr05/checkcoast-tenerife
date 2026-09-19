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

## Hito 5b — Orientación al bañista ✅

Funciones para acercar la app al objetivo: avisar al bañista del estado de cada playa.

1. [x] **Lista de playas** con buscador, orden por estado (cerradas primero) y filtro por municipio — vista rápida "¿dónde me baño hoy?"
2. [x] **Historial de incidentes** en el panel de detalle (fechas y motivo de cada cierre)
   - Soporte backend: tabla `beach_incidents`, scraper v2 (solo Tenerife + municipios), `GET /beaches/{id}/incidents`, `status` embebido en `/beaches`
3. [x] **Calidad del agua**: tabla `beach_measurements` (fecha, E. coli, enterococo, evaluación) scrapeada de la pestaña Muestreos de Náyade; `GET /beaches/{id}/quality` + "Último análisis" en el panel de detalle
4. [x] **Notificaciones** al cambiar el estado de una playa: `POST /devices` registra Expo push tokens, `notify.py` envía vía Expo Push Service desde el scraper y el POST manual (cierre/aviso/reapertura, con `beach_id` para deep-link); frontend registra el token al arrancar, canal Android `alerts`, tap abre la ficha. **Requiere nuevo `eas build --profile development` para funcionar** (módulo nativo)
5. [x] **Capa de playas no monitorizadas** desde OSM (`natural=beach` vía Overpass; +106 playas, dedup vs censo oficial por nombre/distancia; gris en mapa y "No monitorizada" en lista)
6. [x] **Vista por municipio**: ranking de incidencias agregado por municipio (cerradas/avisos ahora, incidentes totales y último año, muestras no aptas) con barra de severidad; acceso desde botón «Municipios» en el mapa y desde la lista de playas; tocar un municipio abre la lista filtrada
7. [x] **UX lista de playas**: PMs agrupados por playa (filas expandibles con último análisis e incidentes inline; conteo de playas por nombre base), detalle dentro del modal con foto satélite Esri + «Ver en mapa» + atrás, estado de la lista persistido entre aperturas; `BeachDetail` compartido con `FeatureSheet`

## Hito 5c — Identidad visual 🚧

La app funciona pero se ve genérica (Material por defecto, icono Expo).
Tres niveles, en orden de impacto/esfuerzo:

1. [x] **Identidad básica**: `lib/theme.ts` con paleta oceánica (mar
   profundo, turquesa, arena) + Nunito vía `useFonts` + icono/splash
   check+ola generados (`scripts_gen_icon.py`) + colores de estado
   unificados mapa/lista/detalle (apta=verde mar)
2. [x] **UI con carácter**: banner de estado sobre el mapa (pill con
   cierres/avisos vivos, tap → lista), ficha como bottom-sheet
   arrastrable (PanResponder+Animated: peek/expandida/deslizar-cerrar),
   headers con degradado mar (PNG `gradient-sea.png` — evita
   expo-linear-gradient nativo), halo pulsante en playas con alerta
3. [x] **Mapa temático**: basemap vectorial OpenFreeMap (OpenMapTiles)
   retenido con la paleta via `scripts_gen_mapstyle.py` →
   `assets/mapstyle-sea.json` (mar turquesa, tierra arena, etiquetas
   azul pizarra); toggle satélite Esri intacto. Markers: chinchetas
   `pin-{estado}.png` generadas (aro de color + sombrilla navy)

## Hito 5d — Datos completos y refinado UI ✅

- [x] **Municipios completos**: `assign_municipalities.py` + GeoJSON de
  límites de los 31 municipios (OSM admin_level=8) → punto-en-polígono
  con PostGIS; 107 playas asignadas, "Sin municipio" eliminado;
  enganchado al ingest OSM para futuras playas
- [x] **Grafías naturales**: `Rosario (El)` → `El Rosario`,
  `Orotava (La)` → `La Orotava`, `Realejos (Los)` → `Los Realejos`;
  scraper Náyade normaliza al parsear (sin riesgo de duplicados)
- [x] **Conteo correcto en ranking**: las playas no monitorizadas suman
  al conteo de playas por municipio (Adeje 9→18); incidentes siguen
  saliendo solo de las oficiales
- [x] **Lista de Vertidos** (`OutfallList`): botón en topbar, 180
  emisarios con conteos por estado, chips de estado y municipio,
  búsqueda, orden por severidad, tap → vuela al punto y abre ficha
- [x] **Terminología censo**: `unknown` mostrado como "En trámite" (valor
  oficial `EstExpVC` del censo) en lista, leyenda y ficha; mapping
  explícito en `ingest_outfalls.py`
- [x] **Navegación**: ranking → lista filtrada → atrás vuelve al ranking;
  fix de estado residual (ficha vieja al reabrir lista tras "Ver en mapa");
  filtro de tres estados (undefined/null/string)
- [x] **Topbar**: barra redondeada con chips con borde por sección
  (Playas · Vertidos · Municipios | Satélite | Ayuda), pill de aviso
  integrado debajo con borde blanco interno e icono de alerta
- [x] **Leyenda**: abajo-izquierda, filas "Vertidos"/"Playas" como
  cabecera-botón con switch ON/OFF
- [x] **Pins definitivos**: playa = sombrilla Twemoji 🏖️ teñida del
  color de estado; vertido = grifo + gota separada cayendo del caño
- [x] **Iconos topbar**: mapa/satélite, ayuntamiento (Municipios), grifo
  (Vertidos), salvavidas (Ayuda) — todos en `scripts_gen_icon.py`
- [x] **IntroCard temática**: header degradado mar, hints con iconos
  reales, checkbox "No volver a mostrar" + AsyncStorage (persistencia
  activa tras próxima build), re-apertura desde botón Ayuda
- [x] **Contexto vertido↔playa** (6.1): `GET /outfalls/{id}/nearest-beach`
  y `GET /beaches/{id}/nearby-outfalls` (ST_Distance geography) —
  "a 350 m de Playa X" en la ficha del vertido y "Emisarios cercanos"
  en la de playa
- [x] **Gráfica de evolución** (6.2): barras log-escala por muestreo en
  `BeachDetail`, línea de límite normativo, etiquetas de año, línea
  roja vertical marcando incidentes interpolada por fecha
- [x] **Cobertura OSM ampliada**: `natural=beach` también en relations
  (multipolígonos de Anaga) → +23 playas (Benijo, Roque de las Bodegas,
  Tachero, Antequera...); mirrors de Overpass con fallback;
  `add_manual_beaches.py` para zonas sin tag OSM (Almáciga, El Tablado)

## Hito 6 — Funcionalidades y datos ✅ *(6.3 aplazada por decisión)*

| # | Tarea | Estado | Esfuerzo |
|---|-------|--------|----------|
| 6.1 | **Distancia vertido↔playa**: en ficha de vertido, "a 350 m de Playa X" (ST_Distance PostGIS, nearest beach) — convierte el dato en historia | ✅ Hecho (`GET /outfalls/{id}/nearest-beach` + caja destacada en FeatureSheet) | 🟡 Medio |
| 6.2 | **Gráfica histórica de calidad**: mini-gráfica E. coli/enterococo por fecha en `BeachDetail` (~3.200 mediciones ya en BD) | ✅ Hecho (barras log-escala coloreadas por clase + línea de límite normativo, Views planos sin deps nativas) | 🟡 Medio |
| 6.3 | **Favoritos + notificaciones dirigidas**: marcar playas favoritas (tabla `beach_favorite` + `notify_mode` por dispositivo), push solo de esas playas | ⏸️ **Aplazada**: ~13 incidentes/temporada no saturan; las alertas de toda la isla ayudan a elegir dónde bañarse. Reactivar si el volumen de alertas crece (prensa, medusas...) | 🔴 Alto |
| 6.4 | **Filtro por estado en lista de playas**: chips cerrada/aviso/sin datos/apta/no monitorizada | ✅ Hecho (`e657ef7`) | 🟢 Trivial |
| 6.5 | **Búsqueda desde el mapa**: campo en topbar que busque playas/vertidos/municipios y vuele al punto | ✅ Hecho (`89ec333`) | 🟡 Medio |
| 6.6 | **Compartir estado de playa** (Share API: texto + deep-link) | ✅ Hecho (`a79d91c`) | 🟢 Trivial |
| 6.7 | (extensión) Timeline de incidentes por municipio en la ficha del municipio | ✅ Hecho (`066ba2b`) | 🟡 Medio |
| — | **Bonus 6.x**: agrupación de pins por playa (1 pin/peor estado + selector de PMs + dots etiquetados en mapa), nombres oficiales de playa (`lib/format.ts`: "Playa del Bobo", romanos, acentos), bottom-sheet anclado con "Ver más" | ✅ Hecho (`fa6f49c`, `461553c`, `1647113`) | 🟡 Medio |

## Hito 7 — Pulido visual ⬜

| # | Tarea | Estado | Esfuerzo |
|---|-------|--------|----------|
| 7.1 | Cabecera de ficha teñida por estado (degradado rojo/naranja/verde sutil) | ✅ Hecho (tinta 8% + línea de acento superior en playas y vertidos) | 🟢 Trivial |
| 7.2 | Top 3 del ranking destacado (badge/medalla visual) | ✅ Hecho (círculo oro/plata/bronce en el podio, neutro desde el 4º; la barra sigue marcando la severidad) | 🟢 Trivial |
| 7.3 | Skeletons de carga en listas (en vez de spinner/nada) | ✅ Hecho (componente Skeleton sea-glass con pulso; ficha de playa + línea temporal de municipio) | 🟢 Trivial |
| 7.4 | Animación de entrada de la card (slide-up ~200ms) | ✅ Hecho (spring de apertura de la bottom-sheet; + borde y sombra reforzados para destacar del mapa/leyenda) | 🟢 Trivial |
| 7.5 | Accessibility labels en controles principales | ✅ Hecho (auditoría completa: chips, filas, buscadores, selector PM, switches, toggle gráfica) | 🟡 Medio |

## Hito 8 — Calidad y despliegue ⬜

| # | Tarea | Estado | Esfuerzo |
|---|-------|--------|----------|
| 8.1 | **Build EAS de validación**: verificar push notifications + AsyncStorage en build real | Pendiente | 🟡 Medio |
| 8.2 | **Dockerizar API**: servicio `api` en docker-compose | Pendiente | 🟡 Medio |
| 8.3 | **Deploy backend** (Railway/Fly/Render) + Postgres PostGIS + migrar datos → app apuntando a URL real (requisito para notifs en producción) | Pendiente | 🔴 Medio-alto |
| 8.4 | **CI básico**: GitHub Actions con `pytest` + `tsc --noEmit` en push | ✅ Hecho — `.github/workflows/ci.yml` (PostGIS service + alembic + fixture sintético `seed_data` en conftest; backend ya no depende de la BD dev) | 🟢 Trivial |
| 8.5 | Tests frontend mínimos (jest-expo): lógica agrupación PM→playa, orden por estado | ✅ Hecho — 22 tests en `__tests__/` (lógica pura extraída a `lib/beachGroups.ts`, `lib/press.ts`, `lib/format.ts`) | 🟡 Medio |
| 8.6 | Actualizar a Node LTS (Expo pide ≥20.19.4, hoy 20.12.2) | ✅ Hecho — Node 24.21.0 LTS vía nvm (`nvm use 24.21.0`) | 🟢 Trivial |
| 8.7 | Revocar token de Expo expuesto en sesión anterior *(usuario, en expo.dev)* | Pendiente | 🟢 Trivial |

## Hito 8.5 — Contexto de prensa (LLM) ✅

Responder "¿por qué está cerrada?" que Náyade no contesta: noticias
locales → LLM extrae playa/evento/causa → se muestra etiquetado como
"según prensa" (nunca mezclado con el estado oficial).

| # | Tarea | Estado | Esfuerzo |
|---|-------|--------|----------|
| 8.5.1 | **Fuente de noticias**: **Google News RSS** (`news.google.com/rss/search`, query "playa tenerife + evento") — agrega toda la prensa canaria + webs oficiales en una llamada. GDELT descartado en spike: 429 persistente y su índice busca traducciones al inglés, no el texto español | ✅ Hecho | 🟡 Medio |
| 8.5.2 | **Extracción LLM**: `extract_event(article) → EventExtraction` — **Gemini Flash free tier** vía REST (sin SDK), JSON forzado por esquema, thinking off, retries 429/5xx; detrás de interfaz (`NewsExtractor`). Modelo `gemini-3.5-flash` (2.5 deprecado; 3.6 sin cuota en free tier). Validado en spike: 27/100 relevantes, sin falsos positivos | ✅ Hecho | 🟡 Medio |
| 8.5.3 | **Matching conservador**: `match_beaches()` — clave `_press_key` (normaliza inversión MITECO "CABEZO (EL)"→"EL CABEZO", quita "PLAYA DE…") + municipio con alias; multi-PM de la misma playa replica la noticia; ambiguo → no se muestra | ✅ Hecho | 🔴 La parte difícil |
| 8.5.4 | **Backend**: tabla `news_items` (dedup `(url, beach_id)`, guarda también no relevantes/no casados para dedup y re-match) + job APScheduler `news-sync` (6 h) + `GET /beaches/{id}/news` | ✅ Hecho | 🟡 Medio |
| 8.5.5 | **Frontend**: caja "En la prensa" en `BeachDetail` (titular enlazable + medio + fecha + tipo/causa, etiqueta "según prensa") | ✅ Hecho | 🟢 Trivial |
| 8.5.6 | **Cobertura de fuente**: 3 queries temáticas RSS (contaminación / cierres-reaperturas / obras-riesgo físico), dedup por URL, blocklist SEO-farms; robustez ante timeouts, 429 y extracciones malformadas (validación de campos, commit por artículo) | ✅ Hecho (`cf59dcb`) | 🟡 Medio |
| 8.5.7 | **Resumen determinista**: `summary` en `/beaches/{id}/news` (evento+causa dominantes, nº medios, `since`) sin llamadas LLM; banner ámbar junto al estado, titulares plegables agrupados por evento al final de la ficha | ✅ Hecho (`1fa0080`, `d55f52a`, `f5c5de8`) | 🟡 Medio |
| 8.5.8 | **Alertas de prensa en `/alerts`**: cierre/aviso según prensa entra en la lista normal (`via="press"`); verificación mixta — oficial open + cierre fresco ≤14 d alerta (lag de Náyade), `closed_at` posterior al titular = reapertura probada, sin cobertura <21 d no alerta; warning oficial + prensa dominada por cierres ⇒ se muestra `closed` | ✅ Hecho (`bf08a1d`, `27e1ad9`, `3418e7d`) | 🔴 Alto |
| 8.5.9 | **Banner con ciclo de vida**: "Cerrada por X · desde el D" solo si sigue cerrada; "Estuvo cerrada · el D" + "Sanidad la reabrió el D2" cuando el incidente oficial cerró ≤15 d tras el titular | ✅ Hecho (`3f6bca1`, `121f402`) | 🟡 Medio |

## Hito 9 — Portfolio ⬜

| # | Tarea | Estado | Esfuerzo |
|---|-------|--------|----------|
| 9.1 | README completo: qué es, features, stack, fuentes de datos, cómo ejecutar | Pendiente | 🟡 Medio |
| 9.2 | Screenshots/GIF de la app (mapa, ranking, vertidos, ficha) | Pendiente | 🟢 Trivial |
| 9.3 | Diagrama de arquitectura (Expo → FastAPI → PostGIS ← scrapers/fuentes) | Pendiente | 🟢 Trivial |
| 9.4 | Documentar decisiones técnicas (MapLibre vs Google, SDF teñido, scraper Náyade, PM↔playa) | Pendiente | 🟢 Trivial |

---

### Estado actual
**Hito activo:** 8 — Calidad y despliegue (8.5 prensa LLM completo:
pipeline + resumen + alertas mixtas oficial/prensa)
**Última actualización:** 2026-09-19

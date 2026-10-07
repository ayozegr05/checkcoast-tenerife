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
   check+ola generados (`frontend/scripts/gen_icon.py`) + colores de estado
   unificados mapa/lista/detalle (apta=verde mar)
2. [x] **UI con carácter**: banner de estado sobre el mapa (pill con
   cierres/avisos vivos, tap → lista), ficha como bottom-sheet
   arrastrable (PanResponder+Animated: peek/expandida/deslizar-cerrar),
   headers con degradado mar (PNG `gradient-sea.png` — evita
   expo-linear-gradient nativo), halo pulsante en playas con alerta
3. [x] **Mapa temático**: basemap vectorial OpenFreeMap (OpenMapTiles)
   retenido con la paleta via `frontend/scripts/gen_mapstyle.py` →
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
  (Vertidos), salvavidas (Ayuda) — todos en `frontend/scripts/gen_icon.py`
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
| 7.6 | Mar de la vista satélite (costuras de tile PNOA en mar abierto) | ✅ Decisión consciente (2026-09-28): se queda **PNOA sin procesar** (sin capas sintéticas encima). Evaluadas y descartadas: batimetría Esri/GEBCO (artefactos de sonar + velo sobre tierra), `fill-pattern` con textura clonada/sintética (efecto toalla/losa), Sentinel-2 EOX (tierra muy suave), Esri World Imagery (tiles negros en Anaga/Teide), velo de color plano (artificioso). Las costuras son inherentes a la ortofoto libre — Google usa un mar sintético procesado de pago, no una foto real | 🟡 Medio (evaluación) |

## Hito 8 — Calidad y despliegue ⬜

| # | Tarea | Estado | Esfuerzo |
|---|-------|--------|----------|
| 8.1 | **Build EAS de validación**: verificar push notifications + AsyncStorage en build real | ✅ Hecho — APK preview `09ad1cd4` instalado; test end-to-end real: POST cierre → push "Cierre de baño" + deep-link a ficha, POST reapertura → push "Reapertura"; limpieza de los estados ficticios tras la demo | 🟡 Medio |
| 8.2 | **Dockerizar API**: servicio `api` en docker-compose | ✅ Hecho — `backend/Dockerfile` (python:3.12-slim) + servicio `api` en compose; `alembic upgrade head` al arrancar, healthcheck, `GEMINI_API_KEY` vía `.env` raíz | 🟡 Medio |
| 8.3 | **Deploy backend** (Railway/Fly/Render) + Postgres PostGIS + migrar datos → app apuntando a URL real (requisito para notifs en producción) | ✅ Hecho — backend + PostGIS desplegados en VM (`130.110.233.198:8001`); el perfil `preview` de EAS apunta ahí vía `EXPO_PUBLIC_API_URL` | 🔴 Medio-alto |
| 8.4 | **CI básico**: GitHub Actions con `pytest` + `tsc --noEmit` en push | ✅ Hecho — `.github/workflows/ci.yml` (PostGIS service + alembic + fixture sintético `seed_data` en conftest; backend ya no depende de la BD dev) | 🟢 Trivial |
| 8.5 | Tests frontend mínimos (jest-expo): lógica agrupación PM→playa, orden por estado | ✅ Hecho — 22 tests en `__tests__/` (lógica pura extraída a `lib/beachGroups.ts`, `lib/press.ts`, `lib/format.ts`) | 🟡 Medio |
| 8.6 | Actualizar a Node LTS (Expo pide ≥20.19.4, hoy 20.12.2) | ✅ Hecho — Node 24.21.0 LTS vía nvm (`nvm use 24.21.0`) | 🟢 Trivial |
| 8.7 | Revocar token de Expo expuesto en sesión anterior *(usuario, en expo.dev)* | ✅ Hecho (2026-09-23) | 🟢 Trivial |

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
| 8.5.10 | **Push de alertas de prensa**: cierre/aviso detectado por noticias también notifica — antes que el parte oficial. Mismo formato + "· según prensa"; dedup 7 días por playa+evento (no un push por titular), sin push si el estado oficial ya lo cubre o la noticia es vieja (recasada) | ✅ Hecho | 🟡 Medio |

## Hito 8.6 — Reconstrucción de episodios y UX de fichas ✅

- [x] **Síntesis de eventos** (`events.py`): episodios `measurement`/`press`
  fusionados temporalmente; la última reapertura de prensa posterior a la
  última muestra mala fija el cierre real (El Pris cierra el 13-abr, no el
  25-may); si una muestra prohibida posterior la desmiente, manda la
  analítica y la reapertura queda como anotación (La Pinta)
- [x] **Cobertura retroactiva**: prensa real insertada para Troya I/II y
  El Puertito (mayo-2025, anterior al arranque del pipeline RSS)
- [x] **`SatelliteShot` compartido**: foto Esri en fichas de playa Y
  emisario, zoom ± (cerca ~1,2 km / lejos ~3 km, prefetch), overlays de
  playas y emisarios con iconos, botón 🗺 «Ver en mapa» → pin grande a
  zoom 15,5
- [x] **Navegación cruzada**: «Emisarios cercanos» ↔ «Playa más cercana»
  navegables con stack de retorno; `BackHandler` Android cierra la ficha
  (o restaura la anterior) en vez de salir de la app
- [x] **Retorno a listas**: cerrar ficha vuelve a municipios / lista de
  playas / lista de emisarios según origen
- [x] **Pins**: el seleccionado siempre destaca (normales 0,32/0,36 vs
  0,45 a zoom 16)
- [x] **Cabecera Emisarios**: dato primero («180 puntos · 121 sin
  autorizar»), fuente atenuada debajo
- [x] **Fix Android**: `lineHeight` explícito en textos pequeños del mapa
  (leyenda cortaba «Autorizado», «En trámite»…); ayuda actualizada

## Hito 8.7 — Precedencia de eventos y estado efectivo ✅

La app compara **cuándo pasó** cada cosa, no cuándo se publicó: Náyade
llega tarde (la muestra lleva `sampled_at`, la incidencia
`opened_at`/`closed_at`) y la prensa da la fecha real del evento.

- [x] **Matching de prensa afinado**: match exacto gana a contenciones
  del mismo municipio («El Médano» → PM3, no se diluye entre Chica y
  Leocadio Machado; «Leocadio Machado» sigue yendo a la suya);
  titulares multi-playa casan con cada nombre literal («El Médano y El
  Socorro cierran» → ambas); alias «Granadilla» → «Granadilla de
  Abona» (`d494207`)
- [x] **Rezago de Náyade**: muestra mala tomada *antes* de una
  reapertura de prensa = mismo episodio publicado tarde → la medición
  se graba pero no cambia estado ni notifica (`2794b58`)
- [x] **Matriz de precedencia completa**: incidencias abiertas con
  `opened_at` anterior a la reapertura también son rezago; muestra
  oficial tomada *después* de un cierre de prensa prueba reapertura;
  cualquier evidencia oficial posterior a la reapertura = evento nuevo
  → cerrada + push (`5f7e646`)
- [x] **Push de reaperturas**: «Reapertura · municipio · según prensa»
  solo si había algo que reabrir (alerta de prensa ≤21 d o estado
  oficial no-open) — una reapertura suelta no despierta el móvil
  (`7e9170d`)
- [x] **Estado efectivo unificado**: `effective_states()` en
  `queries.py` alimenta `/alerts` + `/beaches` (pins) +
  `/beaches/{id}/status` — mapa, banner y ficha dicen lo mismo;
  `status_via` conserva la procedencia y el `BeachStatus` crudo sigue
  en el historial (`ebb0042`)

## Hito 8.8 — Compartir con tarjeta rica 🚧

El share de 6.6 mandaba texto plano con un `checkcoast://` que WhatsApp
no convierte en enlace. Objetivo: que al compartir una playa llegue una
**tarjeta con foto** (Open Graph) como una noticia.

- [x] **Landing pública por playa** `GET /b/{id}` (`routers/share.py`):
  HTML con `og:title`/`og:description`/`og:image` (foto satélite Esri
  vía `export?bbox=`), mini-ficha con degradado mar, chip de estado,
  botón "Abrir en la app" (`checkcoast://beach/{id}`) y créditos
  (`8dba5a5`, `fef3754`)
- [x] **Frontend**: `beachShareUrl()` en `lib/api.ts`; el mensaje de
  share lleva la URL pública en vez del esquema propio
- [x] **Dominio + HTTPS**: WhatsApp/Telegram NO generan preview en URLs
  con IP pelada + puerto raro. `checkcoast.duckdns.org` → VM + **Caddy**
  en compose (perfil `prod`, TLS automático Let's Encrypt, proxy a la
  api); share URL → `https://checkcoast.duckdns.org/b/{id}` (`b6d586e`)
- [x] **Mini-ficha rica**: pins PNG del mapa servidos en `/icons`
  (sombrilla + grifos posicionados por coordenadas), lista "Emisarios
  cercanos" con estado/distancia, caja "según prensa", zoom
  Acercar/Alejar con dos encuadres Esri (`a927556`, `f655d63`, `aaa6fa0`)
- [x] **Android App Links**: intent-filter `autoVerify` para
  `https://checkcoast.duckdns.org/b/*` + `/.well-known/assetlinks.json`
  con el fingerprint del keystore EAS (`ANDROID_CERT_SHA256` en `.env`
  de la VM) — el link abre la app directo si está instalada (`b8ad36e`,
  `4bad920`)
- [ ] **Verificación end-to-end**: compartir desde la app → tarjeta con
  foto en WhatsApp/Telegram + link abre la app instalada

## Hito 8.9 — Extracción híbrida de prensa ✅

Caso disparador: Benijo mostraba causa "Acceso" cuando la razón real del
cierre es el peligro de desprendimientos. Dos fallos encadenados: el
LLM extraía mecanismos ("acceso prohibido") y respuestas ("obras de
emergencia") como si fueran la causa, y la moda amplificaba el ruido
(5 acceso / 4 obras / 1 desprendimientos).

- [x] **Prompt redefinido** (`news_llm.py`): `cause` = razón de fondo
  (vertido, bacterias, desprendimientos, temporal); nunca mecanismo
  (vallado, multas, acceso prohibido) ni respuesta administrativa;
  reapertura solo si la playa YA está abierta — "obras PARA reabrir"
  no es reopening
- [x] **Segunda pasada con cuerpo del artículo** (`news_resolve.py`):
  si el titular no casa playa o no revela la causa → decode de la URL
  de Google News (firma+timestamp → RPC batchexecute; `curl_cffi`
  impersonate Chrome, `ucbcb=1` — requests plano se come el consent
  wall por IP) → cuerpo con `trafilatura` → re-extracción. Tope
  `news_max_body_fetches` por pasada
- [x] **Defensa en `_short_cause`** (`queries.py`): frases puras de
  mecanismo/respuesta no votan → la categoría "Acceso" desaparece
  (nunca fue una causa real); tests en `test_cause_rules.py`
- [x] **Fallback de modelo Gemini**: cuota free tier ~20 req/día **por
  modelo** — 429 PerDay → salto inmediato a `gemini-3.5-flash-lite`
  (cuota aparte, sin thinkingConfig) en ingesta y re-extracción
- [x] **`scripts/reextract_news.py`**: refresca extracciones guardadas
  (`--beach`, `--max`, `--all`); Benijo re-extraído en prod →
  `/alerts` muestra **Desprendimientos** (`7dfb681`, `febdb01`,
  `00c8696`)

## Hito 8.10 — Filtros de capa y caducidad por causa ✅

- [x] **Panel «Capas» con checkboxes** (`CoastMap.tsx`): botón flotante
  bajo la brújula abre un panel por sección (Emisarios/Playas) con un
  checkbox por estado + "Todos/Todas" — varios estados visibles a la
  vez. Sustituye a los switches ON/OFF de la leyenda, que quedaba
  ambigua (¿ON = todos los estados o los marcados?) (`d85c780`)
- [x] **Leyenda viva**: la leyenda fija explica los colores y atenúa
  los estados desmarcados en el panel — pasa de decoración a
  indicador de "qué estás viendo ahora"
- [x] **Matriz de caducidad de la prensa** (`queries.py`): un cierre
  por causa **estructural** (`_STRUCTURAL_CAUSES` = Desprendimientos,
  Obras) persiste sin límite hasta reapertura explícita — nadie repite
  la misma noticia cada mes mientras dura (Benijo ~2 años cerrada solo
  con prensa administrativa; Garachico: muro caído). El resto —
  Contaminación, Mar agitado, avisos sin cierre confirmado, sin causa —
  es **transitorio** y caduca a los 21 d sin seguimiento, sea o no
  monitorizada (Puertito: bacterias fecales de 2025 reaparecieron al
  quitar la ventana; la regla de causa lo corrige). Además un `open`
  oficial no contradice un cierre estructural (Gaviotas: Sanidad mide
  agua, no taludes) (`d349c85`)
- [x] **Prompt anti-negación** (`news_llm.py`): titulares que
  desmienten el suceso («descartan un vertido», caso Roque de las
  Bodegas) → `relevant=false`, no cuentan como aviso
- [x] **Ayuda sincronizada**: Guía › El mapa explica el panel Capas y
  el botón satélite (antes decía "interruptores" y confundía capas con
  satélite); IntroCard vuelve a 4 hints sin redundancia
- [x] **Fix leyenda Android**: Nunito a 12 px con `lineHeight` justo
  cortaba acentos/descendentes y la fila de Playas desbordaba la card;
  `lineHeight` 19 + spacing ajustado (`34c4dfd`). Ojo: `app-release.apk`
  se sobreescribe en cada build — verificar la fecha antes de instalar

## Hito 8.11 — Reaperturas verificadas en producción ✅

Detectado en vivo (25-sep): Socorro reabrió con push correcto pero
Médano no notificó, y su ficha anclaba el episodio a un cierre viejo
de julio. Cuatro arreglos:

- [x] **Push con reintento persistido**: `news_items.push_pending` /
  `pushed_at` (migración `d7e8f9a0b1c2`). La ingesta marca candidatos;
  `_send()` tolera red caída y respuestas no-JSON de Expo (devuelve 0
  sin propagar); el loop por playa va en try/except — un fallo no mata
  al resto. Al inicio de cada pasada, un sweep reintenta lo pendiente
  no enviado dentro de la ventana de dedup (7 d): un push ya no se
  pierde por un fallo transitorio
- [x] **`since` = último clúster de cierres** (`/beaches/{id}/news`):
  un hueco >`PRESS_CLUSTER_GAP` (45 d) separa episodios — el banner ya
  no ancla al titular más viejo de la lista (Médano decía 07/07 con
  el episodio real del 23/09)
- [x] **Ola de reaperturas cierra UN episodio** (`events.py` paso 5):
  antes cada titular de reapertura consumía un clúster abierto — las 8
  noticias del 25/09 "cerraron" también el episodio de julio (mostraba
  07/07→25/09). Ahora la ola resuelve el clúster cercano (≤GAP a su
  última mención) o el único abierto (Benijo plurianual); el resto de
  titulares corrobora sin cerrar. El episodio viejo queda con
  "fin aproximado (última mención)"
- [x] **Banner verde de reapertura** (`press.ts`/`BeachDetail.tsx`):
  `tone='reopened'` si la reapertura tiene ≤7 d — "Reabierta el 25/09
  · según prensa · estuvo cerrada desde el 23/09". Puente entre el
  push y el dato; luego degrada al modo pasado ámbar
- [x] **`GET /episodes`** — todos los episodios de la isla (oficiales
  + reconstruidos) agregados por playa base + municipio, con
  `selectinload` para no barrer 167 playas con N+1
- [x] **Banner de alertas ampliado** (`CoastMap.tsx`): cabecera
  "2026 · N cierres · M activos ahora", sección verde "Resueltas
  recientemente" (≤30 d, "reabierta el X · estuvo Y días") y enlace
  "Todos los episodios del verano ›" que abre Municipios en Temporada
- [x] **Vista Temporada** (`MunicipalityStats.tsx`): toggle
  "Por municipio | Temporada"; lista cronológica de episodios jun-sep
  de la temporada vigente (fuera de temporada muestra la última
  cerrada), badge verde "Resuelta"/rojo "Sigue cerrada", duración y
  etiqueta "según prensa" para episodios solo-prensa. Misma cabecera
  anual que el banner de alertas
- [x] Helper compartido `frontend/lib/episodes.ts`: `seasonYear`,
  `seasonEpisodes`, `closuresThisYear`, `activeEpisodes`,
  `recentlyResolved`, `episodeDays`

## Hito 8.12 — Fecha real del cierre + fuente Guía Islas Canarias ✅

Detectado por el usuario (26-sep): Benijo mostraba "cerrada desde
2026" (fecha del último titular) cuando el acceso lleva cerrado desde
**julio de 2024** por desprendimientos — la fecha real vive en el
cuerpo de las noticias, no en su fecha de publicación.

- [x] **`NewsItem.closed_since`** (migración `e9f0a1b2c3d4`,
  `String(10)`, ISO parcial `YYYY[-MM[-DD]]`): el LLM extrae el inicio
  real del cierre cuando el texto lo afirma y sigue vigente
  ("cerrada desde julio de 2024" → `"2024-07"`, `"cerrada en 2024"` →
  `"2024"`)
- [x] **Fuente Guía Islas Canarias** (`news_sources.py` +
  `_sync_guia`): sitio Astro sin RSS → sitemap-0.xml con `lastmod`;
  ~50 fichas evergreen de playas de Tenerife. Cada ficha se descarga
  entera (trafilatura + curl_cffi) y se extrae con cuerpo; solo se
  re-procesa cuando cambia `lastmod`; tope `news_max_guia_fetches`
  (10/pasada) por la cuota del free tier; las fichas NUNCA despiertan
  push (una guía actualizada no es breaking news)
- [x] **Episodio estructural no caduca por silencio** (`events.py`
  paso 6): mismo criterio que `/alerts` — un `closure` de causa
  estructural sigue `closed_at=None` hasta reapertura explícita; el
  historial y el mapa ya no discrepan (Benijo: episodio abierto
  2024-07→hoy). `opened_at` deriva del `closed_since` ganador (año más
  antiguo, a igual año el más preciso)
- [x] **`summary.closed_since` en `/beaches/{id}/news`**: `since` sigue
  anclado al último clúster de cobertura; `closed_since` es el inicio
  real afirmado por el texto (episodio abierto → mira toda la cadena;
  resuelto → solo el último clúster). La `cause` del resumen vota por
  categoría real (`_press_cause`) — "acceso prohibido"/"obras de
  emergencia" ya no ganan por mayoría
- [x] **Frontend**: `fmtPartialDate` ("jul-2024", "2024",
  "15/07/2024"), banner usa `closed_since` con su precisión ("desde
  jul-2024", sin "el"); el banner verde de reapertura puede decir
  "estuvo cerrada desde jul-2024"
- [x] **`reextract_news` no toca filas de la Guía**: la extracción
  solo-titular las degradaba a `relevant=false` (el título de ficha
  parece SEO); las re-extrae `_sync_guia` con cuerpo

## Hito 9 — Portfolio ⬜

| # | Tarea | Estado | Esfuerzo |
|---|-------|--------|----------|
| 9.1 | README completo: qué es, features, stack, fuentes de datos, cómo ejecutar | ✅ Hecho (`02fe195`) | 🟡 Medio |
| 9.2 | Screenshots/GIF de la app — plan acordado (2026-09-29): README 5 capturas: ① mapa + banner plegado (solo capa playas, sin emisarios) ② ficha Benijo "Desprendimientos · desde jul-2024" (el diferenciador según-prensa) ③ historial + gráfica calidad ④ banner alertas desplegado con "Reabiertas recientemente" ⑤ capa emisarios zoom isla (todos los estados o solo ilegales — probar ambos toggle en Capas). Solo para vídeo: vista Temporada, push (ficticia con seed_fake_news), lista "Agua siempre apta" (prescindible) | Pendiente — capturas del APK nuevo | 🟢 Trivial |
| 9.3 | Diagrama de arquitectura (Mermaid en README) | ✅ Hecho (`02fe195`) | 🟢 Trivial |
| 9.4 | Documentar decisiones técnicas | ✅ Hecho — `DECISIONS.md` (`02fe195`) | 🟢 Trivial |
| 9.5 | Subir repo a GitHub (sin remote aún — activa CI + da URL pública) | ✅ Hecho (2026-09-27) — `github.com/ayozegr05/checkcoast-tenerife`, historial reescrito a noreply (mailmap), LICENSE MIT, CI arrancó solo | 🟢 Trivial |
| 9.6 | Vídeo demo breve (~45 s): grabación de pantalla + texto superpuesto, sin voz — hook "Náyade dice QUÉ, esto dice POR QUÉ". Guion acordado (2026-09-29): 0-5s mapa+banner "¿Puedo bañarme hoy?" · 5-15s tap playa cerrada → ficha causa según prensa · 15-22s texto hook + scroll historial · 22-30s capa emisarios · 30-38s lista "Agua siempre apta" o vista Temporada · 38-45s push ficticia de cierre → logo+tagline. Método: clips cortos separados por beat (no una toma larga), montaje Clipchamp/CapCut con texto overlay, sin voz, música ambiente sutil. La push final requiere inyectar `seed_fake_news` (La Viuda) desde la VM y limpiar después | Pendiente | 🟡 Medio |
| 9.7 | Post LinkedIn: problema en 1 frase + vídeo/GIF + 3 bullets técnicos + link repo (requiere 9.5) | Pendiente | 🟢 Trivial |
| 9.8 | **Homepage de producto** en `checkcoast.duckdns.org/`: hero + mapa vivo de la isla (puntos por estado) + stats + alertas enlazables + grid de playas ejemplo + cómo funciona | ✅ Hecho (`a5fd60c`) | 🟡 Medio |
| 9.9 | Ficha Google Play ($25 una vez, internal testing primero) — instalable real > APK suelto | Opcional | 🟡 Medio |

## Hito 10 — Ops y datos (pendientes menores)

| # | Tarea | Estado | Esfuerzo |
|---|-------|--------|----------|
| 10.1 | Borrar noticia fake La Viuda (`news_items.id=347` + `beach_statuses.id=250`) + script `seed_fake_news` para re-inyectarla al grabar el vídeo | ✅ Hecho — SSH `ubuntu@vm` con `ssh-key-2026-09-20.key`; script en la VM y dentro del contenedor | 🟢 Trivial |
| 10.2 | App Links con APK local: añadir fingerprint debug a `assetlinks.json` | ❌ Descartado — solo servía para la APK local; la firma de producción la pondrá EAS/Play Store | 🟢 Trivial |
| 10.3 | Verificar en dispositivo la APK local: banner prensa arriba en cerradas, nombre emisario seleccionado, zoom 15, 3 niveles satélite, push oficial + "según prensa" | ✅ Hecho (2026-09-23) — push E2E verificado | 🟢 Trivial |
| 10.4 | Build local Windows documentado: `expo prebuild` + `gradlew assembleRelease` (firma debug → desinstalar app EAS antes de instalar) | ✅ Hecho (2026-09-23) | 🟡 Medio |
| 10.5 | **Alertas con causa**: `effective_states` devuelve `cause` (categoría corta: Contaminación / Desprendimientos / Obras / Acceso / Mar agitado, normalizada de texto libre LLM/observaciones) + `cause_via`; `/beaches` expone `alert_cause`/`cause_via`; la fila del desplegable muestra la causa bajo "Cerrada" | ✅ Hecho (`c8ef3a4`, `f9e7bff`) | 🟡 Medio |
| 10.6 | **google-services.json commiteado**: API key Firebase visible en repo | ✅ Decidido — se queda (config pública por diseño, va en cada APK; mantiene clone→build). Restricción de aplicación de la key en GCP = "Ninguna" (la de app + SHA-1 es falsificable y rompía las builds al cambiar de keystore local/EAS: `FIS_AUTH_ERROR`); Key restringida por API en GCP (2026-10-06): solo Firebase Installations, FCM y FCM Registration — el uso detectado en Maps/Gemini era abuso de terceros sobre la key pública del repo; push token E2E verificado tras el cambio | 🟢 Trivial |
| 10.7 | **Revisión pre-publicación del repo** (antes de 9.5) | ✅ Hecho — spikes nunca commiteados (.pyc limpiados), `deploy/` solo tenía `__pycache__`, `.gitignore` cubre .env/keystores/credentials/android/, Caddyfile+compose sin secretos, `frontend/.claude/` fuera del tracking. Verificado: puerto 5433 de la VM cerrado desde internet | 🟢 Trivial |
| 10.8 | **Endpoint `/health` + monitor de uptime**: la API reporta estado interno (DB, última sync Náyade, última sync de prensa, errores LLM 24h) y un monitor externo (UptimeRobot free) pingea y alerta por email si cae o la última sync está rancia — observabilidad real de prod, no solo "está vivo". Incluye detectar fallos de registro push: la app reporta el error al backend y Ayuda muestra «Avisos push: no se pudieron activar · Reintentar» | ✅ Hecho (API, `da82df7`) — `/health` con `db`, `jobs.*.last_ok_at/stale/last_error` (stale = >2× intervalo sin éxito) y `errors_24h{llm,job_runs,client}`; `job_runs` registra cada pasada del scheduler; `POST /client-events` recibe telemetría de la app (push fallido → fila «Avisos push · Reintentar» en Ayuda). Monitor externo creado en UptimeRobot apuntando a `/health` (2026-10-07) | 🟡 Medio |
| 10.9 | **Tests de componente** (React Native Testing Library): 2-3 tests sobre `BeachList` — chips renderizan, filtro activo muestra conteo, sort por estado ordena. Cierran el hueco "frontend solo testea lógica pura" | ✅ Hecho — RNTL 14; una suite por componente en `__tests__/components/` (todos salvo `CoastMap`, que depende del mapa nativo MapLibre, y `Skeleton`, decorativo). Fixtures compartidas en `test/fixtures.ts`; red, `Linking`, `Share`, `BackHandler` e `Image.prefetch` simulados con `jest.spyOn`/`jest.mock` | 🟡 Medio |
| 10.10 | **CD — deploy automático**: job en `.github/workflows/` sobre `main` que despliega por SSH a la VM (clave en GitHub Secrets, rsync + restart del contenedor). Elimina el deploy manual por scp+docker cp — evita olvidos tipo `events.py` | Pendiente | 🟡 Medio |
| 10.11 | **Landing más viva de lo que parece**: ya sirve datos en tiempo real (192 dots + alertas vivas por petición), pero los cierres estructurales largos leen como dato rancio ("hace 212 días" en "Alertas activas") y los 3 dots de alerta se pierden entre 192. Mejoras: dots de alerta destacados/pulsantes, "cerrada desde sep-2025" para cierres largos, y opcional mapa interactivo MapLibre | Pendiente | 🟢 Trivial / 🟡 Medio |
| 10.12 | **Firebase App Check**: atestación de que las llamadas a Firebase vienen de la app real (Play Integrity en Android) — la API key es pública por diseño y la restricción por API (10.6) solo acota qué servicios puede tocar; sin App Check cualquiera con la key puede registrar tokens o gastar cuota FCM. Probar primero en modo *monitor* antes de *enforce* | Pendiente | 🟡 Medio |

## Hito 11 — Ficha de emisario enriquecida ⬜ *(propuesta 2026-09-30, aplazada: primero arreglar episodios de playas)*

La ficha de emisario hoy solo muestra tipo + municipio + playas cercanas.
El shapefile del Censo de Vertidos Tierra-Mar 2025 trae ~25 campos que
`ingest_outfalls.py` descarta. Tres niveles, en orden de coste/impacto:

| # | Tarea | Detalle | Esfuerzo |
|---|-------|---------|----------|
| 11.1 | **Ficha técnica del censo** (gratis, oficial) | Migración + ingesta de campos ya existentes: `NatVert` (agua residual urbana / salmuera…), `ContinVert` (Habitual vs excedencia-emergencia — un aliviadero solo vierte en episodios), `EstadoGral`/`EstadoFunc`, `TratPrev`/`TipoTrat`/`Desinfec`, `LongDifus`/`CotaVert`/`DiamFinal`, `ActivAfect` ("Zona de baño"), `EspProtDet` (ZEC/LIC), `Entidad`/`GestSan`, `DescrZona`, `NumAutoriz`. Sección "Ficha técnica" en `FeatureSheet` | 🟡 Medio |
| 11.2 | **Noticias de vertidos cercanos** | Endpoint `/outfalls/{id}/news`: news_items de playas a <2 km cuyo título menciona emisario/vertido/aliviadero/depuradora/saneamiento. Reutiliza el pipeline de prensa. Etiqueta honesta en UI — sin afirmar que es *ese* emisario concreto | 🟡 Medio |
| 11.3 | **Estado de vertido en el tiempo** | Correlación episodios de cierre por contaminación fecal en playas próximas ↔ emisario de aguas residuales habitual → anotación "episodios de contaminación en playas próximas" SIN acusar causalidad. Opcional: re-ingesta anual del censo SITCAN (snapshot por años). Disclaimer fuerte obligatorio | 🔴 Alto |

---

## Hito 12 — Troceado del backend ⬜ *(propuesto 2026-10-07, tras cerrar el troceado frontend)*

Tras el repaso de portfolio quedó el backend con un único "componente
grande": `app/routers/beaches.py` (1.158 líneas). Mismo criterio que
frontend — mover código, no reescribirlo; suite existente como red de
seguridad (test_api.py, test_share.py) + tests de caracterización
nuevos donde falte cobertura. En producción — cada paso verde en CI
antes de subir a la VM.

| # | Tarea | Detalle | Esfuerzo |
|---|-------|---------|----------|
| 12.1 | **`routers/beaches.py`** (1.158) | Separar endpoints de listado/stats de los de detalle (`/beaches/{id}/status`, `/news`, `/episodes`) o extraer serialización/parseo a helpers; el módulo queda como enrutador fino | 🟡 Medio |
| 12.2 | **`routers/share.py`** (970) | Ya templated (Jinja2). Lo que queda es Python montando dicts de contexto → extraer a `share_context.py`/`services/` y dejar el router como orquestador | 🟡 Medio |
| 12.3 | **`events.py`** (648) | Separar el clustering puro (reglas de episodio: gap, frontera por reapertura, corroboración) de la parte con DB. El más delicado: tests de caracterización primero | 🟡 Medio |
| 12.4 | `queries.py` (581) y `news_sources.py` (489) | Cohesivos hoy — solo si crecen: `news/` como paquete por fuente (Google/municipal/media/guía) | 🟢 Trivial |



### Estado actual
**Hito activo:** 9 — Portfolio (quedan capturas/vídeo del APK, repo
público en GitHub y post LinkedIn; 8.8 queda verificación end-to-end
de App Links con build firmada por EAS)
**Última actualización:** 2026-09-27 — UX de la lista de playas:
3 filas de chips (municipios / estados / orden), "Agua siempre apta"
como modo radio, "Sin datos" siempre último, "Peor calidad" con
evidencia en fila y ordenada por historial de muestras, vigiladas
siempre antes que no monitorizadas en empates. Repo preparado para
publicación: barrido de secretos del historial (limpio salvo
`google-services.json`, público por diseño), LICENSE MIT, README al
día + vars de entorno documentadas, historial reescrito a identidad
noreply de GitHub vía mailmap. Nuevos pendientes: 10.8 `/health` +
uptime monitor, 10.9 tests de componente, 10.10 CD por SSH.
Antes, 2026-09-26 — Hito 8.12 implementado:
`news_items.closed_since` (inicio real del cierre según el texto),
fuente Guía Islas Canarias vía sitemap (~50 fichas, `lastmod`, sin
push), episodios estructurales sin caducidad por silencio en el
historial. Benijo verificado en local: "riesgo de desprendimientos ·
desde jul-2024". Antes, Hito 8.11 desplegado: push con reintento
persistido, banner verde de reapertura (≤7 d), `since` al último
clúster, ola de reaperturas cierra un solo episodio, endpoint
`/episodes`, "Reabiertas recientemente" en el banner de alertas y
vista Temporada en el ranking municipal. Alertas resueltas 25-sep:
Médano PM3 y Socorro PM1 (2 días cerradas, según prensa); siguen
cerradas Gaviotas/Benijo/Garachico (desprendimientos, estructural).
APK release local regenerada con toda la UI final (leyenda corregida).
Pendiente: 9.2 capturas del APK → 9.5 GitHub → 9.6 vídeo → 9.7 LinkedIn;
8.8 verificación App Links E2E (requiere build firmada por EAS)
**2026-09-30:** documentado Hito 11 (ficha de emisario: censo completo →
noticias cercanas → correlación vertido↔cierre). Antes: arreglar
episodios de prensa en playas (Puertito: faltan reaperturas 9-may y
6-jun; ficha unmonitored no pide /incidents; item 485 mal casado)

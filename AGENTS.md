# CheckCoast Tenerife — Contexto del proyecto

App cívica para avisar al bañista del estado de las playas de Tenerife
(cierres, avisos, calidad del agua) y mapear los puntos de vertido
(emisarios submarinos) de la isla. Proyecto portfolio.

## Estructura

- `backend/` — FastAPI + SQLAlchemy 2 + GeoAlchemy2 + Alembic, Python 3.12
  - `app/models.py` — `Outfall`, `Beach` (+`monitored`), `BeachStatus`,
    `BeachIncident`, `BeachMeasurement`, `DeviceToken`, `NewsItem`
  - `app/routers/` — `outfalls.py`, `beaches.py`, `alerts.py`,
    `devices.py` (`POST /devices` registra Expo push tokens);
    `GET /episodes` = episodios insulares agregados (oficiales +
    reconstruidos, agrupados por playa base + municipio)
  - `app/notify.py` — push vía Expo Push Service al cambiar estado de
    playa (scraper + POST manual) y al entrar una alerta de prensa
    (`notify_press_event`, etiqueta "· según prensa"; cubre closure,
    warning y reopening — la reapertura solo notifica si había algo
    que reabrir: alerta de prensa ≤21 d o estado oficial no-open);
    `notify_beach_states` agrega una pasada del scraper: ≥4 cambios
    del mismo tipo → un único push resumen ("5 cierres de baño ·
    Playa X, Playa Y…"), ≤3 → individuales; purga tokens
    DeviceNotRegistered; `_send` nunca propaga errores
    (red o respuesta no-JSON de Expo → devuelve 0 y se loguea)
  - `news_items.push_pending`/`pushed_at`: la ingesta marca los
    candidatos a push y un sweep al inicio de cada pasada reintenta lo
    pendiente no enviado dentro de la ventana de dedup (7 d) — un push
    ya no se pierde por un fallo transitorio o un restart del contenedor
  - `app/queries.py` — `beaches_with_latest_status` (join último
    estado crudo) + `effective_states()` (matriz de estado efectivo
    oficial+prensa con precedencia por fecha de evento: alimenta
    `/alerts`, `/beaches` y `/beaches/{id}/status`; `status_via` =
    official|press) + `stale_official_ids()` (oficial rezagado del
    mismo episodio: reapertura de prensa posterior a TODA la
    evidencia — `sampled_at`/`opened_at` — → efectivo `open`; una
    incidencia ABIERTA exige reapertura corroborada por ≥2 medios) +
    matriz de caducidad de prensa por causa (ver reglas de negocio)
  - `app/main.py` — lifespan con APScheduler (`_sync_beach_statuses` cada
    `NAYADE_SYNC_SECONDS`, 1 h; `_sync_news` cada `NEWS_SYNC_SECONDS`,
    6 h; ambos envueltos en try/except)
  - `app/news_sources.py` — fetchers de prensa → `RawArticle` (Google
    News RSS como fuente; feeds por cabecera como respaldo) +
    `fetch_guia_sitemap`/`fetch_guia_page`: fichas evergreen de Guía
    Islas Canarias (sitio Astro, sin RSS → sitemap-0.xml con
    `lastmod`; ~50 fichas de playa de Tenerife) +
    `fetch_municipal_feeds`: RSS de webs de ayuntamientos (Tacoronte,
    Candelaria, La Laguna Ahora — Pto. de la Cruz tiene feeds
    desactivados, Adeje anuncia solo en redes) con prefiltro léxico de
    titular (playa/baño/vertido/costero…) para no gastar Gemini en
    fiestas y deportes; fuente primaria hacia adelante — el feed solo
    trae los últimos ~10-20 posts
  - `app/news_llm.py` — `extract_event(article)` detrás de interfaz
    `NewsExtractor`; `GeminiExtractor` (REST, JSON por esquema,
    thinking off, retries); `cause` = razón de fondo, nunca mecanismo
    ("acceso prohibido") ni respuesta ("obras de emergencia");
    `closed_since` = inicio real afirmado por el texto ("cerrada desde
    julio de 2024" → "2024-07", ISO parcial YYYY[-MM[-DD]], solo si el
    cierre sigue vigente); 429 PerDay → salta a
    `gemini_fallback_model` (cuota aparte por modelo; los -lite no
    aceptan thinkingConfig); acepta `article.body`; titulares que
    niegan el suceso ("descartan un vertido") → `relevant=false`
  - `app/news_resolve.py` — decode de URLs Google News → URL editorial
    (página /rss/articles con `ucbcb=1` + firma/timestamp → RPC
    batchexecute; `curl_cffi` impersonate Chrome — requests plano se
    come el consent wall según IP) + cuerpo vía `trafilatura`
    (fallback meta/og:description). RPC no documentado: si Google lo
    rompe, devuelve None y la ingesta sigue solo con titulares
  - `app/news_matching.py` — `match_beaches()` conservador + clave
    `_press_key` (inversión MITECO "(El)", sin "PLAYA DE…"); match
    exacto gana a contenciones del mismo municipio ("El Médano"→PM3,
    no a Chica/Leocadio); titulares multi-playa casan cada nombre
    literal; ambiguo entre municipios → no se muestra
  - `scripts/` — `ingest_outfalls.py`, `ingest_beaches.py` (censo MITECO
    + solver ALTCHA), `ingest_beach_status.py` (scraper Náyade),
    `ingest_osm_beaches.py` (Overpass), `ingest_news.py` (prensa → LLM
    → `news_items`, con segunda pasada cuerpo si el titular no aclara;
    `_sync_guia` re-extrae fichas de la Guía solo cuando cambia su
    `lastmod`, tope `news_max_guia_fetches`=10/pasada, nunca push),
    `reextract_news.py` (refresca extracciones guardadas: `--beach`,
    `--max`, `--all`; NO toca filas de la Guía — solo-titular las
    degradaría)
  - `alembic/` — migraciones (`alembic upgrade head`)
  - `tests/` — pytest: `test_api.py`, `test_nayade_parser.py`,
    `test_osm_ingest.py`, `test_news_matching.py`, `test_news_llm.py`.
    `conftest.py` siembra el fixture sintético `seed_data` (2 playas +
    1 emisario, borrado al terminar) — los tests no usan ids/datos
    reales; CI levanta PostGIS propio + `alembic upgrade head`
- `frontend/` — Expo SDK 57 + React Native + TypeScript + MapLibre
  - `App.tsx` — fetch inicial (outfalls/beaches/alerts), polling
    `/alerts` cada 5 min, tarjeta de bienvenida, BeachList modal
  - `components/CoastMap.tsx` — mapa OSM/satélite (Esri híbrido),
    capas GeoJSON, leyenda fija informativa (atenua los estados
    ocultos), botón «Capas» con panel de checkboxes por estado,
    controles arriba-derecha
  - `components/BeachList.tsx` — buscador, chips municipio, sort
    estado/cierres/calidad; agrupa PMs por nombre base+municipio (filas
    expandibles con datos inline por PM); modal con `visible` (estado
    persistido); vista detalle interna con foto satélite Esri
    (`export?bbox=`) + atrás + «Ver en mapa» (fly-to); `initialMunicipality`
    permite abrirla pre-filtrada
  - `components/BeachDetail.tsx` — contenido de ficha de playa compartido
    (FeatureSheet sobre mapa + detalle dentro de BeachList); caja
    "En la prensa" (`/beaches/{id}/news`, etiqueta "según prensa");
    banner verde `tone='reopened'` si la reapertura tiene ≤7 d
    ("Reabierta el X · estuvo cerrada desde el Y")
  - `components/MunicipalityStats.tsx` — ranking municipal + vista
    Temporada (episodios jun-sep cronológicos) via `/episodes`
  - `lib/episodes.ts` — agregados puros sobre `/episodes` (temporada,
    resueltas ≤30 d, cierres del año)
  - `components/MunicipalityStats.tsx` — ranking por municipio (cerradas/
    avisos activos, incidentes, muestras no aptas) con barra de severidad;
    agrega `/beaches/stats` en cliente; al tocar un municipio abre
    `BeachList` filtrada
  - `components/FeatureSheet.tsx` — hoja overlay sobre el mapa: emisarios
    inline; playas delega en `BeachDetail`
  - `lib/api.ts` — tipos + fetchers (+`registerDevice`)
  - `lib/notifications.ts` — `setupPushNotifications`: canal `alerts`,
    permiso, Expo push token → `POST /devices`; handler foreground
  - `frontend/AGENTS.md` exige leer docs de Expo v57 antes de escribir código
- `ROADMAP.md` — hitos 0-5b completados; pendientes: notificaciones push
  (punto 4, requiere rebuild EAS), Hito 6 (calidad/deploy), Hito 7 (portfolio)

## Comandos (desde raíz del repo)

```powershell
docker compose up -d                                    # PostGIS + API dockerizada (8001)
docker compose up -d db                                 # solo PostGIS (desarrollo con venv)
docker compose build api && docker compose up -d api    # rebuild tras cambios de código
cd backend
.venv\Scripts\uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
.venv\Scripts\alembic upgrade head                      # migraciones
.venv\Scripts\python -m pytest tests/ -q                # tests backend
.venv\Scripts\python -m scripts.ingest_beach_status     # scraper Náyade manual
.venv\Scripts\python -m scripts.ingest_osm_beaches      # playas OSM manual
.venv\Scripts\python -m scripts.ingest_news             # prensa → LLM manual
cd ../frontend
npx expo start --dev-client --port 8082                 # OBLIGATORIO --port 8082
npx tsc --noEmit                                        # typecheck
```

## Puertos / URLs

- Postgres+PostGIS: host **5433** (`checkcoast-db`)
- API: **8001** (el 8000 lo usa otro proyecto del usuario); el contenedor
  `checkcoast-api` corre `alembic upgrade head` al arrancar y usa
  `DATABASE_URL` interno `db:5432`. `GEMINI_API_KEY` se pasa al compose
  vía `.env` en la raíz del repo (gitignored)
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
  (evaluación "prohibido") de `/beaches/stats`. Causa prensa de Benijo
  corregida (25-sep): "acceso"/"obras" eran mecanismo y respuesta — la
  razón de fondo es `Desprendimientos`
- **Playas OSM**: `natural=beach` con nombre, `monitored=False`,
  dedup vs censo por nombre normalizado o <400 m. Si una OSM casa con un
  PM de Náyade se promueve a `monitored=True`. Una playa solo casa con
  un PM por pasada (Náyade repite nombres entre zonas: "Caleta de Negros")
- **Matching PM↔playa**: por nombre normalizado (sin acentos, mayúsculas);
  `?` en nombres MITECO (mojibake) actúa como comodín de 1 carácter
- **Contexto de prensa** (Hito 8.5): Google News RSS → `extract_event`
  (Gemini Flash, `GEMINI_API_KEY`/`GEMINI_MODEL` en env) →
  `match_beaches` conservador → `news_items`. Se guardan también los no
  relevantes/no casados (dedup + re-match en cada pasada). La API solo
  sirve los casados; la UI los etiqueta "según prensa" — NUNCA alimentan
  el estado oficial. Extracción en dos pasadas (Hito 8.9): si el
  titular no casa playa o no dice el porqué, `news_resolve` decodifica
  la URL de Google News y se re-extrae con el cuerpo; `cause` = razón
  de fondo, las causas-mecanismo ("acceso", "obras") no votan
- **Nombres MITECO invertidos**: el censo usa "PLAYA CABEZO (EL)" por
  "El Cabezo" — el matching de prensa lo resuelve con `_press_key`
  (artículo `(El|La|Los|Las)` delante, sin prefijo "PLAYA DE…").
  Ojo: hay playas homónimas entre municipios (dos "El Cabezo", dos
  "La Arena") y multi-PM por playa → la noticia se replica por PM
- **Matching prensa**: municipio extraído exige coincidencia con alias
  ("La Laguna"→"San Cristóbal de La Laguna", "Granadilla"→"Granadilla
  de Abona"); sin municipio solo casa clave exacta y única en toda la
  isla
- **Episodios de prensa** (`events.py`): clústeres de cierres separados
  por >45 d (`PRESS_CLUSTER_GAP`) son episodios distintos — la
  pertenencia se mide por cobertura (`last_closure`), porque
  `closed_since` puede retroceder el inicio años atrás (Benijo: la
  guía afirma "cerrada desde julio de 2024" → el episodio abre en
  jul-2024 aunque la noticia sea de 2026); el `closed_since` ganador
  es el del año más antiguo y, a igual año, el más preciso ("2024-07"
  > "2024"). Una "ola" de reaperturas cierra UN solo clúster — el más
  reciente a ≤GAP de la reapertura, o el único abierto (un cierre
  estructural puede durar años). Con varios abiertos, la reapertura
  lejana no resucita episodios caducados (Médano: la reapertura del
  25/09 resuelve el cierre del 23/09, no el de julio). Misma regla de
  causa que /alerts: un episodio estructural abierto NUNCA caduca por
  silencio (sin `end_estimated` — sigue `closed_at=None` hasta
  reapertura); los transitorios sí (`fin aprox = última mención`).
  `/beaches/{id}/news` ancla `summary.since` al inicio del último
  clúster de cobertura, no al titular más viejo de la lista, y expone
  `summary.closed_since` (el frontend lo prefiere: "desde jul-2024")
- **Guía Islas Canarias** (`_sync_guia` en ingest): fichas evergreen por
  playa del sitemap (sin RSS); `lastmod` evita re-descargas de fichas
  sin cambios; cada ficha se descarga entera (trafilatura) y se extrae
  con cuerpo — la fecha real del cierre vive en el texto, no en el
  titular. Una ficha actualizada NO es breaking news → nunca push.
  `reextract_news` las ignora: sin cuerpo el LLM las marca "no
  relevante" y las clobbera
- **Estado efectivo vs oficial**: lo que ve el usuario (mapa, alertas,
  ficha) sale de `effective_states()` — combina oficial y prensa por
  fecha de evento real. El `BeachStatus`/`BeachMeasurement` crudo nunca
  se muta y sigue en el historial de la ficha. Regla de rezago:
  última medición con `sampled_at` anterior a una reapertura de prensa
  = mismo episodio publicado tarde → efectivo `open`; evidencia
  posterior = evento nuevo → `closed`+push. Una incidencia ABIERTA
  solo la suprime una reapertura corroborada por ≥2 medios distintos
  (caso Gaviotas: un titular "obras PARA reabrir" mal clasificado no
  puede abrir una prohibición vigente). **Caducidad de la prensa por
  naturaleza de la causa**: un `closure` por causa estructural
  (`_STRUCTURAL_CAUSES`: Desprendimientos, Obras) persiste sin límite
  hasta reapertura explícita — nadie repite la misma noticia cada mes
  mientras dura (Benijo ~2 años cerrada solo con prensa administrativa)
  — y un `open` oficial tampoco lo contradice (Sanidad solo mide agua,
  no taludes); el resto (Contaminación, Mar agitado, avisos sin cierre
  confirmado, sin causa) caduca a los 21 d sin seguimiento, sea o no
  monitorizada (Puertito: bacterias fecales de 2025 sin reapertura
  cubierta)
- **Umbrales calidad** (RD 1341/2007, costeras): E. coli ≤250/≤500/>500,
  enterococo ≤100/≤200/>200 → Excelente/Buena/Insuficiente
- **Manual**: `POST /beaches/{id}/status` {"status": open|closed|warning}
  como respaldo del scraper
- **Nunca presentar "open" como "segura"**: significa "sin incidencia
  oficial activa". Valleseco PM1 no existe en Náyade → `unknown`

## Datos actuales (sept 2026)

- 167 playas: 61 oficiales + 106 OSM (gris = sin monitorizar)
- ~3200 mediciones, 13 incidentes. Alertas vivas (24-sep): El Médano
  PM3, El Socorro PM1 y Benijo cerradas `via="press"`. Una muestra
  "prohibido" YA es la prohibición oficial aunque no haya fila en
  `beach_incidents` — la incidencia es trámite aparte (El Cabezo PM1
  tuvo incidente real 9→14 sep 2026 tras su enterococo 410)
- Frontend: iconos PNG Twemoji en `assets/icons/` (outfall_sil = SDF
  teñido legal/illegal/unknown; playas = círculo azul/naranja/gris +
  sombrilla)

## Gotchas conocidos

- **Náyade** se cae por horas: es normal, el scheduler lo tolera
- **Hot reload** con capas MapLibre da `[Error: 'id' cannot be changed]`
  → reiniciar con `npx expo start --dev-client -c`
- **Node 24.21.0 LTS** vía nvm-windows (`nvm use 24.21.0`); quedan
  versiones viejas instaladas (20.12.2, 18, 17, 16) por si hicieran
  falta
- **Emoji** en fuentes del sistema no renderiza en Android → usar PNGs
- Token de Expo expuesto en una sesión anterior → el usuario debe
  revocarlo en expo.dev (ya avisado)
- `nayade_muestreos.html` de debug: no commitear artefactos así
- **APK local**: `android/app/build/outputs/apk/release/app-release.apk`
  se sobreescribe en cada `gradlew assembleRelease` — si el móvil
  muestra una UI vieja tras instalar, lo primero es comprobar la fecha
  del archivo instalado, no el código. La leyenda usa Nunito con
  `lineHeight` holgado (19 a 12 px): Android corta acentos si es justo
- **eas-cli** no está instalado global: usar `npx eas-cli` (npx cachea)
  o el build local documentado (10.4)
- **GDELT** descartado como fuente de prensa: 429 persistente desde esta
  IP y su índice busca traducciones al inglés, no el texto español
- **Gemini**: `gemini-2.5-flash` está deprecado para usuarios nuevos;
  `gemini-3.6-flash` tiene cuota free tier casi nula → por defecto
  `gemini-3.5-flash` (verificado 2026-09). 503 intermitentes: reintentar.
  Free tier = ~20 req/día **por modelo** — 429 PerDay → fallback a
  `GEMINI_FALLBACK_MODEL` (`gemini-3.5-flash-lite`, cuota aparte)
- **Google News RSS**: los `<link>` son redirects de Google News (se
  abren bien; el medio va en `<source>`); la URL editorial se decodifica
  con `news_resolve` (ver Hito 8.9); `Teneriffa News` (SEO-farm diario)
  está en blocklist `EXCLUDED_SOURCES`

## Pendiente inmediato

- Hito 9 (portfolio): capturas/vídeo del APK, repo público en GitHub
  (activa CI), post LinkedIn; opcional ficha Google Play
- Verificación E2E de App Links con build firmada por EAS (8.8)
- Deploy a la VM: `ssh -i ~/Downloads/ssh-key-2026-09-20.key
  ubuntu@130.110.233.198` (no hay repo git en la VM: scp de archivos +
  `sudo docker cp` a `checkcoast-api:/app/app/...` + restart; la web
  vive en `checkcoast.duckdns.org` detrás de `checkcoast-caddy`)

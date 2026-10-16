# Known issues — CheckCoast Tenerife

Deuda técnica y bugs detectados en la auditoría de 2026-10-16.
Ordenados por prioridad. Cada entrada dice qué pasa, dónde y cómo
abordarlo. Ir tachando conforme se arreglen.

## Leyenda

- **[A]** alta — bug real que el usuario puede ver o que corrompe datos
- **[M]** media — inconsistencia que morderá al tocar esa zona
- **[B]** baja — basura/limpieza

## Hecho ✅ (16-oct)

- [x] La web `/b/{id}` y `/` contradecían a la app: `share.py` tenía una
      réplica a medias de `effective_states` (sin supresión de oficial
      rezagado ni persistencia estructural) y la portada pintaba el
      estado oficial crudo. → `share.py` ahora usa la matriz real;
      cierres estructurales en granate (#8c322a) en header, chip, pin,
      ola, banners y tarjetas de alerta. Deployed.
- [x] 8 titulares COVID-era (2021-22) de "alta ocupación / aforo /
      afluencia de vehículos" marcados `closure` → contaminaban
      episodios de Gaviotas y Las Teresitas. → `relevant=false` en
      prod + el extractor ahora los marca `relevant=false` (prompt
      ampliado en news_llm.py) + filtro léxico `_non_sanitary_access`
      en la ingesta por si el LLM los deja pasar. Deployed.
- [x] 6 filas fake en `beach_statuses` (ids 290-299, source_url NULL,
      alternancia open/closed de pruebas del 15-oct en Las Teresitas
      PM1 y Las Vistas PM3). → DELETE en prod.
- [x] Nombres `PM#` en push. → `_display_name` limpia el sufijo y
      añade zona. Deployed.
- [x] Corroboración "≥2 medios" acumulaba medios de reaperturas
      DISTINTAS: `sources` se llenaba con todas las reaperturas
      históricas → dos medios de años distintos abrían una incidencia
      vigente. → Ventana de 30 días en `stale_official_ids`
      (queries.py) y `_superseded_by_reopening` (ingest): solo cuentan
      medios de ESTA reapertura. Deployed.
- [x] Regla "oficial rezagado" divergente lectura vs ingesta: la
      matriz contaba la última medición como evidencia aunque saliera
      APTA; la ingesta solo si era adversa. → Unificado: solo evaluación
      adversa cuenta (helper `_adverse_evaluation`, vocabulario
      ampliado con "NO APTA" — lo que manda Náyade real).
- [x] Fetches sin cancelación en la ficha: al cambiar de PM en
      ZonePicker la respuesta tardía machacaba datos con los de otra
      playa. → Flag `cancelled` en BeachDetail y MunicipalityStats.
- [x] N+1: `effective_states` hacía 2 scalar() por playa 'open' con
      prensa → batch query de `closed_at`/`sampled_at` por playa.
      `/beaches/stats` lazy-cargaba ~600 relaciones → `selectinload`
      (3 queries). Deployed.
- [x] Tres resolutores de estado divergentes (statusOf, beachCategory,
      beachStatusKey con reglas distintas). → Resolutor único
      `beachStateKey` en `lib/structural.ts`; los tres delegan.
      Estructural ahora también sale en la lista con pastilla granate.
- [x] Homónimos entre municipios: `_normalize(name): b` colapsaba las
      dos "El Cabezo" en el dict → una jamás recibía estados. → Dict
      multi-valor + el municipio de la zona desambigua.
- [x] "Medusa" mapeaba a Contaminación y contaba en episodios de agua.
      → Causa propia "Medusas" (no infla el ranking de contaminación).
- [x] Duración de episodio: IncidentHistory no contaba el día inicial;
      episodeDays/durationDays sí. → Unificado a días naturales (+1).
- [x] `_STATE_EVENTS` en rezone_news omitía "pollution" → un pollution
      no resolvía cuerpo para acotar zona. → Añadido.
- [x] Feeds muertos invisibles: `except: continue` sin log. →
      `logger.warning` por feed fallido en fetch_municipal_feeds.
- [x] Taxonomía estructural duplicada (STRUCTURAL_CAUSES en mapData
      vs FAMILY_STRUCTURAL en episodes). → Única fuente en
      `lib/structural.ts`, mapData re-exporta.
- [x] Basura `frontend/scripts/out/` (15 archivos de iteraciones
      commiteados) → borrado + .gitignore.
- [x] Assets huérfanos (contam-pin-art, icon-help, icon-share,
      outfall.png, outfall_sil, gradient-btn, wave-twemoji) → borrados.
- [x] Código muerto: `fetchSampling`/`SamplingSummary`,
      `activeEpisodes`, `Keyboard` sin uso, `asyncpg` sin uso. → fuera.
- [x] `OutfallList` capName local sin conectores ("Emisario De La…")
      → ahora usa `capName` de format.ts.
- [x] `share.py` `_cap_name` con `.replace("","")` no-op → limpiado.
- [x] `_og_cache` sin cota → tope de 500 entradas.
- [x] `DeviceIn.token` sin max_length → `Field(max_length=255)`.
- [x] `fmtDate` duplicado en muniStats → re-exporta el de format.ts.
- [x] `closed_since` movido por un outlier de UN solo medio (Gaviotas:
      un titular de La Gaceta afirmaba 2024-06 mientras 6 medios decían
      2026-06-03). → `_corroborated_closed_since` en events.py: una
      fecha antigua solo gana si la respaldan ≥2 outlets distintos
      (canonizados por `outlet_key`); si ninguna está corroborada se
      conserva el mínimo afirmado (fallback, no empeora nada). Aplicado
      en la creación de episodio, merge de runs y el resumen de
      `routers/beaches.py`. Verificado en prod: Gaviotas → 2026-06-03,
      Benijo → 2024-07 (intacto). Deployed.

- [x] `/alerts` N+1 (db.get + 2 ST_X/Y por alerta) → una sola query
      con columnas ST_X/ST_Y. Deployed.
- [x] `/incidents` lazy-load por playa → `selectinload` (mismo patrón
      que `/episodes`). Deployed.
- [x] `app/` importaba de `scripts/` → invertido: `ingest_news.py` e
      `ingest_beach_status.py` movidos a `app/` (son jobs del
      scheduler, viven en el proceso API); `scripts/` conserva shims
      CLI (`python -m scripts.ingest_news` sigue funcionando) y
      `_normalize` compartido → `app/names.py::normalize_beach_name`.
      Deployed.
- [x] Etiquetas de estado divergentes → dos mapas canónicos en
      `lib/structural.ts`: `BEACH_STATE_LABEL` (compacto: lista,
      leyenda) y `BEACH_STATE_LABEL_LONG` (descriptivo: ficha).
      BeachList/BeachDetail/mapData/beachStatus delegan en ellos.
      'No monitorizada' → 'Sin monitorizar' unificado.
- [x] Feeds muertos invisibles → `news_sources.last_feed_failures`
      se persiste en `job_runs.detail.feeds_dead` por pasada de
      news-sync y `/health` lo expone en `jobs.news-sync.feeds_dead`.
      Deployed (verificado: `feeds_dead: []`).
- [x] `_normalize` homónimo con semánticas opuestas → resuelto con
      la mudanza a `app/names.py`: `normalize_text` (conserva PM)
      vs `normalize_beach_name` (quita PM, delega en la anterior).
      El scraper usa `normalize_text`; prensa/OSM usan
      `normalize_beach_name`. Ya no son homónimos.
- [x] Barrido [B] (17-oct):
      - `_JOBS` muerto eliminado de `main.py`; errores de job ahora
        hacen `traceback.print_exc()` (antes solo `str(e)[:500]`)
      - `pytest` fuera de requirements de prod →
        `requirements-dev.txt` (CI lo instala aparte)
      - one-shots ejecutados borrados: `fix_puertito.py`,
        `probe_2025.py`, `seed_fake_news.py` (su clean() borraba de
        más). Recuperables desde git.
      - `durationDays`/`episodeDays` unificados (delega en
        `episodeDays`, fuente canónica en `lib/episodes.ts`)
      - `QualityChart` ya no reimplementa umbrales: `valueColor()`
        compartido en `lib/quality.ts`
      - regex PM ×7 → `lib/pm.ts` (`PM_SUFFIX`, `pmTagOf`) y backend
        → `app/names.py` (`PM_SUFFIX`, `pm_label`)
      - ~90 literales de color → tokens en `lib/theme.ts`
        (`onColor`, `shadow`, `tintPress`, `tintReopen`,
        `tintNotice`, `noticeBorder`, `cardBorder`, `link`, `risk.*`)
      - `/client-events` con rate-limit 20/min por IP en memoria
      - `causeBreakdown` (episodes.ts) sin callers → eliminado
      - claves `_ACCENTS` inalcanzables en share.py → eliminadas
      - eslint `set-state-in-effect` ×11 → patrón "ajustar durante
        render" (prev-state/signature comparison) en BeachDetail,
        BeachList, FeatureSheet, MunicipalityStats, SatelliteShot,
        AlertsBanner, OutfallSheet, MuniDetail; App.tsx separa el
        fetch de los resets (fetchAll/loadData) e introVisible usa
        init lazy `useState(() => !storage)`. Los efectos ahora solo
        hacen fetches/suscripciones
      - eslint warnings ×6 → imports reordenados (import/first),
        vars sin usar eliminadas (OUTFALL_COLORS, t, episodeDays,
        GeoFeature), exhaustive-deps reales en CoastMap, require
        condicional de storage.ts justificado con disable
      - `immutability` en CoastMap (closeOverlays usado antes de
        declararse) → declaración movida arriba del efecto

## Revisión senior — checklist de pulido (17-oct)

Autocrítica "como reclutador senior" sobre el repo. Ordenada por lo que
se nota primero al revisar. Ir tachando poco a poco.

### P0 — lo primero que encuentra un senior

- [x] **`expo lint` no corría en CI** → añadido a `ci.yml` (prettier +
      tsc + lint + jest). El badge 0/0 queda blindado
- [x] **Dockerfile corría como root** → `USER appuser` +
      `PYTHONDONTWRITEBYTECODE=1` (verificado: og:image se compone en
      memoria, nada escribe en /app)
- [ ] **`CoastMap.tsx` 1698 líneas / `App.tsx` 728** — god-components:
      mezclan cámara, capas, buscador, panel y banner. Fix real =
      extraer hooks (`useMapCamera`, `useMapLayers`), media jornada con
      riesgo de regresión visual. Decisión probable: documentar como
      tradeoff — la lógica ya está extraída a `lib/` (pura y testeada);
      el componente es mayormente declarativo (JSX de capas MapLibre)

### P1 — preguntas de entrevista (defender, no necesariamente arreglar)

- [ ] **APScheduler dentro del proceso API** — con 2 réplicas duplicaría
      scrapes y pushes. Tradeoff consciente: single-container hoy;
      moverlo a worker aparte es complejidad innecesaria
- [ ] **`alembic upgrade head` al arrancar** — dos réplicas
      concurrentes podrían pelear en migraciones. Mismo tradeoff
- [ ] **Sin E2E** — 395 tests unitarios/componente pero ningún smoke
      del flujo crítico (mapa → pin → ficha). Maestro es la opción
      barata para RN
- [ ] **Telemetría casera `/client-events`** vs Sentry — vendible como
      pragmatismo (cero deps externas, write-only, rate-limit) si se
      explica bien

### P2 — pulido fino

- [ ] Sin versioning de API (`/v1/`) — duele solo si la API crece
- [ ] Sin coverage report en CI (badge de %)
- [ ] i18n hardcoded en español — defendible para app cívica local;
      mencionar la decisión
- [ ] Export web (`dist/`) — publicarlo solo si está pulido; una web
      a medio hacer resta más que no tenerla
- [ ] OTA frontend (`eas update`) — aplazado
- [ ] Homónimas sin municipio — fallback `local[0]` no determinista
      (ninguna existe hoy)

## Pendientes

### Lint — resuelto por completo (0 errores, 0 warnings)
- **`react-hooks/refs` ×23** → mirrors de ref movidos a `useEffect`
  (escribir `.current` post-commit, no en render); `useRef(new X())`
  → `useState(() => new X())` (semántica idéntica — el ref creaba y
  descartaba el objeto en cada render); curry `handlePress(type)` →
  firma `(type, e)` con arrow inline en JSX. Único disable
  justificado: `PanResponder.create` — el sistema de gestos solo
  invoca sus callbacks fuera del render, el linter no puede
  probarlo
- **`preserve-manual-memoization` ×2** → `buildBeachGroups` deja de
  devolver `Map` mutable (ahora `Record`); el `useMemo` restante lleva
  disable justificado (el compilador no está activo — la memoización
  manual es la que optimiza hoy)

### Decisión: no arreglar (documentado)
- **[A3] `effective_states` de toda la isla para servir UNA playa**
  (`routers/beaches.py` `/beaches/{id}/status` y `share.py`): la
  matriz cuesta ~5 queries con datos agregados — el coste real es
  despreciable y partir el helper en dos versiones crearía otra
  divergencia lectura-vs-escritura como la que ya corregimos en
  share.py. Si alguien lo pregunta en entrevista: se mantiene por
  consistencia — una sola fuente de verdad del estado efectivo.

## Datos por revisar (no-bug, dudas de negocio)

- **Gaviotas "desde"** — RESUELTO (ver abajo + regla aplicada arriba):
  el cierre real es jun-2026; el `closed_since=2024-06` era una
  confusión del extractor (probablemente con Benijo jul-2024 o Los
  Patos jun-2024). La regla corroborada ya corrige la fecha visible.
  Verificado en prod (17-oct): la fila errónea ya no existe — no
  queda ningún `closed_since='2024-06'` en `news_items`.
- **Playas hermanas homónimas**: dos "El Cabezo", dos "La Arena" — el
  match ya es multi-valor con desambiguación por municipio; queda el
  caso de una playa sin municipio declarado (ninguna hoy, pero el
  fallback es `local[0]` y no es determinista por orden de dict).

---

## Gaviotas — investigación de la fecha real (16-oct)

**El titular "cerrada desde junio de 2024" es falso.** El cierre real
y continuo por desprendimientos empezó el **3 de junio de 2026** y
sigue vigente (oct-2026). El "2024" es probablemente confusión del
extractor con Benijo (cerrada por desprendimientos el 08/07/2024, mismo
municipio) o con Los Patos/El Bollullo (La Orotava, jun-2024).

Cronología verificada en prensa:
- **2021-2022** — cierres puntuales por "alta ocupación" (semáforos
  COVID, aforo del aparcamiento). NO sanitarios — ya marcados
  `relevant=false`.
- **03/05/2024 y jul-2024** — cierres de acceso a vehículos por
  aparcamiento completo (NO desprendimientos).
- **15/07/2025** — primer cierre por desprendimiento real en la
  carretera de acceso; escombros retirados ese día; cierre breve
  (10/08/2025 ya abierta, solo por aforo).
- **03/06/2026** — cierre preventivo por inestabilidad del talud junto
  a la TF-134, a la altura de Playa Chica; desalojo por Policía Local.
- **14-15/06/2026** — declaración de emergencia ("grave peligro");
  contrato de emergencia ~1,9 M€ con Tacande Geotécnica y Wara
  Ingeniería Ambiental; obras ~12 meses; cerrada todo el verano 2026.
- **14/09/2026** — Costas autoriza las obras (1,92 M€); objetivo
  municipal: reapertura verano 2027.
- **Oct-2026** — sigue cerrada; la web municipal la lista como
  "Acceso cerrado temporalmente".

Conclusión: el `closed_since=2024-06` de `news_items.id=293` es un
error de extracción. La playa cerró de verdad el 03/06/2026. La regla
aplicada (`_corroborated_closed_since`, events.py) impide que un
outlier de un solo medio mueva el "desde" de un episodio: una fecha
antigua solo prevalece si la respaldan ≥2 outlets canonizados; si no,
se usa el mínimo corroborado y, en último caso, el mínimo afirmado.
Verificado en prod (17-oct): Gaviotas muestra 2026-06-03 y Benijo
conserva 2024-07.

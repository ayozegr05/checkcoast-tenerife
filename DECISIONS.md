# Decisiones técnicas — CheckCoast Tenerife

Por qué el proyecto está hecho como está. Las decisiones no obvias, con
el razonamiento y las alternativas descartadas.

## Datos e ingesta

### PostGIS y no lat/lng plano

Las consultas del producto son espaciales: "emisarios cercanos a esta
playa", "deduplicar una playa OSM a <400 m de un punto oficial", encuadre
de bounds en el mapa. Con columnas `float` cada query reimplementaría
Haversine a mano; con PostGIS es `ST_DWithin`/`ST_Distance` nativo e
indexado. Coste: una imagen Docker más — beneficio: geometría real con
índices GiST.

### Scraping de Náyade en vez de API

No existe API pública del estado de baño: el portal es una app Struts
frágil que devuelve 500 intermitentes. Se optó por scraper HTML con
reintentos (4×, backoff exponencial) + scheduler horario tolerante a
caídas + `POST /beaches/{id}/status` manual como respaldo operativo.
Alternativa descartada: depender solo de prensa — sin base oficial no hay
producto.

### La evaluación de la última medición puede cerrar una playa

Náyade a veces marca una muestra "prohibido" sin abrir incidente formal
(caso real: El Cabezo PM1, enterococo 410). `_derive_state` trata esa
evaluación como cierre salvo que un incidente se cerrara después de la
medición — porque el bañista necesita saberlo aunque Sanidad no haya
tramitado el papel.

## Prensa con LLM

### LLM solo para prensa; reglas para lo oficial

El estado oficial se deriva con **lógica determinista** (incidentes,
evaluaciones, fechas) — auditable y sin coste. El LLM (Gemini) solo
procesa texto libre de noticias → extrae `playa + evento + causa`, donde
la variabilidad del lenguaje hace inviable el parsing por reglas.
División: lo que exige precisión → código; lo que exige comprensión → LLM.

### Prensa siempre separada del estado oficial

Decisión de integridad del producto: una noticia puede estar desactualizada
o ser errónea. Por eso cada alerta lleva `via: official|press`, la UI
etiqueta "según prensa" y la prensa **nunca** muta el estado oficial —
solo informa. Una playa OSM puede aparecer "cerrada según prensa"
(Benijo) sin que Náyade diga nada.

### Google News RSS y no GDELT

Spike inicial con GDELT: 429 persistentes. Google News RSS con
multi-query (por término de causa, no por playa) cubre mejor el objetivo:
responder "¿por qué está cerrada?".

## Frontend

### MapLibre y no Google Maps

Sin API key, sin vendor lock-in, estilos libres, y la app es OSS cívico —
depender de una key de Google con billing era un riesgo innecesario.
Coste aceptado: módulo nativo → dev build obligatoria (no Expo Go).

### Todas las capas visibles a cualquier zoom

Se probó zoom progresivo (ocultar playas OSM/emisarios hasta zoom ≥11):
visualmente limpio pero **confundía** — parecía que la app tenía menos
datos de los que tiene. Decisión final: las 167 playas + 180 emisarios
siempre visibles (el anillo de costa comunica cobertura); solo los
**nombres** de playa aparecen al acercar (≥14), donde la densidad es
baja. Regla: ocultar *chrome*, nunca *datos*.

### Lista como directorio canónico

El mapa es exploración; la respuesta rápida ("¿dónde me baño hoy?") vive
en el banner + lista completa con buscador y filtros. La ficha se abre
como overlay sin desmontar la lista — volver atrás conserva scroll y
estado expandido.

### "Abierta" nunca se presenta como "segura"

Rigor cívico: `open` = *sin incidencia oficial activa*, no una garantía.
Las playas OSM van en gris como "sin monitorizar", no como "abiertas".

## Infra y calidad

### Docker Compose con auto-migración

`docker compose up` levanta PostGIS + API; el contenedor de la API corre
`alembic upgrade head` al arrancar — clonar el repo y tener todo vivo sin
pasos manuales es el "demo en 5 minutos" que un portfolio necesita.

### Tests con fixtures sintéticos

Los tests iniciales dependían de la BD de desarrollo (IDs reales) — roto
en CI. Refactor a fixtures sintéticos: la suite es determinista y el CI
levanta un PostGIS vacío desde cero.

### Notificaciones push vía Expo Push Service

Los cambios de estado (scraper o manual) disparan push a los tokens
registrados; los tokens muertos (`DeviceNotRegistered`) se purgan.
Alternativa descartada: FCM directo — Expo ya abstrae credenciales y
entrega, y el proyecto ya vive en EAS.

### Deploy: Oracle Cloud Free Tier (VM) y no Render/Supabase/Railway

El backend se autoaloja en una VM **Ampere A1 ARM** de Oracle
(**1 OCPU** Neoverse-N1, **6 GB** RAM, 45 GB disco, Ubuntu 22.04 —
capa *Always Free* → $0 permanente; el tier permite hasta 4 OCPU/24 GB
pero con esta va sobrada: load ≈ 0.01) con el mismo
`docker-compose.yml` de desarrollo: BD + API juntas, siempre
despiertas, scheduler de Náyade corriendo 24/7.

Alternativas evaluadas y descartadas:

- **Railway**: la más cómoda (Docker + Postgres gestionado en un panel),
  pero no es gratis — ~$5/mes tras el crédito de prueba
- **Supabase (BD) + Render (API)**: $0 pero con trampas serias —
  el Postgres free de Render **caduca a las pocas semanas** (borrado,
  no pausa); el web service free de Render **duerme a los 15 min** sin
  tráfico (cold start ~30 s y, peor, el scheduler/APScheduler no corre
  dormido → alertas y push con lag); Supabase pausa la BD tras 7 días
  sin uso. Se podía mitigar con un ping externo tipo cron-job.org, pero
  es zona gris del free tier y frágil
- **Fly.io**: sin free tier real y más configuración manual que Oracle
  para el mismo resultado

Trade-off aceptado: ser nuestro propio sysadmin (unattended-upgrades,
restart policies, rotación de logs) a cambio de $0 real, siempre
despierto y sin hacks.

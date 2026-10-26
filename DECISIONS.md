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

### Precedencia por fecha de evento, no de publicación

Náyade publica con días de retraso: la muestra lleva `sampled_at`
(cuándo sacaron el agua) y la incidencia `opened_at`/`closed_at`, que
suelen ser anteriores a su publicación. Comparar timestamps de
ingesta producía falsas "nuevas clausuras" cuando una muestra rezagada
llegaba después de una reapertura de prensa.

Regla (`effective_states`/`stale_official_ids` en `queries.py`): toda
la evidencia oficial anterior a la reapertura de prensa (`sampled_at`
de la última medición, `opened_at` de incidencias abiertas) es el
**mismo episodio publicado tarde** → estado efectivo `open`, sin push.
La evidencia oficial **posterior** a la reapertura es un evento nuevo →
`closed` + push. Y al revés: incidencia cerrada o muestra tomada
después de un cierre de prensa prueba reapertura oficial y la alerta
cae sin que la prensa diga nada. No hay ventanas de días a adivinar:
la propia fecha del evento decide.

Guarda aprendida con un caso real (Gaviotas): una **incidencia
formalmente abierta solo la suprime una reapertura corroborada por
≥2 medios distintos**. La incidencia también nace de muestras
rezagadas (misma lógica de lag), pero es el acto oficial más fuerte —
y el LLM había clasificado "Costas autoriza obras PARA reabrir el
acceso" como reapertura, abriendo una playa con prohibición vigente.
Por eso el prompt además distingue "reabierta" (hecho) de "obras para
reabrir" (other).

### Una sola matriz de estado efectivo

Mapa, banner de alertas y ficha mostraban fuentes distintas (el pin
el `BeachStatus` crudo, las alertas la lógica mixta) → podía haber
"0 cerradas" en el banner con el pin rojo. `effective_states()` es la
única función que decide lo que ve el usuario en los tres sitios; el
dato oficial crudo sigue intacto en BD y en el historial de la ficha,
y `status_via` conserva la procedencia por si la UI quiere marcarla.

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

## Ficha de emisario

### Legalidad pinta el marco; el riesgo vive dentro de una celda

La fila de triaje (legalidad · funcionamiento · riesgo) tiñe borde y
fondo del color del **estado legal** — verde autorizado, ámbar en
trámite, rojo ilegal — aunque el riesgo pueda ser alto. Por qué:

- **Son fuentes distintas con distinta autoridad.** La legalidad es un
  dato del Censo de Vertidos Tierra-Mar 2025 (Gobierno de Canarias);
  el riesgo es un **índice propio** ponderado sobre datos del censo
  (`lib/outfallRisk.ts`). La jerarquía visual respeta la jerarquía de
  la evidencia: el dato verificado pinta el marco; la estimación vive
  dentro de una celda, con sus razones a la vista — distribuidas,
  no concentradas: cada ponderación la cuenta la sección que ya
  enseña ese dato (el tratamiento en "Qué se vierte", la orilla en
  los KPIs, la ZEC en su banner). La banda de razones bajo el triaje
  repetía la propia ficha y se eliminó; solo sobrevive como frase
  suelta el matiz operativo que no vive en ninguna otra parte.
- El choque de colores es informativo: "en trámite + riesgo alto" es
  literalmente *"la administración aún no ha decidido si este vertido
  potente es legal"* — la UI muestra las dos caras sin resolverlas.

**Matriz de ponderación del índice** (score → ≥5 alto, ≥3 medio, resto bajo):

| Factor | Peso | Condición |
|---|---|---|
| Sustancia | 2 / 1 / 0.5 | residual sin depurar o solo pretratada = 2 (la industria pura también); depurada = 1; salmuera/pluvial = 1; piscina/refrigeración = 0.5 |
| Régimen | 2 / 1 / 0.5 | diario (activo+habitual) = 2 si la sustancia importa, 0.5 si no; activo sin régimen = 1 |
| Sin autorización | 1 | `status=illegal` |
| Zona protegida | 1 | solo si sustancia ≥1 (el cloro o el calor no dañan una ZEC) |
| Vierte en la orilla | 1 | somero (profundidad <8 m o a ras) o <50 m de costa, solo si sustancia ≥1 — sin columna de agua que diluya |
| Estado físico | 1 / 0.5 | conducción "mala" / "precaria" |

Lo que **no** entra: la distancia a playas cercanas (la proximidad
geométrica se muestra como dato aparte — convertirla en puntuación
sería acusar sin evidencia sanitaria).

### "ILEGAL" + "Ahora no vierte" no es contradicción

Son dos preguntas distintas de la realidad: *¿tiene permiso?*
(histórico, del censo) vs *¿está vertiendo hoy?* (`is_active`, actual).
El sello rojo junto a "Ahora no vierte" (Las Galletas) puede leerse
como "cerrado por ilegal" — la línea de matiz operativo lo desactiva: *"No
opera ahora mismo, aunque está pensado para verter a diario."* La
tensión es fiel al dato, no un descuido.

### El censo numera descargas ("Palmetum-1"); el ordinal sobra en pantalla

`/outfalls` sirve el nombre sin el sufijo `-\d+` — no hay hermanos
"-2" en Tenerife que lo hagan informativo, y limpia título de ficha,
etiqueta del pin y buscador en un solo punto. La BD conserva el nombre
crudo del censo.

### Prensa: pilas de cobertura, medios distintos y el pie honesto

- **Las pilas son heurística de cobertura, no episodios oficiales:**
  agrupan por familia editorial + ventana temporal (≤30 días, cadena
  de fechas). Nunca se presentan como "episodios" — un mismo suceso
  real cubierto por varios medios con ángulos distintos es cobertura
  relacionada, no una deducción.
- **La métrica editorial es "M medios", no "N noticias":** la banda
  cuenta medios distintos porque la corroboración independiente es
  lo que da peso a la evidencia, no el volumen bruto (que arrastra
  réplicas del mismo artículo por cada PM de playa).
- **Una noticia sin playa solo entra en una pila si hay exactamente
  una candidata de su familia ya anclada por playa** — nunca se
  agrupan dos sin-playa entre sí (falsa agrupación).
- **El lead de una suelta es el hecho extraído (`fact` /
  `denunciaLead`), no el titular crudo:** el titular suele ser
  ruido sensacionalista; el hecho es lo editorialmente honesto. Las
  hijas de pila sí muestran titular (son el documento de archivo).
- **Mismo artículo = una pieza, aunque Google le dé dos URLs:** el
  endpoint deduplica por URL y, como segundo cerrojo, por (título
  normalizado, medio) — Google News envuelve el mismo artículo con
  distintas URL y fechas que bailan un día.
- **Disclaimer permanente "según prensa — la proximidad no implica
  causalidad":** la app jamás dice "este emisario cerró esta playa";
  muestra cobertura y distancia, no causalidad.
- **El riesgo se declara estimación:** `outfallRisk` es una fórmula
  determinista sobre el censo (índice de priorización, no veredicto
  sanitario) y el pie de la ficha lo dice: "El riesgo es una
  estimación a partir de los datos del censo" — la misma disciplina
  epistémica que el disclaimer de prensa.

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

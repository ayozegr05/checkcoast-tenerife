# Notas provisionales — revisión del sistema de episodios de prensa

Análisis posterior a los fixes de episodio completo, medios sobre titulares
mostrados, fechas casadas oficial↔prensa y filtro de "estado del mar".
Pendiente de decidir qué se corrige y en qué orden. **Nada de esto está
implementado todavía.**

---

## Hallazgos mayores

### 1. El "reabre por prensa" se salta el filtro del mar

Hay una regla (en `backend/app/queries.py`, función `stale_official_ids`)
que decide: *"Sanidad dice que la playa sigue cerrada, pero la prensa ya
publicó que reabrió → la mostramos como abierta"*. Sirve para cuando
Náyade tarda días en actualizar.

Para decidirlo consulta las noticias de reapertura **directamente en la
base de datos**, en una consulta propia donde el filtro de "estado del
mar" (oleaje, temporal…) **no se aplica**.

Consecuencia posible: una noticia tipo *"la playa reabre tras el
temporal"* podría mostrar como abierta una playa que Sanidad mantiene
oficialmente cerrada. Es un caso raro, pero es un agujero real del
filtro.

Arreglo: traer también la causa en esa consulta y pasarla por el mismo
filtro. Una línea de código, prácticamente.

### 2. La "fecha desde" (`since`) sigue usando la regla vieja del bocadillo

El backend calcula un dato llamado `since`: *"¿desde cuándo está la
prensa cubriendo este episodio?"* Para calcularlo recorre las fechas de
las noticias y corta cuando hay una reapertura en medio.

El problema: esa regla de corte es la **vieja**, la misma que fallaba
con el Médano (reaperturas a las 07:00 del 25/09 y dos noticias de
cierre a las 11:03 del mismo día → corta mal y devuelve since = 25/09,
cuando el episodio realmente arranca el 23/09).

Ya arreglamos ese mismo bocadillo para la **lista de titulares** (ahora
enseña los 24 correctos), pero `since` se quedó con la lógica antigua.

Hoy no se ve roto porque el texto de la ficha usa otra vía (la fecha más
antigua documentada), pero `since` alimenta otras dos cosas internas
(el punto 3 y la atribución de zona). Es un bug dormido: funcionará mal
el día que alguna playa dependa de él.

Arreglo: que `since` use la misma cadena de episodios que ya construimos
para los titulares.

### 3. La fecha "cerrada desde el X" de prensa puede perderse

Cuando la prensa afirma algo como *"cerrada desde el 23"*, no nos fiamos
de un solo medio: exigimos que **al menos 2 medios distintos** afirmen
una fecha parecida. Para eso juntamos en un saco todas las noticias de
cierre publicadas a partir de `since` y contamos cuántas afirman qué.

El problema: como `since` está mal (punto 2, dice 25/09 en vez de
23/09), el saco solo recoge noticias del 25 en adelante. En el Médano
eso son solo las 2 piezas de estenerife → 1 solo medio → no corrobora →
la afirmación "desde el 23" se descarta.

En el Médano no se nota porque gana la fecha oficial (21/09), que es
más antigua. Pero en una playa **sin registro oficial**, la caja podría
enseñar un "desde" más tardío de lo que la prensa realmente afirmó.

Arreglo: usar como saco los titulares del episodio completo — que ya
tenemos bien calculados — en vez de partir de `since`.

### 4. La causa del subtítulo vota sobre toda la historia, no sobre el episodio

El subtítulo de la caja ("cerrada por E. coli y enterococos") se elige
por votación: qué causa aparece más en las noticias. Ahora mismo vota
sobre **todas** las noticias guardadas de la playa (hasta 30, incluidos
episodios de hace años).

Caso donde fallaría: una playa tuvo muchísima prensa por algas en 2024 y
ahora cierra por E. coli con pocos titulares → la votación la ganarían
las algas del episodio viejo y la caja diría "cerrada por algas".

Arreglo: votar solo entre los titulares del episodio que se está
narrando.

---

## Hallazgos menores

### A. "Rescate en el mar" no entra en el filtro

El filtro de "estado del mar" funciona con una lista de palabras
(oleaje, temporal de mar, mar de fondo…). En la base de datos hay 4
noticias con causa *"rescate en el mar"* que no contienen ninguna de
esas palabras → el filtro no las caza.

Si alguna está clasificada como "cierre", seguirá apareciendo en el
historial. Hay que revisar cómo están clasificadas; probablemente son
tipo "otra noticia" y no molestan, pero conviene confirmarlo.

### B. Código duplicado para limpiar texto

Para el filtro del mar se creó una función que normaliza texto (quita
acentos, minúsculas, caracteres raros). Ya existía otra función casi
idéntica en el mismo archivo usada para otra cosa. Mismo trabajo en dos
sitios: si un día se mejora una, la otra se queda vieja. Toca reutilizar.

### C. Titulares casi duplicados del mismo medio

estenerife publicó el 25/09 dos piezas casi iguales sobre el Médano.
El desplegable agrupa titulares por medio, pero el mismo medio puede
aparecer dos veces seguidas. Puro efecto cosmético.

### D. Lección operativa: el uvicorn fantasma

El susto de los "18 medios" fue que el móvil apuntaba al puerto 8004,
donde vivía un proceso viejo con el código antiguo. Ya está resuelto
(`.env` → `docker:8001`), pero conviene apuntar en `AGENTS.md`:

- Desarrollo siempre contra `docker:8001`, nada de uvicorn suelto
- Añadir una versión/commit al endpoint `/health` para detectar código
  viejo a la primera

---

*Generado tras la sesión de fixes de episodios de prensa — provisional.*

# Evaluación de evidencia textual — 17 noviembre 2026

Modelo: `gemini-3.5-flash-lite`. Artículos de producción descargados en
modo lectura. Ninguna extracción de esta prueba se aplicó a `news_items`.
Herramienta reproducible: `python -m scripts.evaluate_news --ids ...`.
Los IDs sirven para identificar las fuentes, no son fixtures de tests.

Primera comparación: 12 URLs solicitadas, 11 con cuerpo accesible. Cada
artículo accesible se evaluó con el prompt anterior y la primera candidata
con cita. El cuerpo de 83 (Playa Jardín) no se pudo obtener: no es un acierto
ni un fallo de clasificación. La candidata detectó San Marcos sin cierre,
pero omitió una cita válida en Patos 655 y descartó el artículo multi-playa
660. Por eso no se activó como requisito en ingesta automática.

Segunda prueba: 8 artículos con la candidata que exige el campo de cita en
el esquema. Se permitió obtener playa/municipio explícitos del cuerpo.

| Ítem | Caso | Resultado de la segunda prueba |
| --- | --- | --- |
| 1146 | San Marcos, desprendimiento junto a avenida cerrada en 2023 | No relevante; no inventó un cierre de playa |
| 655 | Patos, tercer verano cerrada | `closure/whole`, cita literal; causa vacía porque el texto no la indica |
| 906 | Patos, decreto de cierre por desprendimiento | `closure/whole`, causa y cita literal |
| 1905 | Roques, acceso cerrado | `closure/whole`, cita literal; fecha inferida por el modelo, requiere revisión |
| 663 | Garañona, reportaje que afirma acceso prohibido | No relevante: falso negativo que sigue sin resolverse |
| 528 | Punta Larga, acceso al último tramo | `closure/partial`; no cierre total. No reemplaza la verificación de campo |
| 234 | Benijo, planes para reabrir | Propuso cierre con cita «encara ahora el camino de regreso»: cita literal pero insuficiente |
| 468 | Jardín, reapertura municipal efectiva | `reopening`, cita literal de la reapertura |

La validación local adicional rechaza citas de cierre/reapertura que no
contengan ninguna afirmación de ese tipo: el caso 234 queda como contexto.
Esta condición es necesaria pero no prueba por sí sola la semántica.

Otros límites observados en la primera comparación:

- El Pris (319): ambos prompts descartaron la reapertura de una piscina.
- Siete playas (657): ambos descartaron el artículo multi-playa.
- Loro Parque (660): el anterior seleccionó Leocadio/E. coli y la candidata
  descartó el artículo; no se pueden copiar sus campos a todas las playas.
- Interián (1561): ambos descartaron el cierre del paseo como evento de playa.

## Decisión

Mantener `PROMPT` en ingesta y exigir citas solo en la auditoría, donde
cualquier cambio de estado/campos/asociación queda como propuesta persistida.
Las correcciones `locked` nunca se reextraen. La falta de cita o los fallos
del modelo no eliminan evidencia existente. No se afirma precisión del
100% ni ausencia de regresiones: esta muestra es pequeña y el proveedor
no es determinista.

## Operación

`reextract_news` guarda una campaña calculada con prompt, esquema, modelo
y versión del proceso. Reiniciarlo no repite URLs terminadas; una nueva
versión abre otra campaña. `--dry-run` no escribe progreso ni datos.

- `--report`: exporta propuestas, originales y errores en JSONL.
- `--accept ID`: aplica exactamente la propuesta almacenada, sin LLM, solo
  si el original sigue idéntico y no está bloqueado; congela el resultado.
- `--reject ID`: conserva y congela el original.
- No existe `--apply-demotions`: no hay aprobación masiva de reextracciones.
- Cuerpos inaccesibles quedan para revisión manual, sin reintentos diarios
  que gasten cuota. Fallos del proveedor permanecen pendientes y paran el lote.
- El cron diario ejecuta `scripts/reextract_backlog.sh` con límite global,
  no una cadena de años que siga gastando llamadas tras fallar el proveedor.

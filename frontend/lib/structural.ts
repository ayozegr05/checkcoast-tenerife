// Detección de cierre estructural — módulo hoja (sin imports del
// proyecto) para que tanto mapData como beachGroups/beachStatus lo
// usen sin ciclo de dependencias. La taxonomía la decide el backend
// (_STRUCTURAL_CAUSES en queries.py) y este set es su espejo.

import type { GeoFeature } from './api';

// Causas estructurales: no se resuelven solas (hace falta obra civil)
// — a diferencia de un episodio de contaminación, se mantienen en el
// tiempo aunque la prensa deje de hablar de ellas
export const STRUCTURAL_CAUSES = new Set([
  'Desprendimientos',
  'Obras',
  'Colapso del terreno',
]);

// Cierre por causa estructural: lo decide el backend por mayoría de
// prensa (alert_structural); sin el flag (API antigua) cae a
// alert_cause, que puede ser minoritaria
export const isStructuralClosure = (f: GeoFeature) =>
  f.properties.status === 'closed' &&
  (f.properties.alert_structural ??
    (!!f.properties.alert_cause &&
      STRUCTURAL_CAUSES.has(f.properties.alert_cause)));

// Resolutor ÚNICO del estado efectivo de una playa — la matriz que
// usan lista (statusOf), mapa (beachCategory) y ficha (beachStatusKey)
// para no contar estados distintos del mismo punto. Una OSM sin
// monitorizar con alerta viva se etiqueta por la alerta (Benijo);
// una abierta oficialmente pero con alerta viva degrada a 'warning'
// (cierre según prensa); un cierre estructural devuelve 'structural'
export const beachStateKey = (f: GeoFeature) =>
  f.properties.monitored === false && f.properties.alert !== true
    ? 'unmonitored'
    : isStructuralClosure(f)
      ? 'structural'
      : f.properties.alert === true && f.properties.status === 'open'
        ? 'warning'
        : (f.properties.status ?? 'unknown');

// Etiquetas canónicas por estado — una sola fuente para lista, leyenda
// y ficha. Dos registros a propósito: el compacto cabe en chips y
// leyenda ("Apta"), el descriptivo explica en la ficha ("Sin alertas
// activas")
export const BEACH_STATE_LABEL: Record<string, string> = {
  open: 'Apta',
  warning: 'Aviso',
  closed: 'Cerrada',
  structural: 'Cerrada · estructural',
  unknown: 'Sin datos',
  unmonitored: 'Sin monitorizar',
};

export const BEACH_STATE_LABEL_LONG: Record<string, string> = {
  open: 'Sin alertas activas',
  warning: 'Aviso activo',
  closed: 'Cierre activo',
  structural: 'Cierre estructural',
  unknown: 'Sin datos oficiales',
  unmonitored: 'Sin monitorización oficial',
};

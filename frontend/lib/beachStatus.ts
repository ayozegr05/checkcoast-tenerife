import type { GeoFeature } from './api';

// Estado de playa para el selector de puntos de muestreo y el acento
// de la cabecera de la ficha. Una playa abierta oficialmente pero
// con alerta viva (p.ej. cierre según prensa) se degrada a warning —
// misma regla que el chip de BeachDetail: sin ella el selector de
// zonas decía "Sin alertas activas" donde la ficha decía "Aviso".
export const beachStatusKey = (f: GeoFeature) =>
  f.properties.monitored === false && f.properties.alert !== true
    ? 'unmonitored'
    : f.properties.alert === true && f.properties.status === 'open'
      ? 'warning'
      : (f.properties.status ?? 'unknown');

export const BEACH_STATUS_TEXT: Record<string, string> = {
  closed: 'Cierre activo',
  warning: 'Aviso activo',
  open: 'Sin alertas activas',
  unknown: 'Sin datos oficiales',
  unmonitored: 'Sin monitorizar',
};

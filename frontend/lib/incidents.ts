import type { BeachIncident } from './api';

// Un incidente es "cierre" si la observación prohíbe el baño; los
// eventos reconstruidos (analítica/prensa) siempre son cierres
export const isClosure = (inc: BeachIncident) =>
  inc.via === 'press' ||
  inc.via === 'measurement' ||
  /prohib/i.test(inc.observations ?? '');

// Náyade a veces abre una "incidencia" cuyo texto es solo la
// evaluación pendiente de una muestra (p.ej. Las Gaviotas 08/06/2026:
// playa cerrada por obras, muestra tomada y nunca clasificada). No es
// un incidente real: se muestra con etiqueta y texto propios
export const isUnclassified = (inc: BeachIncident) =>
  /sin\s*calificar/i.test(inc.observations ?? '');

// Cierres cuya apertura cayó dentro de los últimos `years` años
export const closuresInYears = (
  incidents: BeachIncident[],
  years: number,
  now: number = Date.now(),
) => {
  const cutoff = now - years * 365.25 * 24 * 3600 * 1000;
  return incidents.filter(
    (i) => isClosure(i) && Date.parse(i.opened_at) >= cutoff,
  ).length;
};

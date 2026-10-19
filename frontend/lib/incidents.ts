import type { BeachIncident } from './api';

// Un incidente es "cierre" si la observación prohíbe el baño; los
// eventos reconstruidos (analítica/prensa) siempre son cierres.
// Una incidencia oficial cuya prensa adjunta habla de cierre/
// reapertura también cuenta — Náyade la anotó como "recomendación"
// pero el baño estuvo vetado de facto (Jardín PM4 ago-2026)
export const isClosure = (inc: BeachIncident) =>
  inc.via === 'press' ||
  inc.via === 'measurement' ||
  // í incluida: el backend normaliza la observación a
  // "Sanidad prohíbe el baño" — con tilde no casa /prohib/
  /proh[ií]b/i.test(inc.observations ?? '') ||
  (inc.press_items ?? []).some(
    (p) => p.event_type === 'closure' || p.event_type === 'reopening',
  );

// Náyade a veces abre una "incidencia" cuyo texto es solo la
// evaluación pendiente de una muestra (p.ej. Las Gaviotas 08/06/2026:
// playa cerrada por obras, muestra tomada y nunca clasificada). No es
// un incidente real: se muestra con etiqueta y texto propios
export const isUnclassified = (inc: BeachIncident) =>
  /sin\s*calificar/i.test(inc.observations ?? '');

// Episodios (cierres / avisos / agua no apta) con apertura a partir
// de `cutoff` (ms epoch). Los atribuidos a un punto hermano no
// cuentan — son episodios de otra zona del arenal, no de este punto.
// `lab` = episodios reconstruidos por analítica: el agua salió no
// apta pero Sanidad no registró incidencia — NO son cierres y el
// contador no debe afirmarlo
export const countSince = (
  incidents: BeachIncident[],
  cutoff: number,
  now?: number,
) => {
  const inWindow = incidents.filter(
    (i) =>
      !i.attributed_pm &&
      !isUnclassified(i) &&
      Date.parse(i.opened_at) >= cutoff,
  );
  return {
    closures: inWindow.filter((i) => isClosure(i) && i.via !== 'measurement')
      .length,
    warnings: inWindow.filter((i) => !isClosure(i)).length,
    lab: inWindow.filter((i) => i.via === 'measurement').length,
  };
};

export const episodesInYears = (
  incidents: BeachIncident[],
  years: number,
  now: number = Date.now(),
) => countSince(incidents, now - years * 365.25 * 24 * 3600 * 1000);

// "Este año" = año natural: un episodio abierto en noviembre del año
// pasado NO es de este año aunque caiga en una ventana de 365 días
export const episodesThisYear = (
  incidents: BeachIncident[],
  now: number = Date.now(),
) =>
  countSince(incidents, new Date(new Date(now).getFullYear(), 0, 1).getTime());

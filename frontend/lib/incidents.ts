import type { BeachIncident } from './api';

// Un incidente es "cierre" si la observación prohíbe el baño, si
// solo existe en prensa, o si una ventana de analítica prohibida
// quedó corroborada por prensa de cierre (press_confirmed). La
// analítica MUDA — sin corroboración — es "agua no apta": el agua
// salió mal pero nadie demostró que la playa se cerrara, y nunca
// cuenta como cierre.
// Una incidencia oficial cuya prensa adjunta habla de cierre/
// reapertura también cuenta — Náyade la anotó como "recomendación"
// pero el baño estuvo vetado de facto (Jardín PM4 ago-2026)
export const isClosure = (inc: BeachIncident) =>
  inc.via === 'press' ||
  (inc.via === 'measurement' && inc.press_confirmed === true) ||
  // í incluida: el backend normaliza la observación a
  // "Sanidad prohíbe el baño" — con tilde no casa /prohib/
  /proh[ií]b/i.test(inc.observations ?? '') ||
  (inc.press_items ?? []).some(
    (p) => p.event_type === 'closure' || p.event_type === 'reopening',
  );

// Episodio de laboratorio mudo: via=measurement sin corroboración
// de cierre. Ni cierre ni aviso — categoría propia "agua no apta"
export const isMuteLab = (inc: BeachIncident) =>
  inc.via === 'measurement' && inc.press_confirmed !== true;

// Náyade a veces abre una "incidencia" cuyo texto es solo la
// evaluación pendiente de una muestra. Es una nota administrativa,
// no un incidente real — SALVO que la prensa adjunta documente el
// evento: entonces es el registro oficial del episodio y se muestra
// como tal (Las Gaviotas 08/06/2026: "Sin Calificar" pero la prensa
// prueba el cierre por desprendimientos que sigue vigente)
// Regex cruda sobre el texto de la observación — el render la usa
// para decidir la nota legible ("muestra nunca clasificada") aunque
// el episodio esté corroborado por prensa
export const isUnclassifiedObs = (obs?: string | null) =>
  /sin\s*calificar/i.test(obs ?? '');

export const isUnclassified = (inc: BeachIncident) =>
  isUnclassifiedObs(inc.observations) &&
  !(inc.press_items ?? []).some(
    (p) =>
      p.event_type === 'closure' ||
      p.event_type === 'reopening' ||
      p.event_type === 'warning' ||
      p.event_type === 'pollution',
  );

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
    closures: inWindow.filter(isClosure).length,
    warnings: inWindow.filter((i) => !isClosure(i) && !isMuteLab(i)).length,
    lab: inWindow.filter(isMuteLab).length,
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

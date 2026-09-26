// Agregados sobre los episodios insulares de `/episodes`: el resumen
// anual de las cabeceras, las resueltas del panel de alertas y la
// lista de la vista Temporada (ranking municipal). Funciones puras.

import type { MunicipalityIncident } from './api';

// Temporada de baño: 1 jun – 30 sep. Fuera de ese rango la temporada
// de referencia es la del año anterior (ya cerrada).
export const seasonYear = (today: Date = new Date()): number =>
  today.getMonth() + 1 >= 6
    ? today.getFullYear()
    : today.getFullYear() - 1;

// Episodios que TOCARON la temporada de baño del año dado: los que
// empezaron en jun-sep Y los que venían abiertos de antes y seguían
// (o cerraron) durante el verano — Benijo lleva cerrada desde 2024 y
// fue un cierre de este verano igualmente
export const seasonEpisodes = (
  eps: MunicipalityIncident[],
  year: number = seasonYear(),
): MunicipalityIncident[] => {
  const seasonStart = `${year}-06-01`;
  const seasonEnd = `${year}-09-30`;
  return eps.filter(
    (e) =>
      e.opened_at <= seasonEnd &&
      (e.closed_at === null || e.closed_at >= seasonStart),
  );
};

// Desglose de causas de un conjunto de episodios:
// "9 contaminación · 3 desprendimientos · 2 sin causa"
export const causeBreakdown = (
  eps: MunicipalityIncident[],
): string => {
  const byCause = new globalThis.Map<string, number>();
  let unknown = 0;
  for (const e of eps) {
    if (e.cause) byCause.set(e.cause, (byCause.get(e.cause) ?? 0) + 1);
    else unknown += 1;
  }
  const parts = [...byCause.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([cause, n]) => `${n} ${cause.charAt(0).toLowerCase()}${cause.slice(1)}`);
  if (unknown) parts.push(`${unknown} sin causa`);
  return parts.join(' · ');
};

// Cierres (no avisos) abiertos en el año en curso — para "N cierres
// en 2026" de las cabeceras
export const closuresThisYear = (
  eps: MunicipalityIncident[],
  year: number = new Date().getFullYear(),
): MunicipalityIncident[] =>
  eps.filter(
    (e) => e.kind === 'closure' && e.opened_at.startsWith(`${year}-`),
  );

// Episodios sin fecha de cierre: siguen vivos
export const activeEpisodes = (
  eps: MunicipalityIncident[],
): MunicipalityIncident[] => eps.filter((e) => e.closed_at === null);

// Resueltas en los últimos `days` — la sección verde del panel de
// alertas (puente entre el push de reapertura y la ficha)
export const recentlyResolved = (
  eps: MunicipalityIncident[],
  days = 30,
  today: Date = new Date(),
): MunicipalityIncident[] => {
  const lim = new Date(today.getTime() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return eps.filter((e) => e.closed_at !== null && e.closed_at >= lim);
};

// Días naturales que duró (o lleva) un episodio, incluyendo el inicial
export const episodeDays = (e: MunicipalityIncident): number => {
  const end = e.closed_at
    ? new Date(`${e.closed_at}T00:00:00Z`)
    : new Date();
  return (
    Math.max(
      0,
      Math.round(
        (end.getTime() - new Date(`${e.opened_at}T00:00:00Z`).getTime()) /
          86_400_000,
      ),
    ) + 1
  );
};

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

// Episodios que SE SOLAPAN con la ventana [start, end] (ISO): los que
// empezaron dentro Y los que venían abiertos de antes y seguían (o
// cerraron) durante ella — Benijo lleva cerrada desde 2024 y fue un
// cierre de este verano igualmente
const overlapping = (
  eps: MunicipalityIncident[],
  start: string,
  end: string,
): MunicipalityIncident[] =>
  eps.filter(
    (e) =>
      e.opened_at <= end &&
      (e.closed_at === null || e.closed_at >= start),
  );

// Episodios que tocaron la temporada de baño (jun-sep) del año dado
export const seasonEpisodes = (
  eps: MunicipalityIncident[],
  year: number = seasonYear(),
): MunicipalityIncident[] =>
  overlapping(eps, `${year}-06-01`, `${year}-09-30`);

// Episodios que tocaron el año natural (ene-dic) — la vista "Este año"
export const yearEpisodes = (
  eps: MunicipalityIncident[],
  year: number = new Date().getFullYear(),
): MunicipalityIncident[] =>
  overlapping(eps, `${year}-01-01`, `${year}-12-31`);

// Años con algún episodio (selector de temporada/año): del más viejo
// al actual — Benijo abrió en 2024 y sigue abierta, así que 2025 y
// 2026 también cuentan como años que la "tocaron"
export const episodeYears = (eps: MunicipalityIncident[]): number[] => {
  const cur = new Date().getFullYear();
  const first = eps.reduce(
    (min, e) => Math.min(min, Number(e.opened_at.slice(0, 4)) || cur),
    cur,
  );
  const years: number[] = [];
  for (let y = cur; y >= first; y--) years.push(y);
  return years;
};

// Pares [causa, nº episodios] ordenados por frecuencia — para las
// cabeceras y las chips-filtro de la vista "Este año". Los episodios
// sin causa van al final como etiqueta "sin causa".
export const causeCounts = (
  eps: MunicipalityIncident[],
): [string, number][] => {
  const byCause = new globalThis.Map<string, number>();
  let unknown = 0;
  for (const e of eps) {
    if (e.cause) byCause.set(e.cause, (byCause.get(e.cause) ?? 0) + 1);
    else unknown += 1;
  }
  const out: [string, number][] = [...byCause.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  if (unknown) out.push(['sin causa', unknown]);
  return out;
};

// Desglose de causas de un conjunto de episodios:
// "9 contaminación · 3 desprendimientos · 2 sin causa"
export const causeBreakdown = (
  eps: MunicipalityIncident[],
): string =>
  causeCounts(eps)
    .map(
      ([cause, n]) =>
        `${n} ${cause.charAt(0).toLowerCase()}${cause.slice(1)}`,
    )
    .join(' · ');

// Cierres (no avisos) que TOCARON el año en curso — misma semántica
// de solape que la vista "Este año": un cierre abierto antes que sigue
// (o siguió durante) el año cuenta igual (Benijo cerró todo 2026
// aunque abriera en 2024). Si esta cuenta difiere del desglose que
// ve el usuario al entrar, la cifra miente
export const closuresThisYear = (
  eps: MunicipalityIncident[],
  year: number = new Date().getFullYear(),
): MunicipalityIncident[] =>
  yearEpisodes(eps, year).filter((e) => e.kind === 'closure');

// Episodios sin fecha de cierre: siguen vivos
export const activeEpisodes = (
  eps: MunicipalityIncident[],
): MunicipalityIncident[] => eps.filter((e) => e.closed_at === null);

// Resueltas en los últimos `days` — la sección verde del panel de
// alertas (puente entre el push de reapertura y la ficha). Un fin
// estimado (última mención en prensa) no es una reapertura: no sale
export const recentlyResolved = (
  eps: MunicipalityIncident[],
  days = 30,
  today: Date = new Date(),
): MunicipalityIncident[] => {
  const lim = new Date(today.getTime() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return eps.filter(
    (e) =>
      e.closed_at !== null && !e.end_estimated && e.closed_at >= lim,
  );
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

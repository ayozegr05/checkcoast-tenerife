import { BeachStats, GeoFeature, MunicipalityIncident } from './api';
import { causeFamily, closuresThisYear } from './episodes';
import { displayBeachName } from './format';
import { colors } from './theme';

export type MuniStats = {
  municipality: string | null;
  name: string;
  beaches: number; // playas distintas (nombre base sin "PMx")
  points: number; // puntos de muestreo monitorizados
  closedNow: number;
  warningNow: number;
  incidents: number; // cierres + avisos históricos
  closuresLastYear: number;
  badSamples: number;
  // Modo-año (ranking con un año pasado seleccionado): episodios del
  // municipio en selYear — deduplicados por playa base en /episodes,
  // misma fuente que la vista "Este año"
  yearClosures?: number;
  yearWarnings?: number;
  yearActive?: number;
  yearBeaches?: string[]; // playas afectadas ese año
};

type MuniAcc = Omit<MuniStats, 'beaches'> & { beachNames: Set<string> };

// Una playa extensa tiene varios puntos de muestreo (PM1, PM2...):
// para el conteo de playas agrupamos por nombre base
export const baseName = (name: string) => name.replace(/\s+PM\d+$/, '');

// Severidad: mandan las afectaciones activas (cierre pesa más que aviso);
// el histórico de incidentes y muestras no aptas desempata
export const scoreOf = (m: MuniStats) =>
  m.closedNow * 100 + m.warningNow * 20 + m.incidents + m.badSamples;

export const barColorOf = (m: MuniStats) =>
  m.closedNow > 0
    ? colors.status.closed
    : m.warningNow > 0
      ? colors.status.warning
      : colors.status.open;

// Círculo de posición: el podio usa el color de severidad del municipio
// (rojo = cierres ahora, naranja = avisos, azul = solo histórico) — el
// top 3 marca "los que peor están", no un premio. Neutro del 4º en adelante
export const rankColorOf = (m: MuniStats, index: number) =>
  index < 3 ? barColorOf(m) : '#8fa3ad';

// Modo-año: un cierre pesa el triple que un aviso; la barra roja si
// hubo cierres, naranja si solo avisos
export const yearScoreOf = (m: MuniStats) =>
  (m.yearClosures ?? 0) * 3 + (m.yearWarnings ?? 0);

export const yearBarColorOf = (m: MuniStats) =>
  (m.yearClosures ?? 0) > 0 ? colors.status.closed : colors.status.warning;

export const fmtDate = (iso: string) => iso.split('-').reverse().join('/');

// Chips de año visibles antes de plegar el resto tras "Más años ›"
export const MAX_YEAR_CHIPS = 4;

// Duración en días naturales incluyendo el día de apertura
export const durationDays = (inc: MunicipalityIncident) => {
  const end = inc.closed_at ? new Date(inc.closed_at) : new Date();
  return Math.max(
    1,
    Math.round((end.getTime() - new Date(inc.opened_at).getTime()) / 86400000) +
      1,
  );
};

export type YearMuniStat = {
  closures: number;
  warnings: number;
  active: number;
  beaches: Set<string>;
};

// Episodios del año seleccionado por municipio: /episodes ya viene
// deduplicado por playa base (un cluster por playa física, no por
// PM — el megacierre de Jardín en PM1/PM4/PM5 cuenta una vez)
export function yearMuniCounts(
  yearAll: MunicipalityIncident[],
): Map<string | null, YearMuniStat> {
  const m = new Map<string | null, YearMuniStat>();
  for (const e of yearAll) {
    const c = m.get(e.municipality) ?? {
      closures: 0,
      warnings: 0,
      active: 0,
      beaches: new Set<string>(),
    };
    if (e.kind === 'closure') c.closures += 1;
    else c.warnings += 1;
    if (e.closed_at === null) c.active += 1;
    c.beaches.add(displayBeachName(e.beach_name));
    m.set(e.municipality, c);
  }
  return m;
}

// Municipios con cierres de la causa activa en el año seleccionado:
// en "Por municipio" las chips también filtran el ranking — solo
// quedan los municipios que sufrieron ese tipo de episodio
export function muniCauseCounts(
  causeScope: MunicipalityIncident[],
  yearCause: string,
): Map<string | null, number> {
  const m = new Map<string | null, number>();
  if (yearCause === 'all') return m;
  for (const e of causeScope) {
    if (e.kind !== 'closure') continue;
    const hit =
      yearCause === 'sin causa' ? !e.cause : causeFamily(e.cause) === yearCause;
    if (!hit) continue;
    m.set(e.municipality, (m.get(e.municipality) ?? 0) + 1);
  }
  return m;
}

// Agregación por municipio sobre las features del mapa + /beach_stats.
// Devuelve las filas ordenadas por severidad (el filtro de causa se
// aplica fuera, donde vive muniCauseCounts)
export function buildMuniRows(
  beaches: GeoFeature[],
  stats: Map<number, BeachStats>,
): MuniStats[] {
  const byMuni = new Map<string, MuniAcc>();
  for (const f of beaches) {
    const municipality = f.properties.municipality ?? null;
    const name = municipality ?? 'Sin municipio';
    const m = byMuni.get(name) ?? {
      municipality,
      name,
      beachNames: new Set<string>(),
      points: 0,
      closedNow: 0,
      warningNow: 0,
      incidents: 0,
      closuresLastYear: 0,
      badSamples: 0,
    };
    // El conteo de playas incluye todas las catalogadas;
    // solo las monitorizadas tienen estado oficial ni stats
    m.beachNames.add(baseName(f.properties.name));
    // El estado vivo cuenta para TODAS las playas: una OSM cerrada
    // según prensa (Benijo) también es una afectación real. Los
    // puntos de muestreo y el histórico sí son solo de monitorizadas
    if (f.properties.status === 'closed') m.closedNow += 1;
    else if (f.properties.status === 'warning') m.warningNow += 1;
    if (f.properties.monitored !== false) {
      m.points += 1;
      const st = stats.get(f.id);
      if (st) {
        m.incidents += st.closures + st.warnings;
        m.closuresLastYear += st.closures_last_year;
        m.badSamples += st.bad_samples;
      }
    }
    // Los episodios reconstruidos (analítica sin incidencia, cierres
    // solo en prensa) cuentan como incidentes reales también en las
    // playas no monitorizadas — Benijo cerró de verdad
    const st = stats.get(f.id);
    if (st?.reconstructed) m.incidents += st.reconstructed;
    byMuni.set(name, m);
  }
  return [...byMuni.values()]
    .map(({ beachNames, ...m }): MuniStats => ({
      ...m,
      beaches: beachNames.size,
    }))
    .sort((a, b) => scoreOf(b) - scoreOf(a) || a.name.localeCompare(b.name));
}

// Línea-resumen bajo el título del ranking: histórico completo con
// causas y año de inicio, o "año · N cierres" en modo-año
export function yearLineText(
  episodes: MunicipalityIncident[],
  beaches: GeoFeature[],
  selYear: number,
  isYearMode: boolean,
  years: number[],
): string | null {
  // "Activas" = alertas VIVAS (estado efectivo), no episodios sin
  // cerrar: un cierre estructural sin prensa fresca sigue vivo aunque
  // su episodio tenga fin estimado (Benijo, Gaviotas, Garachico)
  const live = beaches.filter(
    (f) =>
      f.properties.status === 'closed' || f.properties.status === 'warning',
  ).length;
  if (!isYearMode) {
    // Histórico: registro completo — totales, causas de los cierres
    // y desde qué año hay datos (mediciones Náyade desde ene-2023)
    const closures = episodes.filter((e) => e.kind === 'closure');
    const warnings = episodes.length - closures.length;
    if (closures.length === 0 && warnings === 0) return null;
    const firstYear = years[years.length - 1];
    const parts = [
      `${closures.length} ${closures.length === 1 ? 'cierre' : 'cierres'}`,
    ];
    if (warnings)
      parts.push(`${warnings} ${warnings === 1 ? 'aviso' : 'avisos'}`);
    let line = parts.join(' · ');
    if (firstYear) line += ` desde ${firstYear}`;
    if (live) line += ` · ${live} ${live === 1 ? 'activa' : 'activas'} ahora`;
    return line;
  }
  const n = closuresThisYear(episodes, selYear).length;
  if (n === 0) return null;
  return `${selYear} · ${n} ${n === 1 ? 'cierre' : 'cierres'}`;
}

import { BeachStats, GeoFeature, MunicipalityIncident } from './api';
import { causeFamily, episodeDays } from './episodes';
import { beachGroupKey, displayBeachName, fmtDate } from './format';
import { PM_SUFFIX } from './pm';
import { colors } from './theme';

export { fmtDate };

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
export const baseName = (name: string) => name.replace(PM_SUFFIX, '');

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

// Modo-año: un cierre pesa el triple que un aviso — ordena el
// ranking y llena su barra (misma métrica)
export const yearScoreOf = (m: MuniStats) =>
  (m.yearClosures ?? 0) * 3 + (m.yearWarnings ?? 0);

// Chips de año visibles antes de plegar el resto tras "Más años ›"
export const MAX_YEAR_CHIPS = 4;

// Duración en días naturales incluyendo el día de apertura —
// mismo cálculo que episodeDays (fuente canónica en episodes.ts)
export const durationDays = episodeDays;

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
    // solo las monitorizadas tienen estado oficial ni stats.
    // Misma clave que la lista de playas (calas fundidas en su
    // arenal, variantes OSM↔censo unificadas) — si no, el "N
    // playas" de la ficha no cuadra con lo que el usuario ve
    m.beachNames.add(beachGroupKey(f.properties.name));
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
    // Los episodios reconstruidos (cierres solo en prensa o
    // corroborados por ella) cuentan como incidentes reales también
    // en las playas no monitorizadas — Benijo cerró de verdad. Las
    // analíticas mudas no entran aquí: van en badSamples
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

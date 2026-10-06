// Lógica pura de agrupación y orden de playas para BeachList (y tests):
// PMs → una fila por playa (nombre base + municipio), orden por estado.

import type { BeachStats, GeoFeature } from './api';
import { beachBaseName, beachGroupKey, searchNorm } from './format';

// Orden de prioridad: lo que necesita atención del bañista primero.
// "Sin datos" (vigilada pero Náyade no dice nada) va la última de
// todas — es el estado menos informativo, por debajo incluso de las
// no monitorizadas
export const STATUS_ORDER: Record<string, number> = {
  closed: 0,
  warning: 1,
  open: 2,
  unmonitored: 3,
  unknown: 4,
};

// Una OSM sin monitorizar con alerta (p.ej. Benijo, cerrada según
// prensa) se ordena/etiqueta por el estado de la alerta
export const statusOf = (f: GeoFeature) =>
  f.properties.monitored === false && f.properties.alert !== true
    ? 'unmonitored'
    : (f.properties.status ?? 'unknown');

export const pmNum = (name: string) => {
  const m = name.match(/PM(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
};

export type BeachGroup = {
  key: string;
  name: string;
  municipality: string | null;
  members: GeoFeature[];
};

// El grupo solo es seguro dentro del mismo municipio: Náyade repite
// nombres entre zonas distintas ("Caleta de Negros")
export const groupKeyOf = (f: GeoFeature) =>
  `${f.properties.municipality ?? ''}|${beachGroupKey(f.properties.name)}`;

export const worstStatusOf = (g: BeachGroup) =>
  g.members
    .map(statusOf)
    .sort((a, b) => (STATUS_ORDER[a] ?? 9) - (STATUS_ORDER[b] ?? 9))[0] ??
  'unknown';

export type SortMode = 'estado' | 'cierres' | 'calidad';

// Puntuación de calidad: peor = evaluación mala + más muestras no aptas
// El historial pesa de verdad (una playa con 8 muestras "prohibido"
// debe rankear peor que una sin ninguna, aunque hoy esté "Apta"); la
// evaluación actual solo desempata — antes pesaba al revés y una
// vigilada sin evaluar ("Sin datos") ganaba a Jardín (8 muestras malas)
export const qualityScore = (s: BeachStats | undefined): number => {
  if (!s) return -1;
  const evalScore = s.latest_evaluation
    ? /prohib/i.test(s.latest_evaluation)
      ? 50
      : /calificar|recomend/i.test(s.latest_evaluation)
        ? 20
        : 0
    : 0;
  return s.bad_samples * 100 + evalScore;
};

// Etiqueta corta de una evaluación de muestra — para hacer visible
// en la fila el porqué del sort "peor calidad"
export const evalShort = (ev: string | null): string => {
  if (!ev) return 'sin muestras';
  if (/prohib/i.test(ev)) return 'prohibido';
  if (/apta/i.test(ev)) return 'apta';
  if (/calificar/i.test(ev)) return 'sin calificar';
  if (/recomend|baño/i.test(ev)) return 'no bañarse';
  if (/pendiente/i.test(ev)) return 'pendiente';
  return '—';
};

// Evaluación del PM con peor score del grupo (la que manda en el
// sort "peor calidad")
export const worstEvalOf = (
  g: BeachGroup,
  stats: Map<number, BeachStats>,
): string | null => {
  let worst: BeachStats | undefined;
  let ws = -2;
  for (const m of g.members) {
    const s = stats.get(m.id);
    const sc = qualityScore(s);
    if (sc > ws) {
      ws = sc;
      worst = s;
    }
  }
  return worst?.latest_evaluation ?? null;
};

// Filtra, agrupa PMs en playas y ordena según el modo elegido. El
// filtro de estado casa con la peor condición del grupo: es el estado
// que muestra la pastilla de cada fila.
export const buildGroups = (
  beaches: GeoFeature[],
  opts: {
    query?: string;
    municipality?: string | null;
    sortMode?: SortMode;
    statusFilter?: string;
    stats?: Map<number, BeachStats>;
  } = {},
): BeachGroup[] => {
  const stats = opts.stats ?? new Map<number, BeachStats>();
  const q = searchNorm(opts.query ?? '');
  const filtered = beaches.filter(
    (f) =>
      (!q || searchNorm(f.properties.name).includes(q)) &&
      (opts.municipality === undefined ||
        (opts.municipality === null
          ? f.properties.municipality == null
          : f.properties.municipality === opts.municipality)),
  );
  const map = new Map<string, BeachGroup>();
  for (const f of filtered) {
    const key = groupKeyOf(f);
    const g = map.get(key) ?? {
      key,
      name: beachBaseName(f.properties.name),
      municipality: f.properties.municipality ?? null,
      members: [],
    };
    g.members.push(f);
    map.set(key, g);
  }
  const arr = [...map.values()];
  for (const g of arr) {
    g.members.sort(
      (a, b) =>
        pmNum(a.properties.name) - pmNum(b.properties.name) ||
        a.properties.name.localeCompare(b.properties.name),
    );
  }
  const sum = (
    g: BeachGroup,
    k: 'closures' | 'closures_last_year' | 'reconstructed',
  ) => g.members.reduce((s, m) => s + (stats.get(m.id)?.[k] ?? 0), 0);
  // El mismo número que muestra la fila: cierres oficiales + episodios
  // reconstruidos (prensa/muestras) — si la fila dice "2 cierres",
  // el ranking la trata como 2
  const totalCierres = (g: BeachGroup) =>
    sum(g, 'closures') + sum(g, 'reconstructed');
  const worstQuality = (g: BeachGroup) =>
    Math.max(...g.members.map((m) => qualityScore(stats.get(m.id))));
  const byName = (a: BeachGroup, b: BeachGroup) => a.name.localeCompare(b.name);
  // Suelo común para "Más cierres"/"Peor calidad": un empate a 0 no
  // debe dejar que una playa sin monitorizar (alfabéticamente antes)
  // adelante a una vigilada — solo "Estado" tenía este suelo
  const byMonitored = (a: BeachGroup, b: BeachGroup) =>
    Number(worstStatusOf(a) === 'unmonitored') -
    Number(worstStatusOf(b) === 'unmonitored');
  if (opts.sortMode === 'cierres') {
    arr.sort(
      (a, b) =>
        byMonitored(a, b) ||
        totalCierres(b) - totalCierres(a) ||
        sum(b, 'closures_last_year') - sum(a, 'closures_last_year') ||
        byName(a, b),
    );
  } else if (opts.sortMode === 'calidad') {
    arr.sort(
      (a, b) =>
        byMonitored(a, b) || worstQuality(b) - worstQuality(a) || byName(a, b),
    );
  } else {
    arr.sort(
      (a, b) =>
        (STATUS_ORDER[worstStatusOf(a)] ?? 9) -
          (STATUS_ORDER[worstStatusOf(b)] ?? 9) || byName(a, b),
    );
  }
  // "impecables": grupos vigilados que nunca tuvieron un problema de
  // AGUA — ni una muestra no apta ni un episodio de contaminación
  // (oficial o de prensa). Desprendimientos/obras no descuentan: el
  // agua no tuvo la culpa
  if (opts.statusFilter === 'impecables') {
    return arr.filter(
      (g) =>
        g.members.some((m) => (stats.get(m.id)?.total_samples ?? 0) > 0) &&
        g.members.every(
          (m) =>
            (stats.get(m.id)?.non_apta_samples ?? 1) === 0 &&
            (stats.get(m.id)?.contam_episodes ?? 1) === 0,
        ),
    );
  }
  return opts.statusFilter === undefined
    ? arr
    : arr.filter((g) => worstStatusOf(g) === opts.statusFilter);
};

// Lógica pura de agrupación y orden de playas para BeachList (y tests):
// PMs → una fila por playa (nombre base + municipio), orden por estado.

import type { BeachStats, GeoFeature } from './api';
import { beachBaseName, beachGroupKey } from './format';

// Orden de prioridad: lo que necesita atención del bañista primero;
// las no monitorizadas van al final (no hay estado oficial que ordenar)
export const STATUS_ORDER: Record<string, number> = {
  closed: 0,
  warning: 1,
  unknown: 2,
  open: 3,
  unmonitored: 4,
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
  `${f.properties.municipality ?? ''}|${beachGroupKey(
    f.properties.name,
  )}`;

export const worstStatusOf = (g: BeachGroup) =>
  g.members
    .map(statusOf)
    .sort(
      (a, b) => (STATUS_ORDER[a] ?? 9) - (STATUS_ORDER[b] ?? 9),
    )[0] ?? 'unknown';

export type SortMode = 'estado' | 'cierres' | 'calidad';

// Puntuación de calidad: peor = evaluación mala + más muestras no aptas
export const qualityScore = (s: BeachStats | undefined): number => {
  if (!s) return -1;
  const evalScore = s.latest_evaluation
    ? /prohib/i.test(s.latest_evaluation)
      ? 3
      : /calificar|recomend/i.test(s.latest_evaluation)
        ? 2
        : /apta/i.test(s.latest_evaluation)
          ? 0
          : 1
    : 1;
  return evalScore * 1000 + s.bad_samples;
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
  const q = (opts.query ?? '').trim().toLowerCase();
  const filtered = beaches.filter(
    (f) =>
      (!q || f.properties.name.toLowerCase().includes(q)) &&
      (opts.municipality === undefined ||
        (opts.municipality === null
          ? f.properties.municipality == null
          : f.properties.municipality === opts.municipality)),
  );
  const map = new Map<string, BeachGroup>();
  for (const f of filtered) {
    const key = groupKeyOf(f);
    const g =
      map.get(key) ?? {
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
  const sum = (g: BeachGroup, k: 'closures' | 'closures_last_year') =>
    g.members.reduce((s, m) => s + (stats.get(m.id)?.[k] ?? 0), 0);
  const worstQuality = (g: BeachGroup) =>
    Math.max(...g.members.map((m) => qualityScore(stats.get(m.id))));
  const byName = (a: BeachGroup, b: BeachGroup) =>
    a.name.localeCompare(b.name);
  if (opts.sortMode === 'cierres') {
    arr.sort(
      (a, b) =>
        sum(b, 'closures_last_year') - sum(a, 'closures_last_year') ||
        sum(b, 'closures') - sum(a, 'closures') ||
        byName(a, b),
    );
  } else if (opts.sortMode === 'calidad') {
    arr.sort((a, b) => worstQuality(b) - worstQuality(a) || byName(a, b));
  } else {
    arr.sort(
      (a, b) =>
        (STATUS_ORDER[worstStatusOf(a)] ?? 9) -
          (STATUS_ORDER[worstStatusOf(b)] ?? 9) || byName(a, b),
    );
  }
  // "impecables": grupos con muestras cuyo histórico es todo "Apta"
  // (prohibido + Sin Calificar + recomendación cuentan en contra)
  if (opts.statusFilter === 'impecables') {
    return arr.filter(
      (g) =>
        g.members.some(
          (m) => (stats.get(m.id)?.total_samples ?? 0) > 0,
        ) &&
        g.members.every(
          (m) => (stats.get(m.id)?.non_apta_samples ?? 1) === 0,
        ),
    );
  }
  return opts.statusFilter === undefined
    ? arr
    : arr.filter((g) => worstStatusOf(g) === opts.statusFilter);
};

// Lógica pura del mapa (CoastMap y tests): agrupación de puntos de
// muestreo en pins, categorías de la leyenda, secciones del banner de
// alertas y buscador.

import type { GeoFeature } from './api';
import { groupKeyOf } from './beachGroups';
import {
  beachBaseName,
  beachPointLabel,
  displayBeachName,
  searchNorm,
} from './format';
import { colors } from './theme';

export const STRUCTURAL_SECTION = 'Cierre estructural';

// Categorías de causa que el backend emite para cierres estructurales
// (_STRUCTURAL_CAUSES en queries.py) — se mantienen en el tiempo, al
// contrario que un episodio de contaminación
export const STRUCTURAL_CAUSES = new Set([
  'Desprendimientos',
  'Obras',
  'Colapso del terreno',
]);

// [color, etiqueta, clave] de cada estado en leyenda y panel de capas
export type LayerState = [string, string, string];

export const BEACH_STATES: LayerState[] = [
  [colors.status.open, 'Apta', 'open'],
  [colors.status.warning, 'Aviso', 'warning'],
  [colors.status.closed, 'Cerrada', 'closed'],
  [colors.status.unmonitored, 'Sin monitorizar', 'unmonitored'],
];
export const OUTFALL_STATES: LayerState[] = [
  [colors.outfall.legal, 'Autorizado', 'legal'],
  [colors.outfall.illegal, 'No autorizado', 'illegal'],
  [colors.outfall.unknown, 'En trámite', 'unknown'],
];

// Solo un grupo con >=2 puntos de muestreo reales (etiqueta "PM" o
// romano) abre el selector de PMs en la card: duplicados OSM sin
// etiqueta agrupados por nombre (p.ej. La Hornilla) quedan como
// playa simple
export const pmMembersOf = (members?: GeoFeature[]) => {
  const labeled = (members ?? []).filter((m) =>
    beachPointLabel(m.properties.name),
  );
  return labeled.length > 1 ? labeled : undefined;
};

// Categoría visual del pin — la misma lógica que elige el icono:
// OSM sin monitorizar y playas de estado desconocido comparten pin
// gris, así que el filtro "Sin monitorizar" las cubre a ambas
export const beachCategory = (f: GeoFeature): string =>
  f.properties.monitored === false && f.properties.alert !== true
    ? 'unmonitored'
    : f.properties.status && f.properties.status !== 'unknown'
      ? (f.properties.status as string)
      : 'unmonitored';

// Emisarios: todo lo que no es legal/illegal lleva el pin "en trámite"
export const outfallCategory = (f: GeoFeature): string =>
  f.properties.status === 'legal' || f.properties.status === 'illegal'
    ? (f.properties.status as string)
    : 'unknown';

// Toggle inmutable de un estado en su set de la leyenda
export const toggleInSet = (set: Set<string>, key: string) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

export type MapBeachGroup = {
  members: GeoFeature[];
  // PM peor parado: su ficha es la que abre el pin
  rep: GeoFeature;
  center: [number, number];
};

// Agrupación por playa: cada punto de muestreo (PM1, PM2, Troya I/II)
// es un registro oficial distinto, pero el mapa dibuja UN pin por
// playa en el centroide, coloreado por el peor estado del grupo.
export function buildBeachGroups(
  features: GeoFeature[],
): Map<string, MapBeachGroup> {
  const groups = new Map<string, MapBeachGroup>();
  for (const f of features) {
    const key = groupKeyOf(f);
    const g = groups.get(key) ?? {
      members: [],
      rep: f,
      center: [0, 0] as [number, number],
    };
    g.members.push(f);
    groups.set(key, g);
  }
  const rank = (f: GeoFeature) => {
    const s =
      f.properties.monitored === false && f.properties.alert !== true
        ? 'unmonitored'
        : (f.properties.status ?? 'unknown');
    return (
      { closed: 0, warning: 1, unknown: 2, open: 3, unmonitored: 4 }[s] ?? 5
    );
  };
  for (const g of groups.values()) {
    // Orden estable del selector de PMs (PM1<PM2, Troya I<II)
    g.members.sort((a, b) =>
      a.properties.name.localeCompare(b.properties.name),
    );
    g.rep = g.members.reduce(
      (a, b) => (rank(b) < rank(a) ? b : a),
      g.members[0],
    );
    const n = g.members.length;
    g.center = [
      g.members.reduce((s, f) => s + f.geometry.coordinates[0], 0) / n,
      g.members.reduce((s, f) => s + f.geometry.coordinates[1], 0) / n,
    ];
  }
  return groups;
}

export type AlertSection = [string, GeoFeature[]];

// Dos grandes categorías de alerta: contaminación (transitoria) y
// cierre estructural (desprendimientos/obras/colapso — se mantiene
// en el tiempo), más los avisos. Dentro de cada sección, de la más
// reciente a la más antigua por inicio real de la alerta (alerted_at).
// Las secciones vacías no se devuelven
export function buildAlertSections(alerts: GeoFeature[]): AlertSection[] {
  const byWhen = (a: GeoFeature, b: GeoFeature) =>
    (b.properties.alerted_at ?? b.properties.reported_at ?? '').localeCompare(
      a.properties.alerted_at ?? a.properties.reported_at ?? '',
    );
  const isStructural = (f: GeoFeature) =>
    f.properties.status === 'closed' &&
    !!f.properties.alert_cause &&
    STRUCTURAL_CAUSES.has(f.properties.alert_cause);
  const contam = alerts
    .filter((f) => f.properties.status === 'closed' && !isStructural(f))
    .sort(byWhen);
  const structural = alerts.filter(isStructural).sort(byWhen);
  const warnings = alerts
    .filter((f) => f.properties.status === 'warning')
    .sort(byWhen);
  return (
    [
      ['Contaminación', contam],
      [STRUCTURAL_SECTION, structural],
      ['Avisos', warnings],
    ] as AlertSection[]
  ).filter(([, fs]) => fs.length > 0);
}

export type SearchItem = {
  key: string;
  kind: 'beach' | 'outfall' | 'municipality';
  label: string;
  sub: string;
  feature?: GeoFeature;
  members?: GeoFeature[];
  center?: [number, number];
};

// Resultados del buscador: playas, vertidos y municipios que
// contienen la query (mínimo 2 caracteres, máximo 8 resultados)
export function searchMap(
  query: string,
  beachGroups: Map<string, MapBeachGroup>,
  outfalls: GeoFeature[],
  beaches: GeoFeature[],
): SearchItem[] {
  const q = searchNorm(query);
  if (q.length < 2) return [];
  const items: SearchItem[] = [];
  // Playas agrupadas como en el mapa: "troya" da UN resultado
  // (casa también por el nombre de cualquiera de sus PMs)
  for (const [key, g] of beachGroups) {
    const label = displayBeachName(beachBaseName(g.rep.properties.name));
    const hay = searchNorm(
      [label, ...g.members.map((m) => m.properties.name)].join(' '),
    );
    if (hay.includes(q)) {
      items.push({
        key: `b${key}`,
        kind: 'beach',
        label,
        sub:
          (g.rep.properties.municipality ?? 'Playa') +
          (g.members.length > 1 ? ` · ${g.members.length} zonas` : ''),
        feature: g.rep,
        members: g.members,
        center: g.center,
      });
    }
  }
  for (const f of outfalls) {
    if (searchNorm(f.properties.name ?? '').includes(q)) {
      items.push({
        key: `o${f.id}`,
        kind: 'outfall',
        label: displayBeachName(f.properties.name ?? ''),
        sub: 'Emisario',
        feature: f,
      });
    }
  }
  const munis = new Set(
    beaches
      .map((f) => f.properties.municipality)
      .filter((m): m is string => !!m),
  );
  for (const m of munis) {
    if (searchNorm(m).includes(q)) {
      const pts = beaches.filter((f) => f.properties.municipality === m);
      items.push({
        key: `m${m}`,
        kind: 'municipality',
        label: m,
        sub: 'Municipio',
        center: [
          pts.reduce((s, f) => s + f.geometry.coordinates[0], 0) / pts.length,
          pts.reduce((s, f) => s + f.geometry.coordinates[1], 0) / pts.length,
        ],
      });
    }
  }
  return items.slice(0, 8);
}

// Tests de la lógica pura de la lista de playas: agrupación
// PM→playa y orden por estado. Sin render — solo lib/beachGroups.

import { describe, expect, it } from '@jest/globals';

import type { BeachStats, GeoFeature } from '../lib/api';
import {
  buildGroups,
  groupKeyOf,
  pmNum,
  statusOf,
  worstStatusOf,
} from '../lib/beachGroups';

const beach = (
  id: number,
  name: string,
  props: Partial<GeoFeature['properties']> = {},
): GeoFeature => ({
  type: 'Feature',
  id,
  geometry: { type: 'Point', coordinates: [-16.5, 28.4] },
  properties: { name, ...props },
});

describe('agrupación PM → playa', () => {
  it('junta los PMs de la misma playa en un solo grupo', () => {
    const groups = buildGroups([
      beach(1, 'PLAYA GAVIOTAS (LAS) PM1'),
      beach(2, 'PLAYA GAVIOTAS (LAS) PM2'),
      beach(3, 'PLAYA BOBO (EL) PM1'),
    ]);
    expect(groups).toHaveLength(2);
    const gaviotas = groups.find((g) => g.name.includes('GAVIOTAS'));
    expect(gaviotas?.members.map((m) => m.id)).toEqual([1, 2]);
  });

  it('no junta playas con el mismo nombre en municipios distintos', () => {
    const a = beach(1, 'PLAYA CALETA DE NEGROS PM1', {
      municipality: 'Santa Cruz de Tenerife',
    });
    const b = beach(2, 'PLAYA CALETA DE NEGROS PM1', {
      municipality: 'Arona',
    });
    expect(groupKeyOf(a)).not.toBe(groupKeyOf(b));
    expect(buildGroups([a, b])).toHaveLength(2);
  });

  it('junta subdivisiones por romano (Troya I/II = un arenal)', () => {
    const groups = buildGroups([
      beach(1, 'PLAYA TROYA I (AMÉRICAS I) PM3'),
      beach(2, 'PLAYA TROYA II (AMÉRICAS II) PM1'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(2);
  });

  it('ordena los PMs dentro del grupo por número', () => {
    const groups = buildGroups([
      beach(1, 'PLAYA JARDÍN PM5'),
      beach(2, 'PLAYA JARDÍN PM1'),
      beach(3, 'PLAYA JARDÍN PM4'),
    ]);
    expect(groups[0].members.map((m) => pmNum(m.properties.name))).toEqual([
      1, 4, 5,
    ]);
  });
});

describe('statusOf / worstStatusOf', () => {
  it('OSM sin monitorizar es unmonitored salvo que tenga alerta', () => {
    const osm = beach(1, 'Playa de Benijo', { monitored: false });
    expect(statusOf(osm)).toBe('unmonitored');
    expect(
      statusOf(
        beach(1, 'Playa de Benijo', {
          monitored: false,
          status: 'closed',
          alert: true,
        }),
      ),
    ).toBe('closed');
  });

  it('el estado del grupo es el peor de sus miembros', () => {
    const g = buildGroups([
      beach(1, 'PLAYA X PM1', { status: 'open' }),
      beach(2, 'PLAYA X PM2', { status: 'closed' }),
      beach(3, 'PLAYA X PM3', { status: 'warning' }),
    ])[0];
    expect(worstStatusOf(g)).toBe('closed');
  });
});

describe('orden por estado', () => {
  const list = () => [
    beach(1, 'PLAYA ABIERTA', { status: 'open' }),
    beach(2, 'PLAYA CERRADA', { status: 'closed' }),
    beach(3, 'PLAYA SIN DATOS'),
    beach(4, 'PLAYA CON AVISO', { status: 'warning' }),
    beach(5, 'Cala OSM', { monitored: false }),
  ];

  it('cerrada > aviso > sin datos > apta > no monitorizada', () => {
    const names = buildGroups(list(), { sortMode: 'estado' }).map(
      (g) => g.name,
    );
    expect(names).toEqual([
      'PLAYA CERRADA',
      'PLAYA CON AVISO',
      'PLAYA SIN DATOS',
      'PLAYA ABIERTA',
      'Cala OSM',
    ]);
  });

  it('el filtro de estado casa con el peor estado del grupo', () => {
    const closed = buildGroups(list(), { statusFilter: 'closed' });
    expect(closed.map((g) => g.name)).toEqual(['PLAYA CERRADA']);
  });

  it('búsqueda por texto filtra por nombre', () => {
    const hit = buildGroups(list(), { query: 'cerrada' });
    expect(hit.map((g) => g.name)).toEqual(['PLAYA CERRADA']);
  });
});

describe('orden por cierres y calidad', () => {
  const statsOf = (s: Partial<BeachStats>): BeachStats => ({
    beach_id: 0,
    closures: 0,
    warnings: 0,
    closures_last_year: 0,
    bad_samples: 0,
    total_samples: 0,
    latest_evaluation: null,
    latest_sampled_at: null,
    ...s,
  });

  it('más cierres del último año primero', () => {
    const a = beach(1, 'PLAYA A');
    const b = beach(2, 'PLAYA B');
    const stats = new Map<number, BeachStats>([
      [1, statsOf({ beach_id: 1, closures_last_year: 1 })],
      [2, statsOf({ beach_id: 2, closures_last_year: 4 })],
    ]);
    const names = buildGroups([a, b], { sortMode: 'cierres', stats }).map(
      (g) => g.name,
    );
    expect(names).toEqual(['PLAYA B', 'PLAYA A']);
  });

  it('peor calidad primero (evaluación mala pesa más que el recuento)', () => {
    const a = beach(1, 'PLAYA PROHIBIDA');
    const b = beach(2, 'PLAYA APTA CON HISTORIAL');
    const stats = new Map<number, BeachStats>([
      [1, statsOf({ beach_id: 1, latest_evaluation: 'Prohibido' })],
      [
        2,
        statsOf({
          beach_id: 2,
          latest_evaluation: 'Apta',
          bad_samples: 9,
        }),
      ],
    ]);
    const names = buildGroups([a, b], { sortMode: 'calidad', stats }).map(
      (g) => g.name,
    );
    expect(names).toEqual(['PLAYA PROHIBIDA', 'PLAYA APTA CON HISTORIAL']);
  });
});

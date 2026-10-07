import { describe, expect, it } from '@jest/globals';

import type { BeachStats, GeoFeature, MunicipalityIncident } from '../lib/api';
import {
  baseName,
  buildMuniRows,
  durationDays,
  muniCauseCounts,
  rankColorOf,
  scoreOf,
  yearLineText,
  yearMuniCounts,
} from '../lib/muniStats';
import { colors } from '../lib/theme';

const beach = (
  id: number,
  name: string,
  municipality: string | null,
  props: Partial<GeoFeature['properties']> = {},
): GeoFeature => ({
  type: 'Feature',
  id,
  geometry: { type: 'Point', coordinates: [-16.5, 28.3] },
  properties: { name, municipality, monitored: true, ...props },
});

const stats = (beach_id: number, s: Partial<BeachStats>): BeachStats => ({
  beach_id,
  closures: 0,
  warnings: 0,
  closures_last_year: 0,
  bad_samples: 0,
  non_apta_samples: 0,
  contam_episodes: 0,
  total_samples: 0,
  latest_evaluation: null,
  latest_sampled_at: null,
  ...s,
});

const ep = (e: Partial<MunicipalityIncident>): MunicipalityIncident => ({
  id: 1,
  beach_id: 1,
  beach_name: 'PLAYA X',
  municipality: 'Arona',
  kind: 'closure',
  opened_at: '2026-07-01',
  closed_at: '2026-07-03',
  observations: null,
  ...e,
});

describe('baseName', () => {
  it('quita el sufijo de punto de muestreo', () => {
    expect(baseName('PLAYA JARDIN PM4')).toBe('PLAYA JARDIN');
    expect(baseName('Playa de Benijo')).toBe('Playa de Benijo');
  });
});

describe('buildMuniRows — ranking por municipio', () => {
  const beaches = [
    beach(1, 'PLAYA JARDIN PM1', 'Puerto de la Cruz', { status: 'closed' }),
    beach(2, 'PLAYA JARDIN PM4', 'Puerto de la Cruz', { status: 'open' }),
    beach(3, 'PLAYA MARTIÁNEZ PM3', 'Puerto de la Cruz', {
      status: 'warning',
    }),
    beach(4, 'Playa de Benijo', 'Santa Cruz de Tenerife', {
      monitored: false,
      status: 'closed',
    }),
    beach(5, 'PLAYA TERESITAS (LAS) PM1', 'Santa Cruz de Tenerife'),
    beach(6, 'Cala sin municipio', null, { monitored: false }),
  ];
  const st = new Map<number, BeachStats>([
    [1, stats(1, { closures: 2, warnings: 1, bad_samples: 3 })],
    [2, stats(2, { closures_last_year: 1 })],
    [4, stats(4, { closures: 9, reconstructed: 2 })],
    [5, stats(5, { bad_samples: 1 })],
  ]);
  const rows = buildMuniRows(beaches, st);
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));

  it('agrupa PMs de la misma playa y cuenta puntos de muestreo', () => {
    const p = byName['Puerto de la Cruz'];
    expect(p.beaches).toBe(2);
    expect(p.points).toBe(3);
    expect(p.closedNow).toBe(1);
    expect(p.warningNow).toBe(1);
    expect(p.incidents).toBe(3);
    expect(p.badSamples).toBe(3);
    expect(p.closuresLastYear).toBe(1);
  });

  it('una playa OSM cerrada cuenta como afectación y sus episodios reconstruidos como incidentes, pero no su histórico oficial', () => {
    const sc = byName['Santa Cruz de Tenerife'];
    expect(sc.closedNow).toBe(1);
    expect(sc.points).toBe(1);
    expect(sc.incidents).toBe(2);
    expect(sc.badSamples).toBe(1);
  });

  it('las playas sin municipio se agrupan aparte', () => {
    expect(byName['Sin municipio']).toMatchObject({
      municipality: null,
      beaches: 1,
      points: 0,
    });
  });

  it('ordena por severidad y desempata por nombre', () => {
    expect(rows.map((r) => r.name)).toEqual([
      'Puerto de la Cruz',
      'Santa Cruz de Tenerife',
      'Sin municipio',
    ]);
    expect(scoreOf(rows[0])).toBe(100 + 20 + 3 + 3);
  });

  it('el podio usa el color de severidad y el resto, neutro', () => {
    expect(rankColorOf(rows[0], 0)).toBe(colors.status.closed);
    expect(rankColorOf(rows[2], 2)).toBe(colors.status.open);
    expect(rankColorOf(rows[0], 3)).toBe('#8fa3ad');
  });
});

describe('yearMuniCounts', () => {
  it('cuenta cierres, avisos, activos y playas distintas por municipio', () => {
    const m = yearMuniCounts([
      ep({ beach_name: 'PLAYA JARDIN PM1', municipality: 'Puerto' }),
      ep({
        beach_name: 'PLAYA JARDIN PM1',
        municipality: 'Puerto',
        kind: 'warning',
        closed_at: null,
      }),
      ep({ municipality: null }),
    ]);
    const p = m.get('Puerto')!;
    expect(p).toMatchObject({ closures: 1, warnings: 1, active: 1 });
    expect(p.beaches.size).toBe(1);
    expect(m.get(null)?.closures).toBe(1);
  });
});

describe('muniCauseCounts', () => {
  const scope = [
    ep({ municipality: 'Arona', cause: 'Contaminación' }),
    ep({ municipality: 'Arona', cause: 'Desprendimientos' }),
    ep({ municipality: 'Adeje', cause: null }),
    ep({ municipality: 'Adeje', kind: 'warning', cause: null }),
  ];

  it('"all" no filtra el ranking', () => {
    expect(muniCauseCounts(scope, 'all').size).toBe(0);
  });

  it('"sin causa" cuenta solo cierres sin causa', () => {
    expect([...muniCauseCounts(scope, 'sin causa')]).toEqual([['Adeje', 1]]);
  });
});

describe('durationDays', () => {
  it('incluye el día de apertura y nunca baja de 1', () => {
    expect(durationDays(ep({}))).toBe(3);
    expect(
      durationDays(ep({ opened_at: '2026-07-01', closed_at: '2026-07-01' })),
    ).toBe(1);
  });
});

describe('yearLineText', () => {
  const live = [
    beach(1, 'A', 'Arona', { status: 'closed' }),
    beach(2, 'B', 'Arona', { status: 'open' }),
  ];
  const episodes = [
    ep({}),
    ep({ opened_at: '2025-08-01', closed_at: '2025-08-02' }),
    ep({ kind: 'warning' }),
  ];

  it('histórico: totales, año de inicio y activas ahora', () => {
    expect(yearLineText(episodes, live, 2026, false, [2026, 2025, 2023])).toBe(
      '2 cierres · 1 aviso desde 2023 · 1 activa ahora',
    );
  });

  it('sin episodios no hay línea', () => {
    expect(yearLineText([], live, 2026, false, [])).toBeNull();
  });

  it('modo-año: solo los cierres de ese año', () => {
    expect(yearLineText(episodes, live, 2025, true, [2026, 2025])).toBe(
      '2025 · 1 cierre',
    );
  });
});

import { describe, expect, it } from '@jest/globals';

import type { GeoFeature } from '../lib/api';
import {
  STRUCTURAL_SECTION,
  beachCategory,
  buildAlertSections,
  buildBeachGroups,
  outfallCategory,
  pmMembersOf,
  searchMap,
  toggleInSet,
} from '../lib/mapData';

let nextId = 1;
const feat = (
  name: string,
  props: Partial<GeoFeature['properties']> = {},
  coords: [number, number] = [-16.5, 28.3],
): GeoFeature => ({
  type: 'Feature',
  id: nextId++,
  geometry: { type: 'Point', coordinates: coords },
  properties: { name, municipality: 'Arona', ...props },
});

describe('beachCategory', () => {
  it('usa el estado de la playa monitorizada', () => {
    expect(beachCategory(feat('A', { status: 'closed' }))).toBe('closed');
    expect(beachCategory(feat('A', { status: 'open' }))).toBe('open');
  });

  it('agrupa desconocidas y OSM sin alerta como sin monitorizar', () => {
    expect(beachCategory(feat('A', { status: 'unknown' }))).toBe('unmonitored');
    expect(beachCategory(feat('A', {}))).toBe('unmonitored');
    expect(beachCategory(feat('A', { monitored: false, status: 'open' }))).toBe(
      'unmonitored',
    );
  });

  it('una OSM con alerta usa el estado de la alerta', () => {
    expect(
      beachCategory(
        feat('Benijo', { monitored: false, alert: true, status: 'closed' }),
      ),
    ).toBe('closed');
  });
});

describe('outfallCategory', () => {
  it('legal e illegal se conservan; el resto es "en trámite"', () => {
    expect(outfallCategory(feat('E', { status: 'legal' }))).toBe('legal');
    expect(outfallCategory(feat('E', { status: 'illegal' }))).toBe('illegal');
    expect(outfallCategory(feat('E', { status: 'pending' }))).toBe('unknown');
    expect(outfallCategory(feat('E', {}))).toBe('unknown');
  });
});

describe('toggleInSet', () => {
  it('añade y quita sin mutar el original', () => {
    const s = new Set(['a']);
    expect([...toggleInSet(s, 'b')].sort()).toEqual(['a', 'b']);
    expect([...toggleInSet(s, 'a')]).toEqual([]);
    expect([...s]).toEqual(['a']);
  });
});

describe('pmMembersOf', () => {
  it('solo devuelve grupos con >=2 puntos etiquetados', () => {
    const pms = [feat('LAS VISTAS PM1'), feat('LAS VISTAS PM2')];
    expect(pmMembersOf(pms)).toEqual(pms);
    expect(pmMembersOf([feat('LA HORNILLA'), feat('LA HORNILLA')])).toBe(
      undefined,
    );
    expect(pmMembersOf(undefined)).toBe(undefined);
  });
});

describe('buildBeachGroups', () => {
  it('un grupo por playa con centroide y PM peor parado', () => {
    const pm2 = feat('LAS VISTAS PM2', { status: 'closed' }, [-16.7, 28.0]);
    const pm1 = feat('LAS VISTAS PM1', { status: 'open' }, [-16.6, 28.2]);
    const other = feat('EL CAMISÓN', { status: 'open' }, [-16.5, 28.1]);
    const groups = buildBeachGroups([pm2, pm1, other]);
    expect(groups.size).toBe(2);
    const vistas = [...groups.values()].find((g) => g.members.length === 2)!;
    // Orden estable PM1 < PM2 y representante = el cerrado
    expect(vistas.members.map((m) => m.properties.name)).toEqual([
      'LAS VISTAS PM1',
      'LAS VISTAS PM2',
    ]);
    expect(vistas.rep).toBe(pm2);
    expect(vistas.center[0]).toBeCloseTo(-16.65);
    expect(vistas.center[1]).toBeCloseTo(28.1);
  });

  it('no agrupa homónimas de municipios distintos', () => {
    const groups = buildBeachGroups([
      feat('EL CABEZO', { municipality: 'Arona' }),
      feat('EL CABEZO', { municipality: 'Granadilla de Abona' }),
    ]);
    expect(groups.size).toBe(2);
  });
});

describe('buildAlertSections', () => {
  it('separa contaminación, estructural y avisos, de más reciente a más antigua', () => {
    const contam = feat('A', {
      status: 'closed',
      alert_cause: 'Contaminación',
      alerted_at: '2026-09-01',
    });
    const obrasOld = feat('B', {
      status: 'closed',
      alert_cause: 'Obras',
      alerted_at: '2025-01-01',
    });
    const desprNew = feat('C', {
      status: 'closed',
      alert_cause: 'Desprendimientos',
      alerted_at: '2026-08-01',
    });
    const aviso = feat('D', { status: 'warning', reported_at: '2026-09-02' });
    const sections = buildAlertSections([obrasOld, aviso, contam, desprNew]);
    expect(sections.map(([label]) => label)).toEqual([
      'Contaminación',
      STRUCTURAL_SECTION,
      'Avisos',
    ]);
    expect(sections[1][1]).toEqual([desprNew, obrasOld]);
  });

  it('un cierre sin causa cuenta como contaminación y no hay secciones vacías', () => {
    const sinCausa = feat('A', { status: 'closed' });
    expect(buildAlertSections([sinCausa])).toEqual([
      ['Contaminación', [sinCausa]],
    ]);
    expect(buildAlertSections([])).toEqual([]);
  });
});

describe('searchMap', () => {
  const beaches = [
    feat('PLAYA DE TROYA I', { municipality: 'Adeje' }, [-16.73, 28.08]),
    feat('PLAYA DE TROYA II', { municipality: 'Adeje' }, [-16.75, 28.1]),
    feat('LAS TERESITAS', {
      municipality: 'Santa Cruz de Tenerife',
    }),
  ];
  const outfalls = [feat('Emisario Troya', {}, [-16.7, 28.0])];
  const groups = buildBeachGroups(beaches);

  it('exige al menos 2 caracteres', () => {
    expect(searchMap('t', groups, outfalls, beaches)).toEqual([]);
  });

  it('una playa multi-PM da un solo resultado, sin acentos ni mayúsculas', () => {
    const res = searchMap('TRÓYA', groups, outfalls, beaches);
    expect(res.map((r) => r.kind)).toEqual(['beach', 'outfall']);
    expect(res[0].sub).toBe('Adeje · 2 PMs');
    expect(res[0].members).toHaveLength(2);
  });

  it('municipio con centro en la media de sus playas', () => {
    const res = searchMap('adeje', groups, outfalls, beaches);
    const muni = res.find((r) => r.kind === 'municipality')!;
    expect(muni.label).toBe('Adeje');
    expect(muni.center![0]).toBeCloseTo(-16.74);
    expect(muni.center![1]).toBeCloseTo(28.09);
  });

  it('corta a 8 resultados', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      feat(`CALA ${String.fromCharCode(65 + i)}`, { municipality: `M${i}` }),
    );
    expect(searchMap('cala', buildBeachGroups(many), [], many)).toHaveLength(8);
  });
});

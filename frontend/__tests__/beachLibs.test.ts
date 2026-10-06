import { describe, expect, it } from '@jest/globals';

import type { BeachIncident, BeachMeasurement, BeachNews } from '../lib/api';
import { closuresInYears, isClosure, isUnclassified } from '../lib/incidents';
import { groupNewsItems } from '../lib/news';
import {
  CHART_H,
  barH,
  buildChartSeries,
  classifyValue,
  numValue,
  samplingNote,
} from '../lib/quality';

let nid = 1;
const news = (
  event_type: string | null,
  cause: string | null,
  published_at = '2026-08-01T10:00:00Z',
): BeachNews => ({
  id: nid++,
  beach_id: 1,
  title: `Titular ${nid}`,
  url: 'https://example.com',
  source: 'Medio',
  published_at,
  event_type,
  cause,
});

const inc = (props: Partial<BeachIncident>): BeachIncident => ({
  id: nid++,
  beach_id: 1,
  opened_at: '2026-07-01',
  closed_at: null,
  observations: null,
  source_url: null,
  ...props,
});

const sample = (
  sampled_at: string,
  ecoli: string | null = '10',
  enterococci: string | null = '10',
): BeachMeasurement => ({
  id: nid++,
  beach_id: 1,
  sampled_at,
  ecoli,
  enterococci,
  evaluation: null,
  source_url: null,
});

describe('groupNewsItems', () => {
  it('ordena por fase narrativa y combina enterococos + E. coli', () => {
    const groups = groupNewsItems([
      news('reopening', null),
      news('closure', 'niveles elevados de enterococos'),
      news('closure', 'presencia de E. coli'),
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      'Cierre · niveles elevados de enterococos y E. coli',
      'Reapertura · mejora la calidad del agua',
    ]);
    expect(groups[0].items).toHaveLength(2);
  });

  it('sin tema catalogado usa la causa cruda, nunca una no-causa', () => {
    expect(groupNewsItems([news('warning', 'medusas')])[0].label).toBe(
      'Aviso · medusas',
    );
    expect(groupNewsItems([news('closure', 'oleaje')])[0].label).toBe('Cierre');
    expect(groupNewsItems([news(null, null)])[0].label).toBe('Noticia');
  });
});

describe('incidents', () => {
  it('isClosure: prohibido o evento reconstruido', () => {
    expect(isClosure(inc({ observations: 'Baño prohibido' }))).toBe(true);
    expect(isClosure(inc({ via: 'press' }))).toBe(true);
    expect(isClosure(inc({ via: 'measurement' }))).toBe(true);
    expect(isClosure(inc({ observations: 'Recomendación' }))).toBe(false);
  });

  it('isUnclassified detecta "Sin Calificar"', () => {
    expect(isUnclassified(inc({ observations: 'Sin  Calificar' }))).toBe(true);
    expect(isUnclassified(inc({ observations: 'Prohibido' }))).toBe(false);
  });

  it('closuresInYears cuenta solo cierres dentro de la ventana', () => {
    const now = Date.parse('2026-10-01');
    const list = [
      inc({ via: 'press', opened_at: '2026-09-01' }),
      inc({ via: 'press', opened_at: '2023-01-01' }),
      inc({ observations: 'Recomendación', opened_at: '2026-09-01' }),
    ];
    expect(closuresInYears(list, 1, now)).toBe(1);
    expect(closuresInYears(list, 5, now)).toBe(2);
  });
});

describe('quality', () => {
  it('classifyValue frente a los umbrales RD 1341/2007', () => {
    expect(classifyValue('ecoli', '250')).toMatchObject({
      cls: 'Excelente',
      pct: 50,
    });
    expect(classifyValue('ecoli', '500')?.cls).toBe('Buena');
    expect(classifyValue('enterococci', '201')?.cls).toBe('Insuficiente');
    expect(classifyValue('ecoli', null)).toBe(null);
  });

  it('numValue quita el prefijo sin tocar la unidad', () => {
    expect(numValue('<10')).toBe(10);
    expect(numValue('>24000 UFC/100 mL')).toBe(24000);
    expect(numValue('—')).toBe(null);
  });

  it('barH: escala log con mínimo de 3 px', () => {
    expect(barH(0)).toBe(3);
    expect(barH(100000)).toBe(CHART_H);
  });

  it('buildChartSeries: más antigua primero y etiqueta de año', () => {
    // La API devuelve las muestras de más reciente a más antigua
    const series = buildChartSeries(
      [
        sample('2025-06-01', '20'),
        sample('2024-08-01', '—'),
        sample('2024-07-01', '<10'),
        sample('2024-06-01', '30'),
      ],
      'ecoli',
    );
    expect(series).toEqual([
      { date: '2024-06-01', value: 30, yearLabel: '2024', yearSpan: 2 },
      { date: '2024-07-01', value: 10, yearLabel: null, yearSpan: 0 },
      { date: '2025-06-01', value: 20, yearLabel: '2025', yearSpan: 1 },
    ]);
    expect(buildChartSeries(null, 'ecoli')).toEqual([]);
  });

  it('samplingNote: hueco en meses que sí se muestrean = anomalía', () => {
    const dates = [
      ...Array.from(
        { length: 12 },
        (_, i) => `2023-${String(i + 1).padStart(2, '0')}-15`,
      ),
      '2024-07-15',
    ];
    const note = samplingNote(
      dates.map((d) => sample(d)),
      '2024-08-01',
    );
    expect(note?.anomalous).toBe(true);
    expect(note?.text).toMatch(/^Anomalía: sin muestras entre /);
  });

  it('samplingNote: parada estacional = calendario de Sanidad', () => {
    const dates = ['06', '07', '08', '09'].flatMap((m) => [
      `2024-${m}-15`,
      `2025-${m}-15`,
    ]);
    const note = samplingNote(
      dates.map((d) => sample(d)),
      '2025-09-20',
    );
    expect(note?.anomalous).toBe(false);
    expect(note?.text).toMatch(/^Sanidad deja de muestrearla cada año entre /);
    expect(samplingNote([sample('2025-06-01')], '2025-06-02')).toBe(null);
  });
});

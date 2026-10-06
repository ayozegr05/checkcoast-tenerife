import { describe, expect, it } from '@jest/globals';

import { foldCount, foldSummary } from '../lib/alertFold';

const now = new Date('2026-10-06T09:00:00Z');
const old = (n: number) =>
  Array.from({ length: n }, () => ({ alerted_at: '2025-01-01' }));

describe('foldCount', () => {
  it('no pliega con 4 o menos', () => {
    expect(foldCount(old(4), now)).toBe(4);
    expect(foldCount(old(2), now)).toBe(2);
  });

  it('muestra 3 con 8 antiguos', () => {
    expect(foldCount(old(8), now)).toBe(3);
  });

  it('no deja una sola oculta', () => {
    expect(foldCount(old(5), now)).toBe(3);
    const items = [
      { alerted_at: '2026-10-05' },
      { alerted_at: '2026-10-04' },
      { alerted_at: '2026-10-02' },
      { alerted_at: '2026-10-01' },
      { alerted_at: '2025-01-01' },
    ];
    expect(foldCount(items, now)).toBe(5);
  });

  it('los recientes (≤7 d) siempre visibles', () => {
    const items = [
      { alerted_at: '2026-10-05' },
      { alerted_at: '2026-10-04' },
      { alerted_at: '2026-10-02' },
      { alerted_at: '2026-10-01' },
      ...old(4),
    ];
    expect(foldCount(items, now)).toBe(4);
  });

  it('usa reported_at si no hay alerted_at', () => {
    const items = [
      ...Array.from({ length: 4 }, () => ({ reported_at: '2026-10-03' })),
      ...old(4),
    ];
    expect(foldCount(items, now)).toBe(4);
  });
});

describe('foldSummary', () => {
  it('municipios únicos con elipsis', () => {
    expect(foldSummary(['Garachico', 'La Guancha', 'Garachico'])).toBe(
      'Garachico, La Guancha',
    );
    expect(foldSummary(['A', 'B', 'C', null])).toBe('A, B…');
  });
});

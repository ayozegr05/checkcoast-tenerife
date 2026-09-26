import { describe, expect, it } from '@jest/globals';

import type { MunicipalityIncident } from '../lib/api';
import { causeBreakdown, seasonEpisodes } from '../lib/episodes';

const ep = (
  e: Partial<MunicipalityIncident>,
): MunicipalityIncident => ({
  id: 1,
  beach_id: 1,
  beach_name: 'PLAYA X',
  municipality: 'Santa Cruz',
  kind: 'closure',
  opened_at: '2026-07-01',
  closed_at: '2026-07-03',
  observations: null,
  ...e,
});

describe('seasonEpisodes — filtro por solape con el verano', () => {
  it('episodio nacido dentro de jun-sep cuenta', () => {
    expect(
      seasonEpisodes([ep({})], 2026),
    ).toHaveLength(1);
  });

  it('episodio abierto de antes que sigue en verano cuenta (Benijo)', () => {
    expect(
      seasonEpisodes(
        [ep({ opened_at: '2024-07-01', closed_at: null })],
        2026,
      ),
    ).toHaveLength(1);
  });

  it('episodio cerrado en primavera no cuenta en el verano', () => {
    expect(
      seasonEpisodes(
        [ep({ opened_at: '2026-02-27', closed_at: '2026-03-01' })],
        2026,
      ),
    ).toHaveLength(0);
  });

  it('episodio abierto en febrero y aún abierto sí cuenta', () => {
    expect(
      seasonEpisodes(
        [ep({ opened_at: '2026-02-27', closed_at: null })],
        2026,
      ),
    ).toHaveLength(1);
  });

  it('episodio que cerró a mediados de verano cuenta', () => {
    expect(
      seasonEpisodes(
        [ep({ opened_at: '2026-05-20', closed_at: '2026-07-02' })],
        2026,
      ),
    ).toHaveLength(1);
  });
});

describe('causeBreakdown — desglose de causas del año', () => {
  it('cuenta por categoría, más frecuente primero', () => {
    expect(
      causeBreakdown([
        ep({ cause: 'Contaminación' }),
        ep({ cause: 'Contaminación' }),
        ep({ cause: 'Desprendimientos' }),
      ]),
    ).toBe('2 contaminación · 1 desprendimientos');
  });

  it('episodios sin causa se agrupan como "sin causa"', () => {
    expect(
      causeBreakdown([
        ep({ cause: 'Contaminación' }),
        ep({ cause: null }),
      ]),
    ).toBe('1 contaminación · 1 sin causa');
  });
});

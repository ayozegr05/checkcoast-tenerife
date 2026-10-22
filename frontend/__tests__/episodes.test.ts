import { describe, expect, it } from '@jest/globals';

import type { MunicipalityIncident } from '../lib/api';
import {
  closuresThisYear,
  episodeYears,
  latestEpisodeYear,
  recentlyResolved,
  seasonEpisodes,
  yearEpisodes,
} from '../lib/episodes';

const ep = (e: Partial<MunicipalityIncident>): MunicipalityIncident => ({
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
    expect(seasonEpisodes([ep({})], 2026)).toHaveLength(1);
  });

  it('episodio abierto de antes que sigue en verano cuenta (Benijo)', () => {
    expect(
      seasonEpisodes([ep({ opened_at: '2024-07-01', closed_at: null })], 2026),
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
      seasonEpisodes([ep({ opened_at: '2026-02-27', closed_at: null })], 2026),
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

describe('yearEpisodes — solape con el año natural', () => {
  it('episodio del año cuenta', () => {
    expect(yearEpisodes([ep({})], 2026)).toHaveLength(1);
  });

  it('episodio abierto de un año anterior sigue contando', () => {
    expect(
      yearEpisodes([ep({ opened_at: '2024-07-01', closed_at: null })], 2026),
    ).toHaveLength(1);
  });

  it('episodio cerrado el año anterior no cuenta', () => {
    expect(
      yearEpisodes(
        [ep({ opened_at: '2025-11-01', closed_at: '2025-12-20' })],
        2026,
      ),
    ).toHaveLength(0);
  });
});

describe('closuresThisYear — cabecera del banner', () => {
  it('cuenta por solape igual que la vista Este año', () => {
    expect(
      closuresThisYear(
        [
          ep({ opened_at: '2026-07-01', closed_at: '2026-07-03' }),
          ep({ opened_at: '2024-07-01', closed_at: null }), // Benijo
          ep({ opened_at: '2025-09-15', closed_at: '2026-04-13' }), // Pris
        ],
        2026,
      ),
    ).toHaveLength(3);
  });

  it('los avisos no cuentan como cierres', () => {
    expect(closuresThisYear([ep({ kind: 'warning' })], 2026)).toHaveLength(0);
  });
});

describe('episodeYears — años con datos para el selector', () => {
  it('del año actual al más viejo con episodios', () => {
    const cur = new Date().getFullYear();
    expect(
      episodeYears([ep({ opened_at: '2024-07-01', closed_at: null })]),
    ).toEqual(cur === 2026 ? [2026, 2025, 2024] : expect.anything());
  });
});

describe('latestEpisodeYear — dónde abre el ranking', () => {
  const cur = new Date().getFullYear();

  it('el año en curso si tiene episodios', () => {
    expect(
      latestEpisodeYear([
        ep({ opened_at: `${cur}-07-01`, closed_at: `${cur}-07-02` }),
      ]),
    ).toBe(cur);
  });

  it('si el año en curso está vacío, el último año con datos', () => {
    expect(
      latestEpisodeYear([
        ep({ opened_at: `${cur - 3}-07-01`, closed_at: `${cur - 3}-07-02` }),
        ep({ opened_at: `${cur - 2}-07-01`, closed_at: `${cur - 2}-07-02` }),
      ]),
    ).toBe(cur - 2);
  });

  it('un episodio abierto toca hasta el año en curso', () => {
    expect(
      latestEpisodeYear([
        ep({ opened_at: `${cur - 2}-07-01`, closed_at: null }),
      ]),
    ).toBe(cur);
  });

  it('sin episodios devuelve null', () => {
    expect(latestEpisodeYear([])).toBeNull();
  });
});

describe('recentlyResolved — orden por reapertura', () => {
  it('la reapertura más reciente va primero, no la apertura', () => {
    const viejo = ep({
      beach_name: 'VIEJO',
      opened_at: '2026-08-01',
      closed_at: '2026-10-01',
    });
    const nuevo = ep({
      beach_name: 'NUEVO',
      opened_at: '2026-10-10',
      closed_at: '2026-10-15',
    });
    // Llegan ordenados por apertura desc (como el endpoint): el
    // episodio nuevo va primero pero su reapertura es también la
    // más reciente — el sort por closed_at lo mantiene arriba
    expect(
      recentlyResolved([viejo, nuevo], 60, new Date('2026-10-20')).map(
        (e) => e.beach_name,
      ),
    ).toEqual(['NUEVO', 'VIEJO']);
    // Y el caso real del bug: episodio viejo llega primero por
    // opened_at pero su reapertura es más antigua → baja
    expect(
      recentlyResolved([nuevo, viejo], 60, new Date('2026-10-20')).map(
        (e) => e.beach_name,
      ),
    ).toEqual(['NUEVO', 'VIEJO']);
  });

  it('un fin estimado (última mención) no cuenta como reapertura', () => {
    const est = ep({
      opened_at: '2026-10-10',
      closed_at: '2026-10-15',
      end_estimated: true,
    });
    expect(recentlyResolved([est], 30, new Date('2026-10-20'))).toHaveLength(0);
  });
});

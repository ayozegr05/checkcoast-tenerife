import { describe, expect, it } from '@jest/globals';

import { alertLine } from '../lib/alertLine';

describe('alertLine — desglose de alertas por causa', () => {
  it('un solo cierre sin causa', () => {
    expect(alertLine([null], 0)).toBe('1 cerrada');
  });

  it('desglosa por causa en vez de "N cerradas"', () => {
    expect(
      alertLine(['Contaminación', 'Contaminación', 'Desprendimientos'], 0),
    ).toBe('2 contaminación · 1 desprendimientos');
  });

  it('mezcla causas conocidas, cierres sin causa y avisos', () => {
    expect(
      alertLine(['Contaminación', null, 'Desprendimientos'], 1),
    ).toBe('1 contaminación · 1 desprendimientos · 1 cerrada · 1 aviso');
  });

  it('solo avisos', () => {
    expect(alertLine([], 2)).toBe('2 avisos');
  });

  it('empate de causas: orden alfabético determinista', () => {
    expect(alertLine(['Obras', 'Contaminación'], 0)).toBe(
      '1 contaminación · 1 obras',
    );
  });
});

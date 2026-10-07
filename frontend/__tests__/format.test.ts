// Tests de lib/format: nombres del censo MITECO → grafía natural.

import { describe, expect, it } from '@jest/globals';

import {
  beachBaseName,
  beachPointLabel,
  displayBeachName,
  fmtDate,
  fmtDistance,
} from '../lib/format';

describe('displayBeachName', () => {
  it('mueve el artículo en paréntesis a forma natural', () => {
    expect(displayBeachName('PLAYA GAVIOTAS (LAS)')).toBe(
      'Playa de las Gaviotas',
    );
    expect(displayBeachName('PLAYA BOBO (EL)')).toBe('Playa del Bobo');
  });

  it('no toca paréntesis que no son artículos', () => {
    expect(displayBeachName('PLAYA ABADES (LOS ABRIGUITOS)')).toBe(
      'Playa Abades (Los Abriguitos)',
    );
  });

  it('respeta romanos y restaura acentos conocidos', () => {
    expect(displayBeachName('PLAYA TROYA II')).toBe('Playa Troya II');
    expect(displayBeachName('PLAYA MEDANO (EL)')).toBe('Playa del Médano');
  });
});

describe('beachBaseName / beachPointLabel', () => {
  it('quita el sufijo PM y el romano de subdivisión', () => {
    expect(beachBaseName('PLAYA TROYA I (AMÉRICAS I) PM3')).toBe(
      'PLAYA TROYA (AMÉRICAS)',
    );
    expect(beachBaseName('PLAYA JARDÍN PM5')).toBe('PLAYA JARDÍN');
  });

  it('etiqueta el punto de muestreo', () => {
    expect(beachPointLabel('PLAYA TROYA II (AMÉRICAS II) PM3')).toBe(
      'II · PM3',
    );
    expect(beachPointLabel('PLAYA JARDÍN PM5')).toBe('PM5');
    expect(beachPointLabel('Playa de Benijo')).toBeNull();
  });
});

describe('fmtDate', () => {
  it('formatea ISO a dd/mm/aaaa', () => {
    expect(fmtDate('2026-09-14')).toBe('14/09/2026');
  });
});

describe('fmtDistance', () => {
  it('metros bajo el km, km con decimal a partir de ahí', () => {
    expect(fmtDistance(300)).toBe('300 m');
    expect(fmtDistance(999)).toBe('999 m');
    expect(fmtDistance(1500)).toBe('1.5 km');
  });
});

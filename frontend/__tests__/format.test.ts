// Tests de lib/format: nombres del censo MITECO → grafía natural.

import { describe, expect, it } from '@jest/globals';

import {
  beachBaseName,
  beachPointLabel,
  displayBeachName,
  fmtDate,
  fmtDistance,
  fmtSpan,
  shortOutfallName,
  staleNewsNote,
} from '../lib/format';

describe('staleNewsNote — cierre vigente sin noticias recientes', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  it('vigente con última noticia >6 meses: lo avisa', () => {
    expect(staleNewsNote(null, '2014-01-30', now)).toBe(
      'sin noticias desde ene 2014',
    );
  });
  it('noticia reciente o episodio resuelto: nada', () => {
    expect(staleNewsNote(null, '2026-10-15', now)).toBeNull();
    expect(staleNewsNote('2014-02-01', '2014-01-30', now)).toBeNull();
  });
});

describe('displayBeachName — guion compuesto', () => {
  it('pega el guion con espacios sueltos del censo', () => {
    expect(displayBeachName('PLAYA VALLESECO- EL BLOQUE')).toBe(
      'Playa Valleseco-El Bloque',
    );
  });
});

describe('fmtSpan — rango corto de episodio', () => {
  it('no repite el año que el contexto ya dice', () => {
    expect(fmtSpan('2026-09-03', '2026-10-09', 2026)).toBe('3 sep → 9 oct');
  });
  it('año una vez al final si el contexto no lo da', () => {
    expect(fmtSpan('2025-07-01', '2025-07-03', null)).toBe(
      '1 jul → 3 jul 2025',
    );
  });
  it('cruza de año: año en los dos extremos', () => {
    expect(fmtSpan('2026-12-28', '2027-01-03', 2026)).toBe(
      '28 dic 2026 → 3 ene 2027',
    );
  });
  it('abierto: "desde el", con año si es de otro año', () => {
    expect(fmtSpan('2024-07-08', null, 2026)).toBe('desde el 8 jul 2024');
    expect(fmtSpan('2026-08-03', null, 2026)).toBe('desde el 3 ago');
  });
});

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

  it('restaura las tildes que el censo omite', () => {
    expect(displayBeachName('PLAYA JARDIN')).toBe('Playa Jardín');
    expect(displayBeachName('PLAYA PORIS DE ABONA')).toBe(
      'Playa Porís de Abona',
    );
    expect(displayBeachName('Playa Diego Hernandez')).toBe(
      'Playa Diego Hernández',
    );
    expect(displayBeachName('Charco El Romantico')).toBe('Charco El Romántico');
  });

  it('usa el nombre común curado para denominaciones del censo', () => {
    expect(displayBeachName('PLAYA GUIOS-LOS GIGANTES (ARGEL) PM3')).toBe(
      'Playa de los Guíos',
    );
    expect(displayBeachName('PLAYA GUIOS-LOS GIGANTES (ARGEL)')).toBe(
      'Playa de los Guíos',
    );
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

describe('shortOutfallName', () => {
  it('recorta la comarca del censo ("Valle de La Orotava" → "La Orotava")', () => {
    expect(
      shortOutfallName(
        'Emisario Submarino de Punta Brava - Valle de La Orotava',
      ),
    ).toBe('Emisario Submarino de Punta Brava - La Orotava');
  });

  it('Palm-Mar se muestra como lo dice la gente: El Palmar', () => {
    expect(shortOutfallName('Aliviadero EBAR Palm-Mar')).toBe(
      'Aliviadero EBAR El Palmar',
    );
    expect(shortOutfallName('Conducción de desagüe de Palm-Mar')).toBe(
      'Conducción de desagüe de El Palmar',
    );
  });
});

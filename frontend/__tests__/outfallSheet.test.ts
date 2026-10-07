// Tests de lib/outfallSheet: texto de la ficha de emisario a partir
// de los datos crudos del censo de vertidos.

import { describe, expect, it } from '@jest/globals';

import {
  conduitSegs,
  natureParts,
  nearbyUniqueBeaches,
  operationText,
  originLabel,
  protectedAreaName,
  protectedAreaNote,
  zoneText,
} from '../lib/outfallSheet';

describe('originLabel', () => {
  it('traduce las siglas del censo a lenguaje de ficha', () => {
    expect(originLabel('EDAR Valle de Güímar')).toBe('Depuradora');
    expect(originLabel('EBAR Callao Salvaje')).toBe(
      'Bombeo de aguas residuales',
    );
    expect(originLabel('EDAM Adeje')).toBe('Desaladora');
  });

  it('combina instalaciones con "+" sin repetir el tipo', () => {
    expect(originLabel('EDAR + EDAM Adeje Arona')).toBe(
      'Depuradora + desaladora',
    );
    expect(originLabel('EDAR A + EDAR B')).toBe('Depuradora');
  });

  it('deja pasar lo que no reconoce', () => {
    expect(originLabel('Ayuntamiento de X')).toBe('Ayuntamiento de X');
  });
});

describe('protectedAreaName', () => {
  it('recorta los identificadores de registro', () => {
    expect(
      protectedAreaName(
        'ZEC Franja marina Teno - Rasca. nº ZEC 103_TF. Ref. ES7020017',
      ),
    ).toBe('ZEC Franja marina Teno - Rasca');
  });
});

describe('protectedAreaNote', () => {
  it('anota solo las ZEC conocidas', () => {
    expect(protectedAreaNote('ZEC Franja marina Teno - Rasca')).toContain(
      'calderones',
    );
    expect(protectedAreaNote('ZEC Sebadales de Playa San Juan')).toContain(
      'sebada',
    );
    expect(protectedAreaNote('Otra zona')).toBe('');
  });
});

describe('zoneText', () => {
  it('limpia el sujeto redundante de frases completas', () => {
    expect(zoneText('El emisario submarino arranca en el muro.')).toBe(
      'Arranca en el muro.',
    );
  });

  it('convierte fragmentos en frase con género del primer sustantivo', () => {
    expect(zoneText('Escollera de protección.')).toBe(
      'El punto de vertido está en la escollera de protección.',
    );
    expect(zoneText('Paseo marítimo de Playa San Juan')).toBe(
      'El punto de vertido está en el paseo marítimo de Playa San Juan.',
    );
  });

  it('respeta los que ya empiezan por "en" sin mayúscula a media frase', () => {
    expect(zoneText('En el lado oeste del puerto')).toBe(
      'El punto de vertido está en el lado oeste del puerto.',
    );
  });
});

describe('conduitSegs', () => {
  it('narra tipo + orilla + profundidad con los números marcados', () => {
    const segs = conduitSegs('emisario submarino', 646, null, -24)!;
    expect(segs.map((s) => s.t).join('')).toBe(
      'Emisario submarino que vierte a 646 m de la orilla y a 24 m de profundidad.',
    );
    expect(segs.filter((s) => s.b).map((s) => s.t)).toEqual(['646 m', '24 m']);
  });

  it('profundidad >= 0: vertido en superficie', () => {
    const segs = conduitSegs(null, 100, null, 0)!;
    expect(segs.map((s) => s.t).join('')).toContain('a ras de mar');
  });

  it('sin datos no dice nada', () => {
    expect(conduitSegs(null, null, null, null)).toBeNull();
  });
});

describe('operationText', () => {
  it('activo + habitual vs. activo + emergencia', () => {
    expect(operationText(true, 'Habitual')).toContain('vierte de forma');
    expect(operationText(true, 'De excedencia-emergencia')).toContain(
      'solo debería verter',
    );
  });

  it('sin estado pero con régimen: describe el diseño', () => {
    expect(operationText(null, 'Habitual')).toBe(
      'Pensado para vertido habitual.',
    );
  });

  it('sin nada: null', () => {
    expect(operationText(undefined, undefined)).toBeNull();
  });
});

describe('natureParts', () => {
  it('residual urbana con EDAR → Depuradora sin paréntesis', () => {
    const parts = natureParts('Residual urbana', 'EDAR X', null, null);
    expect(parts).toHaveLength(1);
    expect(parts[0].label).toBe('Depuradora');
    expect(parts[0].note).toContain('tratamiento');
  });

  it('pretratamiento detectado en la descripción → no es depuradora', () => {
    const parts = natureParts(
      'Residual urbana',
      null,
      null,
      'procede de la estación de pretratamiento de Punta Blanca',
    );
    expect(parts[0].label).toBe('Estación de pretratamiento');
    expect(parts[0].note).toContain('sin depurar');
  });

  it('salmuera somera añade el aviso de la capa salada', () => {
    const [part] = natureParts('Salmuera', 'EDAM X', -5, null);
    expect(part.label).toBe('Desaladora');
    expect(part.note).toContain('solo 5 m de profundidad');
  });

  it('multi-sustancia: la etiqueta nombra cada parte', () => {
    const parts = natureParts(
      'Residual urbana y salmuera',
      'EDAR X',
      null,
      null,
    );
    expect(parts[0].label).toBe('Depuradora (aguas fecales y domésticas)');
    expect(parts[0].colon).toBe(true);
  });
});

describe('nearbyUniqueBeaches', () => {
  const row = (id: number, name: string) => ({
    outfall_id: 1,
    beach_id: id,
    beach_name: name,
    municipality: null,
    distance_m: id * 100,
  });

  it('deduplica PMs de la misma playa conservando la primera', () => {
    expect(
      nearbyUniqueBeaches([
        row(1, 'El Porís PM1'),
        row(2, 'El Porís PM2'),
        row(3, 'La Jaquita'),
      ]).map((r) => r.beach_id),
    ).toEqual([1, 3]);
  });
});

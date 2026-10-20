// Tests de lib/outfallSheet: texto de la ficha de emisario a partir
// de los datos crudos del censo de vertidos.

import { describe, expect, it } from '@jest/globals';

import {
  conduitSegs,
  natureParts,
  nearbyUniqueBeaches,
  operationText,
  originLabel,
  outfallEpisodeBeachLine,
  outfallEpisodesSummary,
  outfallInfraSummary,
  outfallNewsMeta,
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

describe('outfallNewsMeta (Hito 11.2)', () => {
  it('junta medio · fecha · playa casada', () => {
    expect(
      outfallNewsMeta({
        id: 1,
        beach_id: 2,
        title: 'Rotura del emisario',
        url: 'https://x.test/a',
        source: 'El Día',
        published_at: '2026-10-09T12:00:00Z',
        event_type: 'infra',
        cause: 'rotura',
        beach_name: 'PLAYA JARDIN PM1',
        infra_cause: null,
      }),
    ).toBe('El Día · 09/10/2026 · Playa Jardín');
  });

  it('añade el hecho de infra del cuerpo cuando lo hay', () => {
    expect(
      outfallNewsMeta({
        id: 1,
        beach_id: null,
        title: 'Cierran la playa',
        url: 'https://x.test/c',
        source: 'El Día',
        published_at: '2026-10-09T12:00:00Z',
        event_type: 'closure',
        cause: 'contaminación fecal',
        beach_name: null,
        infra_cause: 'fisura en la conducción',
      }),
    ).toBe('El Día · 09/10/2026 · fisura en la conducción');
  });

  it('tolera campos ausentes', () => {
    expect(
      outfallNewsMeta({
        id: 1,
        beach_id: 2,
        title: 'Vertido',
        url: 'https://x.test/b',
        source: null,
        published_at: null,
        event_type: 'infra',
        cause: null,
        beach_name: null,
        infra_cause: null,
      }),
    ).toBe('');
  });
});

describe('outfallInfraSummary (resumen C)', () => {
  it('junta hechos de infra + recuento de noticias que lo nombran', () => {
    expect(
      outfallInfraSummary({
        named_count: 3,
        causes: ['rotura del emisario', 'vertido de aguas residuales'],
      }),
    ).toBe(
      'rotura del emisario · vertido de aguas residuales — 3 noticias lo nombran',
    );
  });

  it('singulariza y funciona sin causas', () => {
    expect(outfallInfraSummary({ named_count: 1, causes: [] })).toBe(
      '1 noticia lo nombra',
    );
  });
});

describe('outfallEpisodesSummary / outfallEpisodeBeachLine (Hito 11.3)', () => {
  it('resume totales con cierres y fecha del último', () => {
    expect(
      outfallEpisodesSummary({
        total: 12,
        closures: 9,
        last: '2026-10-09',
        beaches: [],
      }),
    ).toBe('12 episodios (9 cierres) · el más reciente empezó el 09/10/2026');
  });

  it('singulariza y omite lo que falta', () => {
    expect(
      outfallEpisodesSummary({
        total: 1,
        closures: 1,
        last: null,
        beaches: [],
      }),
    ).toBe('1 episodio (1 cierre)');
    expect(
      outfallEpisodesSummary({
        total: 3,
        closures: 0,
        last: null,
        beaches: [],
      }),
    ).toBe('3 episodios');
  });

  it('la fila por playa junta nombre · N · último', () => {
    expect(
      outfallEpisodeBeachLine({
        beach_id: 1,
        name: 'PLAYA JARDIN',
        municipality: 'Puerto de la Cruz',
        episodes: 9,
        closures: 8,
        last: '2026-10-09',
      }),
    ).toBe('Playa Jardín · 9 episodios · últ. 09/10/2026');
  });
});

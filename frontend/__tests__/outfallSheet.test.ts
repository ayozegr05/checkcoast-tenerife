// Tests de lib/outfallSheet: texto de la ficha de emisario a partir
// de los datos crudos del censo de vertidos.

import { describe, expect, it } from '@jest/globals';

import {
  clusterNewsCoverage,
  conduitSegs,
  denunciaLead,
  flattenNewsGroups,
  kpiSegs,
  natureParts,
  nearbyUniqueBeaches,
  newsFamilyChips,
  operationDetail,
  operationShort,
  operationText,
  originLabel,
  outfallEpisodeBeachLine,
  outfallEpisodesSummary,
  outfallInfraSummary,
  outfallNewsMeta,
  protectedAreaName,
  protectedAreaNote,
  smartTitle,
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
    ).toBe('Franja marina Teno–Rasca');
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

describe('smartTitle', () => {
  it('normaliza responsables en mayúsculas de censo', () => {
    expect(smartTitle('CLUB NAUTICO DE BAJAMAR')).toBe(
      'Club Nautico de Bajamar',
    );
    expect(smartTitle('AYUNTAMIENTO DE GUÍA DE ISORA')).toBe(
      'Ayuntamiento de Guía de Isora',
    );
  });

  it('conserva siglas y romanos', () => {
    expect(smartTitle('EDARI DEL POLÍGONO III')).toBe('EDARI del Polígono III');
    expect(smartTitle('CEPSA')).toBe('CEPSA');
  });

  it('no toca lo que ya viene bien escrito', () => {
    expect(smartTitle('Ayuntamiento de Arona')).toBe('Ayuntamiento de Arona');
    expect(smartTitle('Endesa Generación')).toBe('Endesa Generación');
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

describe('kpiSegs', () => {
  it('orilla + profundidad sumergida → lead + tiles', () => {
    expect(kpiSegs('emisario submarino', 922, -41)).toEqual({
      lead: 'Emisario submarino vierte a:',
      tiles: [
        { v: '922 m', l: 'de la orilla' },
        { v: '41 m', l: 'bajo el mar' },
      ],
    });
  });

  it('a ras de mar → tile "0 m / a ras de mar", no null', () => {
    expect(kpiSegs('emisario submarino', 100, 0)).toEqual({
      lead: 'Emisario submarino vierte a:',
      tiles: [
        { v: '100 m', l: 'de la orilla' },
        { v: '0 m', l: 'a ras de mar' },
      ],
    });
  });

  it('desemboca elevado → tile de altura "sobre el mar"', () => {
    expect(kpiSegs('conducción', 300, 20)).toEqual({
      lead: 'Conducción vierte a:',
      tiles: [
        { v: '300 m', l: 'de la orilla' },
        { v: '20 m', l: 'sobre el mar' },
      ],
    });
  });

  it('sin métricas → null; sin tipo → "La conducción"', () => {
    expect(kpiSegs('emisario submarino', null, null)).toBeNull();
    expect(kpiSegs(null, 500, null)!.lead).toBe('La conducción vierte a:');
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

describe('operationShort (celda del triaje)', () => {
  it('comprime el funcionamiento a su titular', () => {
    expect(operationShort(true, 'Habitual')).toBe('Vierte a diario');
    expect(operationShort(true, 'De excedencia-emergencia')).toBe(
      'Solo al desbordarse',
    );
    expect(operationShort(true, null)).toBe('En funcionamiento');
    expect(operationShort(false, 'Habitual')).toBe('Ahora no vierte');
    expect(operationShort(null, 'Habitual')).toBe('Vertido habitual');
    expect(operationShort(null, 'De excedencia-emergencia')).toBe(
      'Solo al desbordarse',
    );
    expect(operationShort(undefined, undefined)).toBe('Sin datos');
  });
});

describe('operationDetail (detalle bajo el triaje)', () => {
  it('se omite cuando la celda ya lo dice', () => {
    expect(operationDetail(true, 'Habitual')).toBeNull();
    expect(operationDetail(true, null)).toBeNull();
  });

  it('se muestra cuando añade algo: desbordes, parada o solo régimen', () => {
    expect(operationDetail(true, 'De excedencia-emergencia')).toContain(
      'desborda',
    );
    expect(operationDetail(false, 'Habitual')).toContain('No opera ahora');
    expect(operationDetail(null, 'Habitual')).toBe(
      'Pensado para vertido habitual.',
    );
  });
});

describe('natureParts', () => {
  it('residual urbana con EDAR → Depuradora sin paréntesis', () => {
    const parts = natureParts('Residual urbana', 'EDAR X', null, null);
    expect(parts).toHaveLength(1);
    expect(parts[0].label).toBe('Depuradora');
    expect(parts[0].verdict).toContain('depurada');
    expect(parts[0].verdictBad).toBe(false);
  });

  it('pretratamiento detectado en la descripción → no es depuradora', () => {
    const parts = natureParts(
      'Residual urbana',
      null,
      null,
      'procede de la estación de pretratamiento de Punta Blanca',
    );
    expect(parts[0].label).toBe('Estación de pretratamiento');
    expect(parts[0].verdict).toContain('sin depurar');
    expect(parts[0].verdictBad).toBe(true);
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
  it('junta fecha · medio · playa casada', () => {
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
        fact: null,
      }),
    ).toBe('09/10/26 · El Día · Playa Jardín');
  });

  it('el hecho de infra va de titular de fila, no en la meta', () => {
    // infra_cause se pinta como lead de la NewsRow; la meta queda
    // solo con medio · fecha (· playa) — sin duplicar el hecho
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
        fact: 'fisura en la conducción',
      }),
    ).toBe('09/10/26 · El Día');
  });

  it('withDate:false omite la fecha (el lead ya la lleva)', () => {
    expect(
      outfallNewsMeta(
        {
          id: 1,
          beach_id: 2,
          title: 'Vertido',
          url: 'https://x.test/b',
          source: 'El Día',
          published_at: '2026-10-09T12:00:00Z',
          event_type: 'infra',
          cause: null,
          beach_name: 'PLAYA JARDIN PM1',
          infra_cause: 'vertido',
          fact: 'vertido',
        },
        false,
      ),
    ).toBe('El Día · Playa Jardín');
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
        fact: null,
      }),
    ).toBe('');
  });

  it('dayOnly (hijas de pila): "7 oct" sin año — el año lo da el riel', () => {
    expect(
      outfallNewsMeta(
        {
          id: 1,
          beach_id: 2,
          title: 'Vertido',
          url: 'https://x.test/b',
          source: 'El Día',
          published_at: '2026-10-07T12:00:00Z',
          event_type: 'infra',
          cause: null,
          beach_name: 'PLAYA JARDIN PM4',
          infra_cause: null,
          fact: null,
        },
        true,
        true,
        true,
      ),
    ).toBe('7 oct · El Día · Playa Jardín');
  });
});

describe('lista plana de prensa (chips + hemeroteca)', () => {
  const item = (id: number, published_at: string | null) => ({
    id,
    beach_id: null,
    title: `t${id}`,
    url: 'https://x.test',
    source: 'El Día',
    published_at,
    event_type: 'infra',
    cause: null,
    beach_name: null,
    infra_cause: null,
    fact: null,
  });
  const groups = [
    {
      year: 2025,
      families: [
        {
          family: 'rotura del emisario',
          count: 2,
          items: [item(1, '2025-05-28'), item(2, '2025-03-01')],
        },
        { family: 'vertido', count: 1, items: [item(3, '2025-06-10')] },
      ],
    },
    {
      year: 2024,
      families: [
        {
          family: 'rotura del emisario',
          count: 1,
          items: [item(4, '2024-11-02')],
        },
      ],
    },
  ];

  it('flattenNewsGroups aplana años y familias, recientes primero', () => {
    expect(flattenNewsGroups(groups).map((n) => n.id)).toEqual([3, 1, 2, 4]);
  });

  it('newsFamilyChips agrega el contador de cada familia entre años', () => {
    expect(newsFamilyChips(groups)).toEqual([
      { family: 'rotura del emisario', count: 3 },
      { family: 'vertido', count: 1 },
    ]);
  });
});

describe('clusterNewsCoverage (pilas de prensa)', () => {
  const flat = (
    id: number,
    family: string,
    published_at: string,
    beach_name: string | null,
  ) => ({
    id,
    beach_id: null,
    title: `t${id}`,
    url: 'https://x.test',
    source: 'El Día',
    published_at,
    event_type: 'infra',
    cause: null,
    beach_name,
    infra_cause: null,
    fact: null,
    family,
  });

  it('una pieza sin playa se engancha a la única pila de su familia', () => {
    const items = [
      flat(1, 'rotura', '2026-09-27', 'PLAYA JARDIN PM1'),
      flat(2, 'rotura', '2026-09-28', null),
      flat(3, 'vertido', '2026-09-30', 'PLAYA JARDIN PM4'),
    ];
    const clusters = clusterNewsCoverage(items);
    expect(clusters).toHaveLength(2);
    expect(
      clusters.find((c) => c.items.length === 2)?.items.map((n) => n.id),
    ).toEqual([2, 1]);
  });

  it('sin playa y con dos pilas posibles no adivina: queda suelta', () => {
    const items = [
      flat(1, 'rotura', '2026-09-27', 'PLAYA JARDIN PM1'),
      flat(2, 'rotura', '2026-09-20', 'EL MÉDANO PM3'),
      flat(3, 'rotura', '2026-09-25', null),
    ];
    const clusters = clusterNewsCoverage(items);
    expect(clusters).toHaveLength(3);
    expect(clusters.every((c) => c.items.length === 1)).toBe(true);
  });

  it('dos piezas sin playa no forman pila: falta el ancla', () => {
    const items = [
      flat(1, 'rotura', '2026-09-27', null),
      flat(2, 'rotura', '2026-09-28', null),
    ];
    const clusters = clusterNewsCoverage(items);
    expect(clusters).toHaveLength(2);
  });

  it('sin playa y familia fuera de ventana queda suelta', () => {
    const items = [
      flat(1, 'denuncia', '2024-09-28', 'PLAYA JARDIN PM4'),
      flat(2, 'denuncia', '2025-08-27', null),
    ];
    const clusters = clusterNewsCoverage(items);
    expect(clusters).toHaveLength(2);
  });
});

describe('denunciaLead (lead corto de Denuncias)', () => {
  it('lee la acción del titular y la antepone al hecho físico', () => {
    expect(
      denunciaLead({
        title: 'El vertido de 1.000 litros que investiga el Cabildo',
        fact: 'vertido de cloruro férrico por rotura de manguera',
      }),
    ).toBe('investigación por vertido de cloruro férrico por rotura de manguera');
    expect(
      denunciaLead({
        title: 'Sanción a la concesionaria por el derrame',
        fact: 'derrame químico',
      }),
    ).toBe('expediente sancionador por derrame químico');
    expect(
      denunciaLead({
        title: 'La Fiscalía denuncia a la depuradora',
        fact: 'vertido de aguas fecales',
      }),
    ).toBe('denuncia por vertido de aguas fecales');
  });

  it('sin keyword clara o sin hecho devuelve null → la fila usa el titular', () => {
    expect(
      denunciaLead({ title: 'El Cabildo actúa', fact: 'algo' }),
    ).toBeNull();
    expect(
      denunciaLead({ title: 'investiga el Cabildo', fact: null }),
    ).toBeNull();
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

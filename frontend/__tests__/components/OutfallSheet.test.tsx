import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Image, Linking } from 'react-native';

import OutfallSheet from '../../components/sheet/OutfallSheet';
import { fetchOutfallNearbyBeaches, fetchOutfallNews } from '../../lib/api';
import { beach, outfall } from '../../test/fixtures';

jest.mock('../../lib/api', () => ({
  ...jest.requireActual<typeof import('../../lib/api')>('../../lib/api'),
  fetchOutfallNearbyBeaches: jest.fn(),
  fetchOutfallNews: jest.fn(),
}));

const nearbyMock = jest.mocked(fetchOutfallNearbyBeaches);
const newsMock = jest.mocked(fetchOutfallNews);

const emisario = outfall(9, 'EMISARIO LOS LLANOS', {
  status: 'illegal',
  nature: 'Residual urbana',
  municipality: 'Santa Cruz de Tenerife',
  source_url: 'https://example.org/censo',
});

const vistas = beach(3, 'Playa Las Vistas', { status: 'open' });

describe('<OutfallSheet />', () => {
  beforeEach(() => {
    // default: sin noticias — los tests que la quieren la configuran
    newsMock.mockResolvedValue({
      named: [],
      named_groups: [],
      zone: [],
      zone_groups: [],
      summary: null,
      episodes: null,
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    nearbyMock.mockReset();
    newsMock.mockReset();
  });

  it('legalidad, qué se vierte, dónde y enlace al censo oficial', async () => {
    jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
    nearbyMock.mockResolvedValue([]);
    const open = jest
      .spyOn(Linking, 'openURL')
      .mockResolvedValue(undefined as never);

    await render(<OutfallSheet feature={emisario} />);

    expect(nearbyMock).toHaveBeenCalledWith(9);
    expect(screen.getByText('ILEGAL')).toBeTruthy();
    expect(screen.getByText('Qué se vierte')).toBeTruthy();
    // una sola sustancia → lead comunicativo, no título gigante
    expect(screen.getByText(/: vierte /)).toBeTruthy();
    expect(screen.getByText(/Santa Cruz de Tenerife/)).toBeTruthy();

    await fireEvent.press(
      screen.getByRole('link', { name: 'Abrir el censo oficial de vertidos' }),
    );
    expect(open).toHaveBeenCalledWith('https://example.org/censo');
  });

  it('playas cercanas: solo son pulsables las cargadas en el mapa', async () => {
    jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
    nearbyMock.mockResolvedValue([
      {
        outfall_id: 9,
        beach_id: 3,
        beach_name: 'Playa Las Vistas',
        municipality: 'Arona',
        distance_m: 300,
      },
      {
        outfall_id: 9,
        beach_id: 77,
        beach_name: 'Playa Fantasma',
        municipality: null,
        distance_m: 1500,
      },
    ]);
    const onSelectBeach = jest.fn();

    await render(
      <OutfallSheet
        feature={emisario}
        beaches={[vistas]}
        onSelectBeach={onSelectBeach}
      />,
    );

    const fantasma = await screen.findByRole('button', {
      name: 'Playa Fantasma, ver en el mapa',
    });
    expect(fantasma).toBeDisabled();
    await fireEvent.press(fantasma);
    expect(onSelectBeach).not.toHaveBeenCalled();

    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Playa Las Vistas, ver en el mapa',
      }),
    );
    expect(onSelectBeach).toHaveBeenCalledWith(vistas);
  });

  it('emisario en espacio protegido muestra la caja ZEC', async () => {
    jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
    nearbyMock.mockResolvedValue([]);

    await render(
      <OutfallSheet
        feature={outfall(10, 'EMISARIO TENO', {
          protected_area: 'Teno-Rasca. Ref. ES7020111',
        })}
      />,
    );

    expect(screen.getByText(/Emisario en espacio protegido/)).toBeTruthy();
    expect(screen.getByText(/Teno-Rasca/)).toBeTruthy();
  });

  it('prensa de infra: chips de familia, hecho delante, titular anexo, disclaimer al pie', async () => {
    jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
    nearbyMock.mockResolvedValue([]);
    const namedItem = {
      id: 1,
      beach_id: 3,
      title: 'Rotura del emisario de Punta Brava',
      url: 'https://x.test/rotura',
      source: 'El Día',
      published_at: '2026-10-09T12:00:00Z',
      event_type: 'infra',
      cause: 'rotura del emisario',
      beach_name: 'PLAYA JARDIN PM4',
      infra_cause: 'rotura del emisario',
      fact: 'rotura del emisario',
    };
    const zoneItem = {
      id: 2,
      beach_id: 3,
      title: 'Fisura en la red de saneamiento del puerto',
      url: 'https://x.test/fisura',
      source: 'Diario',
      published_at: '2026-10-05T08:00:00Z',
      event_type: 'closure',
      cause: 'fisura',
      beach_name: 'PLAYA JARDIN PM1',
      infra_cause: null,
      fact: null,
    };
    newsMock.mockResolvedValue({
      named: [namedItem],
      named_groups: [
        {
          year: 2026,
          families: [
            {
              family: 'Roturas y averías',
              count: 1,
              items: [namedItem],
            },
          ],
        },
      ],
      zone: [zoneItem],
      zone_groups: [
        {
          year: 2026,
          families: [
            {
              family: 'Vertidos',
              count: 1,
              items: [zoneItem],
            },
          ],
        },
      ],
      summary: {
        named_count: 1,
        causes: ['rotura del emisario'],
      },
      episodes: null,
    });
    const open = jest
      .spyOn(Linking, 'openURL')
      .mockResolvedValue(undefined as never);

    await render(<OutfallSheet feature={emisario} />);

    expect(newsMock).toHaveBeenCalledWith(9);
    expect(await screen.findByText('En la prensa')).toBeTruthy();
    // rótulo + síntesis: volumen y playa (mono-playa)
    expect(screen.getByText('De este emisario')).toBeTruthy();
    expect(
      screen.getAllByText('1 noticia desde 2026 · Playa Jardín').length,
    ).toBe(2); // mismo texto en «De este emisario» y «En la zona»
    expect(screen.getByText('En la zona')).toBeTruthy();
    // chips-filtro de familia (con "Todas"): un único juego de
    // filtros gobierna los dos ámbitos y cuenta toda la sección
    expect(screen.getAllByText('Todas (2)').length).toBe(1);
    expect(screen.getByText('Roturas (1)')).toBeTruthy();
    expect(screen.getByText('Vertidos (1)')).toBeTruthy();
    // Fila estilo lista: la meta (fecha·fuente) abre la fila — la
    // playa ya la dice la síntesis del grupo — y el hecho es el
    // texto principal; el titular vive en el accessibilityLabel
    expect(screen.getByText(/rotura del emisario/)).toBeTruthy();
    expect(screen.getByText('9 oct · El Día')).toBeTruthy();
    // el disclaimer sigue ahí, al pie de la card
    expect(screen.getByText(/no implica causalidad/)).toBeTruthy();

    await fireEvent.press(
      screen.getByRole('link', {
        name: 'Rotura del emisario de Punta Brava, abrir noticia',
      }),
    );
    expect(open).toHaveBeenCalledWith('https://x.test/rotura');
  });

  it('lista plana con más de 4 fuentes: "Ver N más" despliega el resto', async () => {
    jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
    nearbyMock.mockResolvedValue([]);
    // fechas >30 días entre sí: no encadenan en cobertura
    // relacionada y siguen siendo filas sueltas (prueba "Ver N más")
    const mk = (id: number, title: string, when: string) => ({
      id,
      beach_id: 3,
      title,
      url: `https://x.test/${id}`,
      source: 'El Día',
      published_at: `${when}T12:00:00Z`,
      event_type: 'infra',
      cause: 'vertido',
      beach_name: 'PLAYA JARDIN PM4',
      infra_cause: 'vertido de aguas residuales',
      fact: null,
    });
    newsMock.mockResolvedValue({
      named: [],
      named_groups: [
        {
          year: 2026,
          families: [
            {
              family: 'Vertidos',
              count: 5,
              items: [
                mk(1, 'Uno', '2026-10-09'),
                mk(2, 'Dos', '2026-08-01'),
                mk(3, 'Tres', '2026-06-01'),
                mk(4, 'Cuatro', '2026-04-01'),
                mk(5, 'Cinco', '2026-02-01'),
              ],
            },
          ],
        },
      ],
      zone: [],
      zone_groups: [],
      summary: { named_count: 4, causes: ['vertido de aguas residuales'] },
      episodes: null,
    });

    await render(<OutfallSheet feature={emisario} />);

    // 4 filas a la vista en la lista plana, la quinta tras
    // "Ver 1 más"
    expect(await screen.findByText(/Uno/)).toBeTruthy();
    expect(screen.queryByText(/Cinco/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Ver 1 más' }));
    expect(screen.getByText(/Cinco/)).toBeTruthy();
  });

  it('cobertura relacionada se pliega en grupo y despliega titulares', async () => {
    jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
    nearbyMock.mockResolvedValue([]);
    // misma playa + misma familia + ≤30 días entre piezas → un solo
    // grupo de cobertura aunque los hechos difieran en redacción
    const mk = (
      id: number,
      title: string,
      fact: string | null,
      when: string,
    ) => ({
      id,
      beach_id: 3,
      title,
      url: `https://x.test/${id}`,
      source: 'El Día',
      published_at: `${when}T12:00:00Z`,
      event_type: 'infra',
      cause: 'vertido',
      beach_name: 'PLAYA JARDIN PM4',
      infra_cause: null,
      fact,
    });
    newsMock.mockResolvedValue({
      named: [],
      named_groups: [
        {
          year: 2026,
          families: [
            {
              family: 'Vertidos',
              count: 3,
              items: [
                mk(1, 'Uno', 'vertido de aguas residuales', '2026-10-07'),
                mk(2, 'Dos', 'contaminación por vertidos', '2026-10-01'),
                mk(3, 'Tres', 'vertido de aguas residuales', '2026-09-30'),
              ],
            },
          ],
        },
      ],
      zone: [],
      zone_groups: [],
      summary: null,
      episodes: null,
    });

    await render(<OutfallSheet feature={emisario} />);

    // los titulares no se ven hasta expandir; la cabecera ES el
    // contador: "3 publicaciones de vertidos" + meta de intervalo
    expect(await screen.findByText('3 publicaciones de vertidos')).toBeTruthy();
    expect(screen.queryByText('Uno')).toBeNull();

    await fireEvent.press(
      screen.getByRole('button', { name: /3 noticias relacionadas/ }),
    );
    expect(screen.getByText('Uno')).toBeTruthy();
    expect(screen.getByText('Tres')).toBeTruthy();
  });

  it('chips de familia: filtran la lista plana y "Todas" la restaura', async () => {
    jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
    nearbyMock.mockResolvedValue([]);
    const mk = (id: number, title: string) => ({
      id,
      beach_id: 3,
      title,
      url: `https://x.test/${id}`,
      source: 'El Día',
      published_at: '2026-10-09T12:00:00Z',
      event_type: 'infra',
      cause: null,
      beach_name: null,
      infra_cause: null,
      fact: null,
    });
    newsMock.mockResolvedValue({
      named: [],
      named_groups: [
        {
          year: 2026,
          families: [
            {
              family: 'Roturas',
              count: 2,
              items: [mk(1, 'Uno'), mk(2, 'Dos')],
            },
            { family: 'Vertidos', count: 1, items: [mk(3, 'Tres')] },
          ],
        },
      ],
      zone: [],
      zone_groups: [],
      summary: null,
      episodes: null,
    });

    await render(<OutfallSheet feature={emisario} />);

    expect(await screen.findByText(/Uno/)).toBeTruthy();
    // Filtrar por Vertidos deja solo su ítem; "Todas" restaura
    await fireEvent.press(
      screen.getByRole('button', { name: 'Vertidos, 1 noticias' }),
    );
    expect(screen.queryByText(/Uno/)).toBeNull();
    expect(screen.getByText(/Tres/)).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Todas, 3 noticias' }),
    );
    expect(screen.getByText(/Uno/)).toBeTruthy();
    expect(screen.getByText(/Tres/)).toBeTruthy();
  });

  it('sin noticias de infra la sección no se renderiza', async () => {
    jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
    nearbyMock.mockResolvedValue([]);
    newsMock.mockResolvedValue({
      named: [],
      named_groups: [],
      zone: [],
      zone_groups: [],
      summary: null,
      episodes: null,
    });

    await render(<OutfallSheet feature={emisario} />);

    expect(screen.queryByText('En la prensa')).toBeNull();
  });
});

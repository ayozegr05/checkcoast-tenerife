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
    newsMock.mockResolvedValue({ named: [], zone: [] });
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
    expect(screen.getByText('No autorizado')).toBeTruthy();
    expect(screen.getByText('Qué se vierte')).toBeTruthy();
    expect(screen.getByText('Residual urbana')).toBeTruthy();
    expect(screen.getByText('Está en Santa Cruz de Tenerife.')).toBeTruthy();

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

    expect(screen.getByText('Emisario en espacio protegido')).toBeTruthy();
    expect(screen.getByText(/Teno-Rasca/)).toBeTruthy();
  });

  it('prensa de infra: named primero, zona después, titulares enlazables', async () => {
    jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
    nearbyMock.mockResolvedValue([]);
    newsMock.mockResolvedValue({
      named: [
        {
          id: 1,
          beach_id: 3,
          title: 'Rotura del emisario de Punta Brava',
          url: 'https://x.test/rotura',
          source: 'El Día',
          published_at: '2026-10-09T12:00:00Z',
          event_type: 'infra',
          cause: 'rotura del emisario',
          beach_name: 'PLAYA JARDIN PM4',
        },
      ],
      zone: [
        {
          id: 2,
          beach_id: 3,
          title: 'Fisura en la red de saneamiento del puerto',
          url: 'https://x.test/fisura',
          source: 'Diario',
          published_at: '2026-10-05T08:00:00Z',
          event_type: 'closure',
          cause: 'fisura',
          beach_name: 'PLAYA JARDIN PM1',
        },
      ],
    });
    const open = jest
      .spyOn(Linking, 'openURL')
      .mockResolvedValue(undefined as never);

    await render(<OutfallSheet feature={emisario} />);

    expect(newsMock).toHaveBeenCalledWith(9);
    expect(await screen.findByText('En la prensa')).toBeTruthy();
    // etiqueta "según prensa" + aviso de no-causalidad obligatorios
    expect(screen.getByText(/no implica causalidad/)).toBeTruthy();
    expect(screen.getByText('De este punto')).toBeTruthy();
    expect(screen.getByText('En la zona')).toBeTruthy();
    // meta: medio · fecha · playa casada
    expect(screen.getByText(/El Día · 09\/10\/2026/)).toBeTruthy();

    await fireEvent.press(
      screen.getByRole('link', {
        name: 'Rotura del emisario de Punta Brava, abrir noticia',
      }),
    );
    expect(open).toHaveBeenCalledWith('https://x.test/rotura');
  });

  it('sin noticias de infra la sección no se renderiza', async () => {
    jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
    nearbyMock.mockResolvedValue([]);
    newsMock.mockResolvedValue({ named: [], zone: [] });

    await render(<OutfallSheet feature={emisario} />);

    expect(screen.queryByText('En la prensa')).toBeNull();
  });
});

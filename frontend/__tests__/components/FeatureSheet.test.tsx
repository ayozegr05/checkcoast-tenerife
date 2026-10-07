import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import React from 'react';
import { BackHandler, Image, Linking } from 'react-native';

import FeatureSheet from '../../components/FeatureSheet';
import { fetchOutfallNearbyBeaches } from '../../lib/api';
import { beach, outfall } from '../../test/fixtures';

jest.mock('../../lib/api', () => ({
  ...jest.requireActual<typeof import('../../lib/api')>('../../lib/api'),
  fetchOutfallNearbyBeaches: jest.fn(),
}));

// La ficha de playa tiene su propia suite: aquí solo importa qué punto
// recibe y que los callbacks lleguen cableados
jest.mock('../../components/BeachDetail', () => {
  const { Pressable, Text, View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return function MockBeachDetail(props: {
    feature: { properties: { name: string } };
    outfalls?: unknown[];
    onViewOnMap?: () => void;
    onSelectOutfall?: (f: unknown) => void;
  }) {
    return (
      <View>
        <Text>{`ficha: ${props.feature.properties.name}`}</Text>
        <Pressable accessibilityRole="button" onPress={props.onViewOnMap}>
          <Text>ver en mapa</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => props.onSelectOutfall?.(props.outfalls?.[0])}
        >
          <Text>ver emisario</Text>
        </Pressable>
      </View>
    );
  };
});

const nearbyMock = jest.mocked(fetchOutfallNearbyBeaches);

const jardin1 = beach(1, 'Playa Jardín PM1', {
  municipality: 'Puerto de la Cruz',
  status: 'closed',
});
const jardin2 = beach(2, 'Playa Jardín PM4', {
  municipality: 'Puerto de la Cruz',
  status: 'open',
});
const vistas = beach(3, 'Playa Las Vistas', { status: 'open' });

const emisario = outfall(9, 'EMISARIO LOS LLANOS', {
  status: 'illegal',
  nature: 'Residual urbana',
  source_url: 'https://example.org/censo',
});

describe('<FeatureSheet />', () => {
  // Fake timers: las animaciones (spring/timing) avanzan dentro de act
  // en vez de disparar frames sueltos entre aserciones
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
    nearbyMock.mockReset().mockResolvedValue([]);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('emisario: estado legal, playas cercanas y fuente oficial', async () => {
    const onSelectBeach = jest.fn();
    const open = jest
      .spyOn(Linking, 'openURL')
      .mockResolvedValue(undefined as never);
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
    await render(
      <FeatureSheet
        selection={{ type: 'outfall', feature: emisario }}
        onClose={jest.fn()}
        beaches={[vistas]}
        onSelectBeach={onSelectBeach}
      />,
    );
    expect(nearbyMock).toHaveBeenCalledWith(9);
    expect(screen.getByText('Emisario Los Llanos')).toBeTruthy();
    expect(screen.getByText('No autorizado')).toBeTruthy();

    const fantasma = await screen.findByRole('button', {
      name: 'Playa Fantasma, ver en el mapa',
    });
    expect(fantasma).toBeDisabled();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Playa Las Vistas, ver en el mapa' }),
    );
    expect(onSelectBeach).toHaveBeenCalledWith(vistas);

    await fireEvent.press(
      screen.getByRole('link', { name: 'Abrir el censo oficial de vertidos' }),
    );
    expect(open).toHaveBeenCalledWith('https://example.org/censo');
  });

  it('playa con varios PMs: selector de zona, ficha y vuelta atrás', async () => {
    const onClose = jest.fn();
    const onZoneShown = jest.fn();
    const handlers: Parameters<typeof BackHandler.addEventListener>[1][] = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, h) => {
      handlers.push(h);
      return { remove: () => handlers.splice(handlers.indexOf(h), 1) };
    });
    await render(
      <FeatureSheet
        selection={{
          type: 'beach',
          feature: jardin1,
          hasAlert: true,
          members: [jardin1, jardin2],
        }}
        onClose={onClose}
        onZoneShown={onZoneShown}
      />,
    );
    expect(nearbyMock).not.toHaveBeenCalled();
    expect(screen.getByText('2 zonas de esta playa')).toBeTruthy();
    expect(screen.getByText('Playa Jardín · Puerto de la Cruz')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'El Castillo, Cierre activo' }),
    ).toBeTruthy();

    await fireEvent.press(
      screen.getByRole('button', { name: 'Punta Brava, Sin alertas activas' }),
    );
    expect(screen.getByText('ficha: Playa Jardín PM4')).toBeTruthy();
    expect(
      screen.getByText('Playa Jardín · Punta Brava · Puerto de la Cruz'),
    ).toBeTruthy();
    expect(onZoneShown).toHaveBeenLastCalledWith(jardin2);

    // ✕ con una zona abierta vuelve al selector en vez de cerrar
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar ficha' }));
    expect(screen.getByText('2 zonas de esta playa')).toBeTruthy();
    expect(onZoneShown).toHaveBeenLastCalledWith(null);

    // Igual con el botón atrás de Android
    await fireEvent.press(
      screen.getByRole('button', { name: 'El Castillo, Cierre activo' }),
    );
    let handled: boolean | null | undefined;
    await act(async () => {
      handled = handlers.at(-1)!({} as never);
    });
    expect(handled).toBe(true);
    expect(screen.getByText('2 zonas de esta playa')).toBeTruthy();
    expect(handlers.at(-1)!({} as never)).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('playa simple: delega en BeachDetail y conecta mapa y emisarios', async () => {
    const onViewOnMap = jest.fn();
    const onSelectOutfall = jest.fn();
    await render(
      <FeatureSheet
        selection={{ type: 'beach', feature: vistas, hasAlert: false }}
        onClose={jest.fn()}
        outfalls={[emisario]}
        onViewOnMap={onViewOnMap}
        onSelectOutfall={onSelectOutfall}
      />,
    );
    expect(screen.getByText('ficha: Playa Las Vistas')).toBeTruthy();
    expect(screen.getByText('Playa Las Vistas · Arona')).toBeTruthy();
    await fireEvent.press(screen.getByText('ver emisario'));
    expect(onSelectOutfall).toHaveBeenCalledWith(emisario, vistas);
    // «Ver en el mapa» cierra la hoja con animación y después vuela
    await fireEvent.press(screen.getByText('ver en mapa'));
    await waitFor(() => expect(onViewOnMap).toHaveBeenCalled());
  });

  it('la ✕ cierra la hoja al terminar la animación', async () => {
    const onClose = jest.fn();
    await render(
      <FeatureSheet
        selection={{ type: 'outfall', feature: emisario }}
        onClose={onClose}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar ficha' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

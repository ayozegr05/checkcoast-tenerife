import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import BeachList from '../../components/BeachList';
import { fetchBeachStats, fetchEpisodes } from '../../lib/api';
import { beach, episode, outfall, stats } from '../../test/fixtures';

jest.mock('../../lib/api', () => ({
  ...jest.requireActual<typeof import('../../lib/api')>('../../lib/api'),
  fetchBeachStats: jest.fn(),
  fetchEpisodes: jest.fn(),
}));

// La ficha tiene su propia suite: aquí solo importa qué playa abre la
// lista y que los callbacks de la ficha lleguen bien cableados
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

const statsMock = jest.mocked(fetchBeachStats);
const episodesMock = jest.mocked(fetchEpisodes);

const jardin1 = beach(1, 'Playa Jardín PM1', {
  municipality: 'Puerto de la Cruz',
  status: 'closed',
});
const jardin2 = beach(2, 'Playa Jardín PM4', {
  municipality: 'Puerto de la Cruz',
  status: 'open',
});
const vistas = beach(3, 'Playa Las Vistas', { status: 'open' });
const camison = beach(4, 'Playa El Camisón', { status: 'warning' });
const benijo = beach(5, 'Playa de Benijo', {
  municipality: null,
  monitored: false,
  status: null,
});
const beaches = [jardin1, jardin2, vistas, camison, benijo];

const ROW = /^Playa .+, .+, (Cerrada|Aviso|Apta|No monitorizada)/;
const rowNames = () =>
  screen
    .getAllByRole('button', { name: ROW })
    .map((r) => r.props.accessibilityLabel.split(',')[0]);

const props = (
  over: Partial<React.ComponentProps<typeof BeachList>> = {},
): React.ComponentProps<typeof BeachList> => ({
  beaches,
  visible: true,
  onSelect: jest.fn(),
  onClose: jest.fn(),
  ...over,
});

describe('<BeachList />', () => {
  beforeEach(() => {
    statsMock.mockReset();
    episodesMock.mockReset();
    statsMock.mockResolvedValue([
      stats({
        beach_id: 1,
        closures: 1,
        total_samples: 10,
        bad_samples: 2,
        non_apta_samples: 2,
      }),
      stats({
        beach_id: 2,
        total_samples: 10,
        latest_evaluation: 'Apta',
        latest_sampled_at: '2026-08-12',
      }),
      stats({ beach_id: 3, closures: 4, total_samples: 8, contam_episodes: 4 }),
      stats({ beach_id: 4, total_samples: 6 }),
    ]);
    episodesMock.mockResolvedValue([]);
  });

  it('cerrada no pinta nada ni pide datos', async () => {
    await render(<BeachList {...props({ visible: false })} />);
    expect(screen.queryByText('Playas de Tenerife')).toBeNull();
    expect(statsMock).not.toHaveBeenCalled();
  });

  it('agrupa los PMs y ordena por estado', async () => {
    await render(<BeachList {...props()} />);
    expect(statsMock).toHaveBeenCalled();
    expect(episodesMock).toHaveBeenCalled();
    expect(screen.getByText('3 vigiladas · 1 sin vigilar')).toBeTruthy();
    expect(rowNames()).toEqual([
      'Playa Jardín',
      'Playa El Camisón',
      'Playa Las Vistas',
      'Playa de Benijo',
    ]);
    expect(
      screen.getByRole('button', {
        name: 'Playa Jardín, Puerto de la Cruz, Cerrada, 2 puntos de muestreo',
      }),
    ).toBeTruthy();
    expect(
      await screen.findByText(
        'Puerto de la Cruz · 2 zonas · 1 cierre · 0 avisos · 2 muestras no aptas',
      ),
    ).toBeTruthy();
  });

  it('busca por nombre sin acentos y muestra el vacío', async () => {
    await render(<BeachList {...props()} />);
    const search = screen.getByLabelText('Buscar playa por nombre');
    await fireEvent.changeText(search, 'camison');
    expect(rowNames()).toEqual(['Playa El Camisón']);
    await fireEvent.changeText(search, 'zzz');
    expect(screen.getByText('Sin resultados')).toBeTruthy();
  });

  it('filtra por municipio, por «sin municipio» y por estado', async () => {
    await render(<BeachList {...props()} />);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Filtrar por municipio Arona' }),
    );
    expect(
      screen.getByRole('button', { name: 'Filtrar por municipio Arona' }),
    ).toBeSelected();
    expect(rowNames()).toEqual(['Playa El Camisón', 'Playa Las Vistas']);

    await fireEvent.press(
      screen.getByRole('button', { name: 'Filtrar por playas sin municipio' }),
    );
    expect(rowNames()).toEqual(['Playa de Benijo']);

    await fireEvent.press(
      screen.getByRole('button', { name: 'Mostrar todas las playas' }),
    );
    const aviso = screen.getByRole('button', {
      name: 'Filtrar por estado Aviso',
    });
    await fireEvent.press(aviso);
    expect(aviso).toBeSelected();
    expect(screen.getByText('Aviso (1)')).toBeTruthy();
    expect(rowNames()).toEqual(['Playa El Camisón']);
    await fireEvent.press(aviso);
    expect(rowNames()).toHaveLength(4);
  });

  it('solo ofrece chips de los estados presentes', async () => {
    await render(<BeachList {...props({ beaches: [vistas, camison] })} />);
    expect(
      screen.getByRole('button', { name: 'Filtrar por estado Apta' }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Filtrar por estado Cerrada' }),
    ).toBeNull();
  });

  it('ordena por cierres y «Agua siempre apta» excluye cualquier problema', async () => {
    await render(<BeachList {...props()} />);
    await screen.findByText(/1 cierre · 0 avisos/);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ordenar por Más cierres' }),
    );
    expect(rowNames()[0]).toBe('Playa Las Vistas');
    expect(rowNames().at(-1)).toBe('Playa de Benijo');

    const agua = screen.getByRole('button', {
      name: 'Filtrar por playas que nunca tuvieron un problema de agua',
    });
    await fireEvent.press(agua);
    expect(agua).toBeSelected();
    expect(
      screen.getByRole('button', { name: 'Ordenar por Más cierres' }),
    ).not.toBeSelected();
    expect(rowNames()).toEqual(['Playa El Camisón']);
    expect(screen.getByText(/cero muestras no aptas/)).toBeTruthy();

    await fireEvent.press(
      screen.getByRole('button', { name: 'Ordenar por Estado' }),
    );
    expect(agua).not.toBeSelected();
    expect(rowNames()).toHaveLength(4);
  });

  it('una fila multipunto se despliega y abre la ficha del PM', async () => {
    const p = props();
    await render(<BeachList {...p} />);
    const row = screen.getByRole('button', { name: /^Playa Jardín,/ });
    expect(row).not.toBeExpanded();
    await fireEvent.press(row);
    expect(row).toBeExpanded();
    expect(await screen.findByText('12/08 · Apta')).toBeTruthy();

    await fireEvent.press(
      screen.getByRole('button', { name: 'Punta Brava, Apta' }),
    );
    expect(screen.getByText('ficha: Playa Jardín PM4')).toBeTruthy();
    expect(
      screen.getByText('Playa Jardín · Punta Brava · Puerto de la Cruz'),
    ).toBeTruthy();

    await fireEvent.press(
      screen.getByRole('button', { name: 'Volver a la lista de playas' }),
    );
    expect(screen.queryByText(/^ficha:/)).toBeNull();
    // Al volver, el grupo sigue desplegado
    expect(
      screen.getByRole('button', { name: 'El Castillo, Cerrada' }),
    ).toBeTruthy();
  });

  it('una fila simple abre la ficha y conecta mapa y emisarios', async () => {
    const emisario = outfall(90, 'Emisario Los Cristianos');
    const p = props({ outfalls: [emisario], onSelectOutfall: jest.fn() });
    await render(<BeachList {...p} />);
    await fireEvent.press(
      screen.getByRole('button', { name: /^Playa Las Vistas,/ }),
    );
    expect(screen.getByText('ficha: Playa Las Vistas')).toBeTruthy();
    await fireEvent.press(screen.getByText('ver en mapa'));
    expect(p.onSelect).toHaveBeenCalledWith(vistas);
    await fireEvent.press(screen.getByText('ver emisario'));
    expect(p.onSelectOutfall).toHaveBeenCalledWith(emisario, vistas);
  });

  it('cruza cierres por contaminación con emisarios a <500 m', async () => {
    episodesMock.mockResolvedValue([
      episode({ beach_id: 3, cause: 'Contaminación' }),
      episode({ id: 2, beach_id: 4, cause: 'Contaminación' }),
    ]);
    await render(
      <BeachList
        {...props({
          outfalls: [
            {
              ...outfall(90, 'Emisario Las Vistas'),
              geometry: { type: 'Point', coordinates: [-16.501, 28.3] },
            },
          ],
          beaches: [
            vistas,
            {
              ...camison,
              geometry: { type: 'Point', coordinates: [-16.4, 28.3] },
            },
          ],
        })}
      />,
    );
    expect(
      await screen.findByText(
        /De las 2 playas con cierres por contaminación,\s+1 tienen un emisario a menos de 500 m/,
      ),
    ).toBeTruthy();
  });

  it('abre prefiltrada por municipio y se cierra', async () => {
    const p = props({ initialMunicipality: 'Puerto de la Cruz' });
    await render(<BeachList {...p} />);
    expect(rowNames()).toEqual(['Playa Jardín']);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Cerrar lista de playas' }),
    );
    expect(p.onClose).toHaveBeenCalled();
  });
});

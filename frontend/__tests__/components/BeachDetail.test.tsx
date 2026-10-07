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
import { Image, Share } from 'react-native';

import BeachDetail from '../../components/BeachDetail';
import {
  fetchBeachIncidents,
  fetchBeachNearbyOutfalls,
  fetchBeachNews,
  fetchBeachQuality,
} from '../../lib/api';
import {
  beach,
  incident,
  measurement,
  news,
  outfall,
} from '../../test/fixtures';

jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
jest.mock('../../lib/api', () => ({
  ...jest.requireActual<typeof import('../../lib/api')>('../../lib/api'),
  fetchBeachIncidents: jest.fn(),
  fetchBeachNearbyOutfalls: jest.fn(),
  fetchBeachNews: jest.fn(),
  fetchBeachQuality: jest.fn(),
}));

const incidentsMock = jest.mocked(fetchBeachIncidents);
const nearbyMock = jest.mocked(fetchBeachNearbyOutfalls);
const newsMock = jest.mocked(fetchBeachNews);
const qualityMock = jest.mocked(fetchBeachQuality);

const emptyNews = {
  summary: {
    event_type: null,
    cause: null,
    items_count: 0,
    outlets_count: 0,
    since: null,
  },
  items: [],
};

const jardin = beach(10, 'Playa Jardín', {
  municipality: 'Puerto de la Cruz',
  status: 'open',
});

describe('<BeachDetail />', () => {
  beforeEach(() => {
    jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
    incidentsMock.mockReset().mockResolvedValue([]);
    nearbyMock.mockReset().mockResolvedValue([]);
    newsMock.mockReset().mockResolvedValue(emptyNews);
    qualityMock
      .mockReset()
      .mockResolvedValue([
        measurement({ id: 2, sampled_at: '2026-07-15', ecoli: '40' }),
        measurement({ id: 1, sampled_at: '2026-07-01', ecoli: '80' }),
      ]);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('playa vigilada: estado oficial, calidad, gráfica y fuentes', async () => {
    await render(<BeachDetail feature={jardin} hasAlert={false} />);
    for (const m of [incidentsMock, nearbyMock, newsMock, qualityMock]) {
      expect(m).toHaveBeenCalledWith(10);
    }
    expect(screen.getByText('Sin alertas activas')).toBeTruthy();
    expect(
      await screen.findByText('Calidad del agua · 15/07/2026'),
    ).toBeTruthy();
    expect(screen.getByText('Evolución')).toBeTruthy();
    expect(screen.getByText(/^Fuentes: Censo Zonas de Baño 2025/)).toBeTruthy();
    // Sin prensa ni incidentes ni emisarios: esas tarjetas no aparecen
    expect(screen.queryByText(/^Ver titulares/)).toBeNull();
    expect(screen.queryByText(/^Historial de incidencias/)).toBeNull();
    expect(screen.queryByText('Emisarios cercanos')).toBeNull();
  });

  it('una alerta sobre una playa abierta se muestra como aviso', async () => {
    await render(<BeachDetail feature={jardin} hasAlert />);
    expect(screen.getByText('Aviso activo')).toBeTruthy();
    await screen.findByText(/^Calidad del agua/);
  });

  it('playa OSM sin vigilancia: no pide analíticas', async () => {
    const benijo = beach(50, 'Playa de Benijo', {
      municipality: null,
      monitored: false,
      status: null,
    });
    await render(<BeachDetail feature={benijo} hasAlert={false} />);
    expect(screen.getByText('Sin monitorización oficial')).toBeTruthy();
    expect(qualityMock).not.toHaveBeenCalled();
    expect(newsMock).toHaveBeenCalledWith(50);
    expect(
      screen.getByText(/^Playa sin controles sanitarios oficiales/),
    ).toBeTruthy();
  });

  it('prensa, historial y emisarios cercanos cuando hay datos', async () => {
    const target = outfall(7, 'Emisario Punta Brava');
    const onSelectOutfall = jest.fn();
    newsMock.mockResolvedValue({
      summary: {
        event_type: 'closure',
        cause: 'Contaminación',
        items_count: 1,
        outlets_count: 1,
        since: '2026-07-02T10:00:00Z',
      },
      items: [news({ title: 'Cierran Playa Jardín por un vertido' })],
    });
    incidentsMock.mockResolvedValue([
      incident({ opened_at: '2026-07-01', closed_at: '2026-07-03' }),
    ]);
    nearbyMock.mockResolvedValue([
      {
        outfall_id: 7,
        name: 'Emisario Punta Brava',
        kind: null,
        status: 'illegal',
        distance_m: 400,
      },
    ]);
    await render(
      <BeachDetail
        feature={{
          ...jardin,
          properties: { ...jardin.properties, status: 'closed' },
        }}
        hasAlert
        outfalls={[target]}
        onSelectOutfall={onSelectOutfall}
      />,
    );
    expect(screen.getByText('Cierre activo')).toBeTruthy();
    expect(
      await screen.findByText('Historial de incidencias (1)'),
    ).toBeTruthy();

    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver 1 titulares de prensa' }),
    );
    expect(
      screen.getByText('Cierran Playa Jardín por un vertido'),
    ).toBeTruthy();

    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Emisario Punta Brava, ver en el mapa',
      }),
    );
    expect(onSelectOutfall).toHaveBeenCalledWith(target);
  });

  it('comparte estado, último análisis y enlace con previsualización', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' });
    await render(<BeachDetail feature={jardin} hasAlert={false} />);
    await screen.findByText(/^Calidad del agua/);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Compartir estado de la playa' }),
    );
    const { message } = share.mock.calls[0][0] as { message: string };
    expect(message).toContain('Playa Jardín (Puerto de la Cruz)');
    expect(message).toContain('Estado: Sin alertas activas');
    expect(message).toContain('Último análisis (15/07/2026): Apta');
    expect(message).toMatch(/\/b\/10$/);
  });

  it('si la API falla la ficha sigue en pie sin tarjetas de datos', async () => {
    for (const m of [incidentsMock, nearbyMock, newsMock, qualityMock]) {
      m.mockRejectedValue(new Error('offline'));
    }
    await render(<BeachDetail feature={jardin} hasAlert={false} />);
    expect(screen.getByText('Sin alertas activas')).toBeTruthy();
    expect(screen.queryByText(/^Calidad del agua/)).toBeNull();
    expect(screen.queryByText('Evolución')).toBeNull();
  });

  it('la foto satélite lleva al mapa', async () => {
    const onViewOnMap = jest.fn();
    await render(
      <BeachDetail
        feature={jardin}
        hasAlert={false}
        onViewOnMap={onViewOnMap}
      />,
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver en el mapa' }),
    );
    expect(onViewOnMap).toHaveBeenCalled();
  });
});

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  fetchAlerts,
  fetchBeaches,
  fetchEpisodes,
  fetchOutfalls,
} from '../lib/api';
import { useBeachData } from '../lib/useBeachData';
import { beach, episode, outfall } from '../test/fixtures';

jest.mock('../lib/api', () => ({
  fetchAlerts: jest.fn(),
  fetchBeaches: jest.fn(),
  fetchEpisodes: jest.fn(),
  fetchOutfalls: jest.fn(),
}));

const mocked = {
  fetchAlerts: fetchAlerts as jest.MockedFunction<typeof fetchAlerts>,
  fetchBeaches: fetchBeaches as jest.MockedFunction<typeof fetchBeaches>,
  fetchEpisodes: fetchEpisodes as jest.MockedFunction<typeof fetchEpisodes>,
  fetchOutfalls: fetchOutfalls as jest.MockedFunction<typeof fetchOutfalls>,
};

const fc = (features: ReturnType<typeof beach>[]) => ({
  type: 'FeatureCollection' as const,
  features,
});

beforeEach(() => {
  jest.clearAllMocks();
  mocked.fetchOutfalls.mockResolvedValue(fc([outfall(1, 'Emisario')]));
  mocked.fetchBeaches.mockResolvedValue(fc([beach(10, 'Playa Jardín PM1')]));
  mocked.fetchAlerts.mockResolvedValue([]);
  mocked.fetchEpisodes.mockResolvedValue([episode()]);
});

describe('useBeachData', () => {
  it('carga las 4 colecciones al montar y apaga loading', async () => {
    const { result } = await renderHook(() => useBeachData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.outfalls.features).toHaveLength(1);
    expect(result.current.beachesFC.features).toHaveLength(1);
    expect(result.current.episodes).toHaveLength(1);
    expect(result.current.error).toBeNull();
    expect(mocked.fetchOutfalls).toHaveBeenCalledTimes(1);
  });

  it('inyecta el status vivo de /alerts en la playa correspondiente', async () => {
    mocked.fetchAlerts.mockResolvedValue([
      {
        beach_id: 10,
        beach_name: 'Playa Jardín PM1',
        municipality: 'Puerto de la Cruz',
        status: 'closed',
        reported_at: '2026-07-01',
        source_url: null,
        longitude: -16.5,
        latitude: 28.3,
      },
    ]);
    const { result } = await renderHook(() => useBeachData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const f = result.current.beachesFC.features[0];
    expect(f.properties.status).toBe('closed');
    expect(f.properties.alert).toBe(true);
  });

  it('un fallo de red deja error y apaga loading; reload reintenta', async () => {
    mocked.fetchBeaches.mockRejectedValue(new Error('sin red'));
    const { result } = await renderHook(() => useBeachData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('sin red');

    mocked.fetchBeaches.mockResolvedValue(fc([beach(10, 'X')]));
    await act(async () => result.current.reload());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.beachesFC.features).toHaveLength(1);
  });

  it('el polling a los 5 min refresca alertas, playas y episodios', async () => {
    jest.useFakeTimers();
    try {
      const { result } = await renderHook(() => useBeachData());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(mocked.fetchAlerts).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(5 * 60 * 1000);
      });
      expect(mocked.fetchAlerts).toHaveBeenCalledTimes(2);
      expect(mocked.fetchBeaches).toHaveBeenCalledTimes(2);
      expect(mocked.fetchEpisodes).toHaveBeenCalledTimes(2);
      // Emisarios no se repollen: el censo no cambia
      expect(mocked.fetchOutfalls).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

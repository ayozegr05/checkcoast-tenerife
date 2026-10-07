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

import MunicipalityStats from '../../components/MunicipalityStats';
import { fetchBeachStats, fetchMunicipalityIncidents } from '../../lib/api';
import { beach, episode } from '../../test/fixtures';

jest.mock('../../lib/api', () => ({
  ...jest.requireActual<typeof import('../../lib/api')>('../../lib/api'),
  fetchBeachStats: jest.fn(),
  fetchMunicipalityIncidents: jest.fn(),
}));

const beaches = [
  beach(1, 'Playa Las Vistas', { status: 'open' }),
  beach(2, 'Playa Jardín', {
    municipality: 'Puerto de la Cruz',
    status: 'open',
  }),
  beach(3, 'Playa El Camisón', { status: 'open' }),
];

const episodes = [
  episode({
    id: 1,
    beach_id: 1,
    beach_name: 'Playa Las Vistas',
    municipality: 'Arona',
    opened_at: '2025-07-10',
    closed_at: '2025-07-12',
    cause: 'Contaminación',
  }),
  episode({
    id: 2,
    beach_id: 2,
    beach_name: 'Playa Jardín',
    kind: 'warning',
    opened_at: '2025-03-01',
    closed_at: '2025-03-02',
  }),
  episode({
    id: 3,
    beach_id: 3,
    beach_name: 'Playa El Camisón',
    municipality: 'Arona',
    opened_at: '2024-08-01',
    closed_at: '2024-08-02',
    cause: 'Mar agitado',
  }),
];

const muniNames = () =>
  screen
    .getAllByRole('button', { name: /, posición \d+ de \d+/ })
    .map((r) => r.props.accessibilityLabel.split(',')[0]);
const episodeNames = () =>
  screen
    .getAllByRole('button', { name: /^Ver ficha de / })
    .map((r) => r.props.accessibilityLabel.replace('Ver ficha de ', ''));

const props = (
  over: Partial<React.ComponentProps<typeof MunicipalityStats>> = {},
): React.ComponentProps<typeof MunicipalityStats> => ({
  visible: true,
  beaches,
  episodes,
  onSelect: jest.fn(),
  onSelectBeach: jest.fn(),
  onClose: jest.fn(),
  ...over,
});

describe('<MunicipalityStats />', () => {
  // Los selectores de año llegan hasta el año en curso: se fija el reloj
  // (solo Date) para que el test no dependa de cuándo se ejecuta
  beforeEach(() => {
    jest.useFakeTimers({
      now: new Date('2025-10-15T12:00:00Z'),
      doNotFake: [
        'nextTick',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'hrtime',
        'performance',
      ],
    });
    jest.mocked(fetchBeachStats).mockReset().mockResolvedValue([]);
    jest.mocked(fetchMunicipalityIncidents).mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('cerrado no pinta nada', async () => {
    await render(<MunicipalityStats {...props({ visible: false })} />);
    expect(screen.queryByText('Incidencias por municipio')).toBeNull();
  });

  it('abre el ranking en el año en curso', async () => {
    await render(<MunicipalityStats {...props()} />);
    expect(
      screen.getByText('Ranking de 2025 · episodios del año por municipio'),
    ).toBeTruthy();
    expect(screen.getByText('2025 · 1 cierre')).toBeTruthy();
    expect(muniNames()).toEqual(['Arona', 'Puerto de la Cruz']);
  });

  it('las chips de año cambian el ranking; «Histórico» muestra el total', async () => {
    await render(<MunicipalityStats {...props()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Ver año 2024' }));
    expect(screen.getByText(/^Ranking de 2024/)).toBeTruthy();
    expect(muniNames()).toEqual(['Arona']);

    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver ranking histórico completo' }),
    );
    expect(
      screen.getByText('Ranking por afectación actual e histórica'),
    ).toBeTruthy();
    expect(screen.getByText('2 cierres · 1 aviso desde 2024')).toBeTruthy();
  });

  it('busca municipio por nombre', async () => {
    await render(<MunicipalityStats {...props()} />);
    const search = screen.getByLabelText('Buscar municipio por nombre');
    await fireEvent.changeText(search, 'puerto');
    expect(muniNames()).toEqual(['Puerto de la Cruz']);
    await fireEvent.changeText(search, 'xyz');
    expect(
      screen.getByText('Sin municipios que coincidan con “xyz”'),
    ).toBeTruthy();
  });

  it('vista «Este año»: episodios filtrables por causa', async () => {
    const p = props();
    await render(<MunicipalityStats {...p} />);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver episodios del año' }),
    );
    expect(episodeNames()).toEqual(['Playa Las Vistas', 'Playa Jardín']);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Filtrar por Contaminación' }),
    );
    expect(episodeNames()).toEqual(['Playa Las Vistas']);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver ficha de Playa Las Vistas' }),
    );
    expect(p.onSelectBeach).toHaveBeenCalledWith(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Ver año 2024' }));
    expect(screen.getByText('Año 2024')).toBeTruthy();
  });

  it('vista Temporada: solo episodios de junio a septiembre', async () => {
    await render(
      <MunicipalityStats {...props({ initialView: 'temporada' })} />,
    );
    expect(episodeNames()).toEqual(['Playa Las Vistas']);
    expect(screen.getByText('1 cierre')).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver verano 2024' }),
    );
    expect(screen.getByText('Verano 2024')).toBeTruthy();
    expect(episodeNames()).toEqual(['Playa El Camisón']);
  });

  it('abre con una causa preseleccionada desde el banner', async () => {
    await render(
      <MunicipalityStats
        {...props({ initialView: 'year', initialCause: 'Contaminación' })}
      />,
    );
    expect(episodeNames()).toEqual(['Playa Las Vistas']);
  });

  it('detalle de municipio: entra, vuelve y abre sus playas', async () => {
    const p = props();
    await render(<MunicipalityStats {...p} />);
    await fireEvent.press(
      screen.getByRole('button', { name: /^Arona, posición 1/ }),
    );
    expect(fetchMunicipalityIncidents).toHaveBeenCalledWith('Arona');
    expect(await screen.findByText('Sin incidentes registrados')).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver playas del municipio' }),
    );
    expect(p.onSelect).toHaveBeenCalledWith('Arona');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Volver al ranking' }),
    );
    expect(screen.getByText('Incidencias por municipio')).toBeTruthy();
  });

  it('si el año en curso no tiene episodios abre el último con datos', async () => {
    jest.setSystemTime(new Date('2026-03-01T12:00:00Z'));
    await render(<MunicipalityStats {...props()} />);
    expect(
      screen.getByText('Ranking de 2025 · episodios del año por municipio'),
    ).toBeTruthy();
    expect(muniNames()).toEqual(['Arona', 'Puerto de la Cruz']);
    expect(screen.getByRole('button', { name: 'Ver año 2026' })).toBeTruthy();
  });

  it('sin episodios abre el histórico; la ✕ cierra', async () => {
    const p = props({ episodes: [] });
    await render(<MunicipalityStats {...p} />);
    expect(screen.queryByRole('button', { name: /^Ver año/ })).toBeNull();
    expect(
      screen.getByText('Ranking por afectación actual e histórica'),
    ).toBeTruthy();
    expect(screen.queryByText(/^Sin episodios en/)).toBeNull();
    await fireEvent.press(screen.getByText('✕'));
    expect(p.onClose).toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import MuniDetail from '../../components/stats/MuniDetail';
import { fetchMunicipalityIncidents } from '../../lib/api';
import type { MuniStats } from '../../lib/muniStats';
import { beach, episode } from '../../test/fixtures';

jest.mock('../../lib/api', () => ({
  ...jest.requireActual<typeof import('../../lib/api')>('../../lib/api'),
  fetchMunicipalityIncidents: jest.fn(),
}));
const fetchMock = jest.mocked(fetchMunicipalityIncidents);

const detail: MuniStats = {
  municipality: 'Puerto de la Cruz',
  name: 'Puerto de la Cruz',
  beaches: 2,
  points: 3,
  closedNow: 1,
  warningNow: 0,
  incidents: 3,
  closuresLastYear: 1,
  badSamples: 0,
};

const incidents = [
  episode({
    id: 1,
    opened_at: '2025-07-01',
    closed_at: '2025-07-03',
    cause: 'Mar agitado',
    observations: 'Oleaje',
  }),
  episode({
    id: 2,
    beach_id: 11,
    beach_name: 'PLAYA MARTIÁNEZ',
    kind: 'warning',
    opened_at: '2026-08-01',
    closed_at: null,
    cause: 'E. coli',
  }),
];

const props = (
  over: Partial<React.ComponentProps<typeof MuniDetail>> = {},
): React.ComponentProps<typeof MuniDetail> => ({
  detail,
  // La 11 está cerrada ahora: su aviso abierto se lee como cierre activo
  beaches: [beach(11, 'PLAYA MARTIÁNEZ', { status: 'closed' })],
  isYearMode: false,
  selYear: 2026,
  yearCause: 'all',
  onSelect: jest.fn(),
  onSelectBeach: jest.fn(),
  onBack: jest.fn(),
  ...over,
});

describe('<MuniDetail />', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(incidents);
  });

  it('carga la línea temporal, más reciente primero', async () => {
    await render(<MuniDetail {...props()} />);
    expect(fetchMock).toHaveBeenCalledWith('Puerto de la Cruz');
    const rows = await screen.findAllByRole('button', {
      name: /^Ver ficha de/,
    });
    expect(rows.map((r) => r.props.accessibilityLabel)).toEqual([
      'Ver ficha de Playa Martiánez',
      'Ver ficha de Playa Jardín',
    ]);
    expect(screen.getByText('Cierre activo')).toBeTruthy();
    expect(screen.getByText('01/07/2025 → 03/07/2025 · 3 días')).toBeTruthy();
    expect(screen.getByText('Oleaje')).toBeTruthy();
  });

  it('filtra por causa (familia) y por año', async () => {
    const { rerender } = await render(
      <MuniDetail {...props({ yearCause: 'Contaminación' })} />,
    );
    expect(await screen.findByText('Playa Martiánez')).toBeTruthy();
    expect(screen.queryByText('Playa Jardín')).toBeNull();

    await rerender(
      <MuniDetail {...props({ isYearMode: true, selYear: 2025 })} />,
    );
    expect(await screen.findByText('Playa Jardín')).toBeTruthy();
    expect(screen.queryByText('Playa Martiánez')).toBeNull();
    expect(screen.getByText(/· 2025 · más reciente primero/)).toBeTruthy();
  });

  it('navegación: volver, ver playas y abrir ficha', async () => {
    const p = props();
    await render(<MuniDetail {...p} />);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Ver ficha de Playa Jardín' }),
    );
    expect(p.onSelectBeach).toHaveBeenCalledWith(10);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver playas del municipio' }),
    );
    expect(p.onSelect).toHaveBeenCalledWith('Puerto de la Cruz');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Volver al ranking' }),
    );
    expect(p.onBack).toHaveBeenCalled();
  });

  it('«Sin municipio» no consulta la API y sintetiza las alertas de prensa', async () => {
    await render(
      <MuniDetail
        {...props({
          detail: { ...detail, municipality: null, name: 'Sin municipio' },
          beaches: [
            beach(50, 'Playa de Benijo', {
              municipality: null,
              alert: true,
              status: 'closed',
              reported_at: '2026-09-20T10:00:00Z',
            }),
          ],
        })}
      />,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByText('Playa de Benijo')).toBeTruthy();
    expect(
      screen.getByText('Según prensa — sin incidente oficial en Náyade'),
    ).toBeTruthy();
  });

  it('sin incidentes muestra el vacío', async () => {
    fetchMock.mockResolvedValue([]);
    await render(<MuniDetail {...props()} />);
    expect(await screen.findByText('Sin incidentes registrados')).toBeTruthy();
  });
});

import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import QualityChart from '../../components/beach/QualityChart';
import type { ChartPoint } from '../../lib/quality';

// Ionicons arrastra expo-font → expo-asset, que no está instalado en el
// entorno de tests; el icono no aporta nada a lo que se comprueba
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

const data: ChartPoint[] = [
  { date: '2025-07-01', value: 10, yearLabel: '2025', yearSpan: 2 },
  { date: '2025-08-01', value: 900, yearLabel: null, yearSpan: 0 },
  { date: '2026-07-01', value: 40, yearLabel: '2026', yearSpan: 1 },
];

const props = (
  over: Partial<React.ComponentProps<typeof QualityChart>> = {},
): React.ComponentProps<typeof QualityChart> => ({
  chartData: data,
  chartParam: 'ecoli',
  onChangeParam: jest.fn(),
  chartW: 300,
  onChartWidth: jest.fn(),
  incidentRanges: [],
  ...over,
});

describe('<QualityChart />', () => {
  it('pie con nº de muestreos y límite del parámetro activo', async () => {
    await render(<QualityChart {...props()} />);
    expect(screen.getByText(/^3 muestreos/)).toBeTruthy();
    expect(screen.getByText(/\(500 UFC\/100\s+mL\)/)).toBeTruthy();
    expect(screen.queryByText(/línea roja/)).toBeNull();
    expect(screen.getByText('2025')).toBeTruthy();
    expect(screen.getByText('2026')).toBeTruthy();
  });

  it('cambia de parámetro y marca el seleccionado', async () => {
    const p = props({ chartParam: 'enterococci' });
    await render(<QualityChart {...p} />);
    expect(
      screen.getByRole('button', { name: 'Ver evolución de Enterococo' }),
    ).toBeSelected();
    expect(screen.getByText(/\(200 UFC\/100\s+mL\)/)).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver evolución de E. coli' }),
    );
    expect(p.onChangeParam).toHaveBeenCalledWith('ecoli');
  });

  it('con incidentes añade la leyenda de la línea roja', async () => {
    await render(
      <QualityChart
        {...props({
          incidentRanges: [{ from: '2025-08-01', to: '2025-08-05' }],
        })}
      />,
    );
    expect(screen.getByText(/línea roja = cierre\/aviso/)).toBeTruthy();
  });

  it('informa del ancho medido', async () => {
    const p = props();
    await render(<QualityChart {...p} />);
    await fireEvent(screen.getByText('Evolución'), 'layout', {
      nativeEvent: { layout: { width: 320, height: 200, x: 0, y: 0 } },
    });
    expect(p.onChartWidth).toHaveBeenCalledWith(320);
  });
});

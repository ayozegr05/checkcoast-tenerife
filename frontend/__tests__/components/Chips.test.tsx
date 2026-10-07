import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import {
  CauseChips,
  SeasonFilterChips,
  YearChips,
} from '../../components/stats/Chips';

const thisYear = new Date().getFullYear();

const yearProps = (
  over: Partial<React.ComponentProps<typeof YearChips>> = {},
): React.ComponentProps<typeof YearChips> => ({
  view: 'ranking',
  visibleYears: [thisYear, 2024],
  selYear: 2024,
  histMode: false,
  chipCounts: new Map([
    [thisYear, 5],
    [2024, 3],
  ]),
  totalEpisodes: 20,
  showAllYears: false,
  canCollapse: false,
  onPickYear: jest.fn(),
  onToggleAll: jest.fn(),
  onHistoric: jest.fn(),
  ...over,
});

describe('<YearChips />', () => {
  it('ranking: años con conteo + chip «Histórico»', async () => {
    const props = yearProps();
    await render(<YearChips {...props} />);
    expect(screen.getByText('Este año (5)')).toBeTruthy();
    expect(screen.getByText('2024 (3)')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Ver año 2024' }));
    expect(props.onPickYear).toHaveBeenCalledWith(2024);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver ranking histórico completo' }),
    );
    expect(props.onHistoric).toHaveBeenCalled();
    expect(screen.getByText('Histórico (20)')).toBeTruthy();
  });

  it('temporada: habla de veranos y no ofrece histórico', async () => {
    await render(
      <YearChips
        {...yearProps({ view: 'temporada', visibleYears: [2023, 2024] })}
      />,
    );
    expect(screen.getByText('Verano 2024 (3)')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Ver verano 2023' }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Ver ranking histórico completo' }),
    ).toBeNull();
  });

  it('«Más años ›» / «Menos ›» pliegan y despliegan', async () => {
    const props = yearProps({ canCollapse: true });
    const { rerender } = await render(<YearChips {...props} />);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver todos los años' }),
    );
    expect(props.onToggleAll).toHaveBeenCalled();
    expect(screen.getByText('Más años ›')).toBeTruthy();
    await rerender(<YearChips {...props} showAllYears />);
    expect(screen.getByText('Menos ›')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Plegar la lista de años' }),
    ).toBeTruthy();
  });
});

describe('<SeasonFilterChips />', () => {
  it('solo muestra filtros con episodios y en singular/plural', async () => {
    await render(
      <SeasonFilterChips
        counts={{ closures: 1, warnings: 0, active: 3 }}
        filter="all"
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByText('1 cierre')).toBeTruthy();
    expect(screen.getByText('3 activas')).toBeTruthy();
    expect(screen.queryByText(/aviso/)).toBeNull();
  });

  it('tocar el filtro activo lo quita', async () => {
    const onChange = jest.fn();
    await render(
      <SeasonFilterChips
        counts={{ closures: 2, warnings: 2, active: 0 }}
        filter="closure"
        onChange={onChange}
      />,
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Quitar filtro de cierres' }),
    );
    expect(onChange).toHaveBeenLastCalledWith('all');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Filtrar por avisos' }),
    );
    expect(onChange).toHaveBeenLastCalledWith('warning');
  });
});

describe('<CauseChips />', () => {
  it('«Todos» + una chip por causa; tocar la activa vuelve a todos', async () => {
    const onChange = jest.fn();
    await render(
      <CauseChips
        causes={[
          ['Contaminación', 4],
          ['Mar agitado', 2],
        ]}
        active="Contaminación"
        onChange={onChange}
      />,
    );
    expect(screen.getByText('4 contaminación')).toBeTruthy();
    expect(screen.getByText('2 mar agitado')).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Filtrar por Contaminación' }),
    );
    expect(onChange).toHaveBeenLastCalledWith('all');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Filtrar por Mar agitado' }),
    );
    expect(onChange).toHaveBeenLastCalledWith('Mar agitado');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver todos los episodios del año' }),
    );
    expect(onChange).toHaveBeenLastCalledWith('all');
  });
});

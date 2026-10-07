import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import MuniRow from '../../components/stats/MuniRow';
import type { MuniStats } from '../../lib/muniStats';

const m: MuniStats = {
  municipality: 'Arona',
  name: 'Arona',
  beaches: 3,
  points: 5,
  closedNow: 1,
  warningNow: 2,
  incidents: 7,
  closuresLastYear: 4,
  badSamples: 1,
  yearClosures: 2,
  yearWarnings: 1,
  yearActive: 1,
  yearBeaches: ['Playa Chica', 'Los Cristianos'],
};

const base = {
  m,
  index: 0,
  total: 10,
  selYear: 2025,
  yearCause: 'all',
  causeCount: 0,
  maxScore: 200,
};

describe('<MuniRow />', () => {
  it('modo vivo: estado actual + histórico', async () => {
    const onPress = jest.fn();
    await render(<MuniRow {...base} isYearMode={false} onPress={onPress} />);
    expect(screen.getByText('3 playas · 5 zonas')).toBeTruthy();
    expect(screen.getByText('1 cerrada ahora')).toBeTruthy();
    expect(screen.getByText('2 avisos activos')).toBeTruthy();
    expect(
      screen.getByText('7 incidentes (4 últ. año) · 1 muestra no apta'),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Arona, posición 1 de 10, 3 playas, 7 incidentes',
      }),
    );
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('modo-año: episodios de ese año y filtro por causa', async () => {
    await render(
      <MuniRow
        {...base}
        isYearMode
        yearCause="Desprendimientos"
        causeCount={2}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByText('2 cierres')).toBeTruthy();
    expect(screen.getByText('1 aviso')).toBeTruthy();
    expect(screen.getByText('1 sigue abierta')).toBeTruthy();
    expect(screen.getByText('2 desprendimientos')).toBeTruthy();
    expect(
      screen.getByText('Afectadas: Playa Chica · Los Cristianos'),
    ).toBeTruthy();
    expect(screen.queryByText(/ahora$/)).toBeNull();
  });
});

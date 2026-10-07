import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import EpisodeRow from '../../components/stats/EpisodeRow';
import { episode } from '../../test/fixtures';

describe('<EpisodeRow />', () => {
  it('cierre en curso', async () => {
    await render(
      <EpisodeRow
        ep={episode({ closed_at: null, cause: 'Desprendimientos' })}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByText('Sigue cerrada')).toBeTruthy();
    expect(
      screen.getByText(
        'Puerto de la Cruz · desde el 01/07/2026 · desprendimientos',
      ),
    ).toBeTruthy();
  });

  it('aviso resuelto según prensa, sin municipio', async () => {
    const onPress = jest.fn();
    await render(
      <EpisodeRow
        ep={episode({ kind: 'warning', municipality: null, via: 'press' })}
        onPress={onPress}
      />,
    );
    expect(screen.getByText('Aviso resuelto')).toBeTruthy();
    expect(
      screen.getByText(/^Sin municipio · 01\/07\/2026 → 03\/07\/2026/),
    ).toBeTruthy();
    expect(screen.getByText(/según prensa$/)).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver ficha de Playa Jardín' }),
    );
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

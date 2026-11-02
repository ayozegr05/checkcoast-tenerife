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
    expect(screen.getByText('Cierre vigente')).toBeTruthy();
    // La cabecera de mes ya da el año: la fecha va corta
    expect(
      screen.getByText('Puerto de la Cruz · desde el 1 jul · desprendimientos'),
    ).toBeTruthy();
  });

  it('cala de complejo multipunto: la zona encabeza la línea de datos', async () => {
    await render(
      <EpisodeRow
        ep={episode({
          beach_name: 'PLAYA CABEZO (EL)-PASEO DE LAS PALMERAS',
          zone_tag: 'PM4',
          opened_at: '2026-12-28',
          closed_at: '2027-01-03',
        })}
        onPress={jest.fn()}
      />,
    );
    // Sin nombre curado → "Zona 4", nunca la sigla "PM4"; un episodio
    // que cruza de año lleva el año en los dos extremos
    expect(
      screen.getByText(
        /^Zona 4 · Puerto de la Cruz · 28 dic 2026 → 3 ene 2027/,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/PM4/)).toBeNull();
  });

  it('aviso resuelto según prensa, sin municipio', async () => {
    const onPress = jest.fn();
    await render(
      <EpisodeRow
        ep={episode({ kind: 'warning', municipality: null, via: 'press' })}
        onPress={onPress}
      />,
    );
    // Episodio cerrado: sin badge — las fechas ya lo cuentan (badge
    // solo para lo que sigue activo)
    expect(screen.queryByText(/resuelto/)).toBeNull();
    expect(
      screen.getByText(/^Sin municipio · 1 jul → 3 jul · 3 días/),
    ).toBeTruthy();
    expect(screen.getByText(/según prensa$/)).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver ficha de Playa Jardín' }),
    );
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import ZonePicker from '../../components/sheet/ZonePicker';
import { beach } from '../../test/fixtures';

const pm1 = beach(1, 'Playa Jardín PM1', { status: 'closed' });
const pm2 = beach(2, 'Playa Jardín PM2', { status: 'open' });

describe('<ZonePicker />', () => {
  it('lista cada punto con su etiqueta de zona y estado', async () => {
    await render(<ZonePicker members={[pm1, pm2]} onPick={jest.fn()} />);
    expect(screen.getByText('2 zonas de esta playa')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Zona 1, Cierre activo' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Zona 2, Sin alertas activas' }),
    ).toBeTruthy();
  });

  it('al tocar un punto llama a onPick con ese miembro', async () => {
    const onPick = jest.fn();
    await render(<ZonePicker members={[pm1, pm2]} onPick={onPick} />);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Zona 2, Sin alertas activas' }),
    );
    expect(onPick).toHaveBeenCalledWith(pm2);
  });

  it('sin PM en el nombre muestra el nombre legible de la playa', async () => {
    const solo = beach(3, 'PLAYA DEL DUQUE');
    await render(<ZonePicker members={[solo]} onPick={jest.fn()} />);
    expect(screen.getByText('1 zonas de esta playa')).toBeTruthy();
    expect(screen.getByText('Playa del Duque')).toBeTruthy();
  });
});

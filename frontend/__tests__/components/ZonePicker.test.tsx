import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import ZonePicker from '../../components/sheet/ZonePicker';
import { beach } from '../../test/fixtures';

const pm1 = beach(1, 'Playa Jardín PM1', { status: 'closed' });
const pm4 = beach(4, 'Playa Jardín PM4', { status: 'open' });
// PM sin cala mapeada: sigue el rótulo genérico
const pm9 = beach(9, 'Playa Jardín PM9', { status: 'open' });

describe('<ZonePicker />', () => {
  it('lista cada punto con su etiqueta de zona y estado', async () => {
    await render(<ZonePicker members={[pm1, pm4, pm9]} onPick={jest.fn()} />);
    expect(screen.getByText('3 zonas de esta playa')).toBeTruthy();
    // Calas mapeadas: nombre común, no "zona N"
    expect(
      screen.getByRole('button', { name: 'El Castillo, Cierre activo' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Punta Brava, Sin alertas activas' }),
    ).toBeTruthy();
    // Sin cala conocida: etiqueta genérica
    expect(
      screen.getByRole('button', { name: 'Zona 9, Sin alertas activas' }),
    ).toBeTruthy();
  });

  it('al tocar un punto llama a onPick con ese miembro', async () => {
    const onPick = jest.fn();
    await render(<ZonePicker members={[pm1, pm4]} onPick={onPick} />);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Punta Brava, Sin alertas activas' }),
    );
    expect(onPick).toHaveBeenCalledWith(pm4);
  });

  it('sin PM en el nombre muestra el nombre legible de la playa', async () => {
    const solo = beach(3, 'PLAYA DEL DUQUE');
    await render(<ZonePicker members={[solo]} onPick={jest.fn()} />);
    expect(screen.getByText('1 zonas de esta playa')).toBeTruthy();
    expect(screen.getByText('Playa del Duque')).toBeTruthy();
  });
});

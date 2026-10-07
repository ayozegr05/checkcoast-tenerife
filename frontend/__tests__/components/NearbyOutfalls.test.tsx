import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import NearbyOutfalls from '../../components/beach/NearbyOutfalls';
import type { BeachNearbyOutfall } from '../../lib/api';
import { outfall } from '../../test/fixtures';

const nearby: BeachNearbyOutfall[] = [
  {
    outfall_id: 1,
    name: 'Emisario Los Llanos',
    kind: null,
    status: 'illegal',
    distance_m: 320,
  },
  {
    outfall_id: 2,
    name: 'Aliviadero Muelle',
    kind: null,
    status: 'legal',
    distance_m: 1500,
  },
];

describe('<NearbyOutfalls />', () => {
  it('resumen, estado legal y distancia de cada emisario', async () => {
    await render(<NearbyOutfalls nearby={nearby} />);
    expect(screen.getByText(/^2 a menos de 1 km/)).toBeTruthy();
    expect(screen.getAllByText('320 m')).toHaveLength(2);
    expect(screen.getByText('No autorizado')).toBeTruthy();
    expect(screen.getByText('Autorizado')).toBeTruthy();
    expect(screen.getByText('1.5 km')).toBeTruthy();
  });

  it('solo los emisarios cargados en el mapa son pulsables', async () => {
    const onSelect = jest.fn();
    const target = outfall(1, 'Emisario Los Llanos');
    await render(
      <NearbyOutfalls
        nearby={nearby}
        outfalls={[target]}
        onSelectOutfall={onSelect}
      />,
    );
    const missing = screen.getByRole('button', {
      name: 'Aliviadero Muelle, ver en el mapa',
    });
    expect(missing).toBeDisabled();
    await fireEvent.press(missing);
    expect(onSelect).not.toHaveBeenCalled();

    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Emisario Los Llanos, ver en el mapa',
      }),
    );
    expect(onSelect).toHaveBeenCalledWith(target);
  });
});

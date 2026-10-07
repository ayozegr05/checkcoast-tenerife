import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Image } from 'react-native';

import SatelliteShot from '../../components/SatelliteShot';

const center: [number, number] = [-16.5, 28.3];
const LOADING = 'Cargando vista satélite…';
const photo = () => screen.getByLabelText('Vista satélite de la zona');
const zoomIn = () =>
  screen.getByRole('button', { name: 'Acercar vista satélite' });
const zoomOut = () =>
  screen.getByRole('button', { name: 'Alejar vista satélite' });

describe('<SatelliteShot />', () => {
  beforeEach(() => {
    jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
  });

  it('skeleton hasta que carga la foto; luego prefetch del resto', async () => {
    await render(
      <SatelliteShot center={center} centerColor="#0a0" markers={[]} />,
    );
    expect(screen.getByText(LOADING)).toBeTruthy();
    expect(photo().props.source.uri).toContain(
      'World_Imagery/MapServer/export?bbox=',
    );
    await fireEvent(photo(), 'load');
    expect(screen.queryByText(LOADING)).toBeNull();
    // 3 niveles estándar: se prefetchan los 2 que no se ven
    expect(Image.prefetch).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText('© Esri, Maxar, Earthstar Geographics'),
    ).toBeTruthy();
  });

  it('zoom ± respeta los límites y cambia el encuadre', async () => {
    await render(
      <SatelliteShot center={center} centerColor="#0a0" markers={[]} />,
    );
    expect(zoomIn()).toBeDisabled();
    expect(zoomOut()).toBeEnabled();
    const first = photo().props.source.uri;

    await fireEvent.press(zoomOut());
    expect(photo().props.source.uri).not.toBe(first);
    expect(zoomIn()).toBeEnabled();
    await fireEvent.press(zoomOut());
    expect(zoomOut()).toBeDisabled();
  });

  it('solo pinta los marcadores dentro del encuadre', async () => {
    await render(
      <SatelliteShot
        center={center}
        centerColor="#0a0"
        markers={[
          {
            id: 'near',
            coords: [-16.5005, 28.3002],
            color: '#f00',
            label: '2',
          },
          { id: 'far', coords: [-16.4, 28.4], color: '#f00', label: '9' },
        ]}
      />,
    );
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.queryByText('9')).toBeNull();
  });

  it('«Ver en el mapa» solo aparece con onPress', async () => {
    const onPress = jest.fn();
    const { rerender } = await render(
      <SatelliteShot center={center} centerColor="#0a0" markers={[]} />,
    );
    expect(screen.queryByRole('button', { name: 'Ver en el mapa' })).toBeNull();
    await rerender(
      <SatelliteShot
        center={center}
        centerColor="#0a0"
        markers={[]}
        onPress={onPress}
      />,
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver en el mapa' }),
    );
    expect(onPress).toHaveBeenCalled();
  });
});

import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';

import MapLegend from '../../components/map/MapLegend';

const noop = () => {};

// La fila del swatch es el padre del texto: su opacidad indica si el
// estado está oculto en el panel de capas
const opacityOf = (label: string) =>
  StyleSheet.flatten(screen.getByText(label).parent?.props.style)?.opacity ?? 1;

describe('<MapLegend />', () => {
  it('lista los estados de emisarios y playas', async () => {
    await render(
      <MapLegend
        beachSel={new Set()}
        outfallSel={new Set()}
        onOpenLayers={noop}
      />,
    );
    for (const label of [
      'Autorizado',
      'No autorizado',
      'En trámite',
      'Apta',
      'Aviso',
      'Cerrada',
      'Sin monitorizar',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('atenúa solo los estados ocultos', async () => {
    await render(
      <MapLegend
        beachSel={new Set(['open', 'closed'])}
        outfallSel={new Set(['illegal'])}
        onOpenLayers={noop}
      />,
    );
    expect(opacityOf('Apta')).toBe(1);
    expect(opacityOf('Cerrada')).toBe(1);
    expect(opacityOf('No autorizado')).toBe(1);
    expect(opacityOf('Aviso')).toBeLessThan(1);
    expect(opacityOf('Sin monitorizar')).toBeLessThan(1);
    expect(opacityOf('Autorizado')).toBeLessThan(1);
  });

  it('la tarjeta abre el panel de capas al tocarla', async () => {
    const onOpenLayers = jest.fn();
    await render(
      <MapLegend
        beachSel={new Set()}
        outfallSel={new Set()}
        onOpenLayers={onOpenLayers}
      />,
    );
    fireEvent.press(screen.getByLabelText('Abrir panel de capas'));
    expect(onOpenLayers).toHaveBeenCalledTimes(1);
  });
});

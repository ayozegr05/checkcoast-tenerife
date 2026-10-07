import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import MapTopbar from '../../components/map/MapTopbar';

describe('<MapTopbar />', () => {
  it('sin callbacks opcionales solo muestra el buscador', async () => {
    await render(<MapTopbar onToggleSearch={jest.fn()} />);
    expect(
      screen.getByRole('button', {
        name: 'Buscar playa, emisario o municipio',
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Abrir lista de playas' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Abrir lista de emisarios' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Abrir incidencias por municipio' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Abrir guía de uso' }),
    ).toBeNull();
  });

  it('cada botón llama a su callback', async () => {
    const cbs = {
      onOpenList: jest.fn(),
      onOpenOutfalls: jest.fn(),
      onOpenMunicipalities: jest.fn(),
      onToggleSearch: jest.fn(),
      onOpenHelp: jest.fn(),
    };
    await render(<MapTopbar {...cbs} />);
    const cases: [string, keyof typeof cbs][] = [
      ['Abrir lista de playas', 'onOpenList'],
      ['Abrir lista de emisarios', 'onOpenOutfalls'],
      ['Abrir incidencias por municipio', 'onOpenMunicipalities'],
      ['Buscar playa, emisario o municipio', 'onToggleSearch'],
      ['Abrir guía de uso', 'onOpenHelp'],
    ];
    for (const [name, cb] of cases) {
      await fireEvent.press(screen.getByRole('button', { name }));
      expect(cbs[cb]).toHaveBeenCalledTimes(1);
    }
    expect(screen.getByText('Playas')).toBeTruthy();
    expect(screen.getByText('Guía')).toBeTruthy();
  });
});

import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import OutfallList from '../../components/OutfallList';
import { outfall } from '../../test/fixtures';

const fecal = outfall(1, 'VERTIDO BAJAMAR', {
  municipality: 'San Cristóbal de La Laguna',
  status: 'illegal',
  nature: 'Residual urbana',
  continuity: 'Continuo',
  protected_area: 'ZEC Costa de Acentejo',
  shore_m: 10,
  condition: 'Malo',
  start_lat: 28.5,
  start_lon: -16.3,
});
const pluvial = outfall(2, 'ALIVIADERO ANAGA', {
  status: 'legal',
  nature: 'Pluvial',
  shore_m: 300,
});
const salmuera = outfall(3, 'DESALADORA ADEJE', {
  municipality: 'Adeje',
  status: 'unknown',
  nature: 'Salmuera',
});
const outfalls = [pluvial, salmuera, fecal];

const NAMES = /^(Vertido Bajamar|Aliviadero Anaga|Desaladora Adeje)$/;
const rowNames = () =>
  screen.queryAllByText(NAMES).map((t) => t.props.children as string);

const ui = (onSelect = jest.fn(), onClose = jest.fn()) => (
  <OutfallList
    outfalls={outfalls}
    visible
    onSelect={onSelect}
    onClose={onClose}
  />
);

describe('<OutfallList />', () => {
  it('ordena de más a menos preocupante con conteos y minibadges', async () => {
    await render(ui());
    expect(screen.getByText('Emisarios al mar')).toBeTruthy();
    expect(rowNames()[0]).toBe('Vertido Bajamar');
    expect(rowNames()).toHaveLength(3);
    expect(screen.getByText('Todos (3)')).toBeTruthy();
    expect(screen.getByText('No autorizados (1)')).toBeTruthy();
    expect(screen.getByText('Autorizados (1)')).toBeTruthy();
    expect(
      screen.getByText('San Cristóbal de La Laguna · Residual urbana'),
    ).toBeTruthy();
    expect(screen.getByText('🛡 ZEC')).toBeTruthy();
    expect(screen.getByText('⚠ malo')).toBeTruthy();
    expect(screen.getByText('⤴ con recorrido')).toBeTruthy();
  });

  it('busca por nombre', async () => {
    await render(ui());
    await fireEvent.changeText(
      screen.getByLabelText('Buscar emisario por nombre'),
      'anaga',
    );
    expect(rowNames()).toEqual(['Aliviadero Anaga']);
    await fireEvent.changeText(
      screen.getByLabelText('Buscar emisario por nombre'),
      'zzz',
    );
    expect(screen.getByText('Sin resultados')).toBeTruthy();
  });

  it('filtra por estado legal y lo quita al volver a tocarlo', async () => {
    await render(ui());
    await fireEvent.press(screen.getByText('En trámite (1)'));
    expect(rowNames()).toEqual(['Desaladora Adeje']);
    await fireEvent.press(screen.getByText('En trámite (1)'));
    expect(rowNames()).toHaveLength(3);
  });

  it('el municipio acota filas, conteos y cabecera', async () => {
    await render(ui());
    await fireEvent.press(screen.getByText('Adeje (1)'));
    expect(rowNames()).toEqual(['Desaladora Adeje']);
    expect(screen.getByText('Todos (1)')).toBeTruthy();
    expect(
      screen.getByText(
        'Adeje · 0 no autorizados · 0 autorizados · 1 en trámite',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByText('Todos los municipios'));
    expect(rowNames()).toHaveLength(3);
  });

  it('filtra por naturaleza, zona protegida y orilla', async () => {
    await render(ui());
    await fireEvent.press(screen.getByText('Lluvia (1)'));
    expect(rowNames()).toEqual(['Aliviadero Anaga']);
    await fireEvent.press(screen.getByText('En zona protegida (1)'));
    expect(rowNames()).toEqual(['Vertido Bajamar']);
    await fireEvent.press(screen.getByText('En la orilla (1)'));
    expect(rowNames()).toEqual(['Vertido Bajamar']);
    await fireEvent.press(screen.getByText('En la orilla (1)'));
    expect(rowNames()).toHaveLength(3);
  });

  it('tocar una fila selecciona el emisario', async () => {
    const onSelect = jest.fn();
    await render(ui(onSelect));
    await fireEvent.press(screen.getByText('Desaladora Adeje'));
    expect(onSelect).toHaveBeenCalledWith(salmuera);
  });
});

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
    await fireEvent.press(screen.getByLabelText('Estado: Todos'));
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
    await fireEvent.press(screen.getByLabelText('Estado: Todos'));
    await fireEvent.press(screen.getByText('En trámite (1)'));
    expect(rowNames()).toEqual(['Desaladora Adeje']);
    // Elegir cierra el panel — para quitarlo hay que reabrir
    await fireEvent.press(screen.getByLabelText('Estado: En trámite (1)'));
    await fireEvent.press(screen.getByText('En trámite (1)'));
    expect(rowNames()).toHaveLength(3);
  });

  it('el municipio acota filas, conteos y cabecera', async () => {
    await render(ui());
    await fireEvent.press(screen.getByLabelText('Municipio: Todos'));
    await fireEvent.press(screen.getByText('Adeje (1)'));
    expect(rowNames()).toEqual(['Desaladora Adeje']);
    await fireEvent.press(screen.getByLabelText('Estado: Todos'));
    expect(screen.getByText('En trámite (1)')).toBeTruthy();
    expect(
      screen.getByText(
        'Adeje · 0 no autorizados · 0 autorizados · 1 en trámite',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Municipio: Adeje (1)'));
    await fireEvent.press(screen.getByText('Todos los municipios'));
    expect(rowNames()).toHaveLength(3);
  });

  it('filtra por criterios ZEC y orilla dentro del panel Entorno', async () => {
    // Los flags se acumulan (AND), no se excluyen como una faceta
    await render(ui());
    await fireEvent.press(screen.getByLabelText('Más filtros'));
    await fireEvent.press(screen.getByLabelText('Entorno: Todos'));
    await fireEvent.press(screen.getByText('🛡 Zona protegida (1)'));
    expect(rowNames()).toEqual(['Vertido Bajamar']);
    await fireEvent.press(screen.getByText('En la orilla (1)'));
    expect(rowNames()).toEqual(['Vertido Bajamar']); // es los dos a la vez
    await fireEvent.press(screen.getByText('🛡 Zona protegida (1)'));
    expect(rowNames()).toEqual(['Vertido Bajamar']); // solo orilla
    await fireEvent.press(screen.getByText('En la orilla (1)'));
    expect(rowNames()).toHaveLength(3);
  });

  it('los cajones avanzados filtran por vertido y conducción', async () => {
    await render(ui());
    await fireEvent.press(screen.getByLabelText('Más filtros'));
    // Vertido: fecal solo casa el Bajamar
    await fireEvent.press(screen.getByLabelText('Vertido: Todos'));
    await fireEvent.press(screen.getByText('Fecales (1)'));
    expect(rowNames()).toEqual(['Vertido Bajamar']);
    // Conducción: el único 'Malo' es el mismo — el contador refleja
    // el filtro de vertido activo
    await fireEvent.press(screen.getByLabelText('Conducción: Todos'));
    await fireEvent.press(screen.getByText('Malo (1)'));
    expect(rowNames()).toEqual(['Vertido Bajamar']);
    // La fila sigue abierta → el toggle ya dice 'Menos'
    expect(screen.getByLabelText('Menos filtros')).toBeTruthy();
    // Los paneles single-select cerraron al elegir — reabrir para quitar
    await fireEvent.press(screen.getByLabelText('Conducción: Malo (1)'));
    await fireEvent.press(screen.getByText('Malo (1)'));
    await fireEvent.press(screen.getByLabelText('Vertido: Fecales (1)'));
    await fireEvent.press(screen.getByText('Fecales (1)'));
    expect(rowNames()).toHaveLength(3);
  });

  it('los conteos de los chips respetan los otros filtros activos', async () => {
    // Regresión: la cara del acordeón contaba con TODOS los filtros
    // pero los chips solo con el municipio — "Adeje (1)" con
    // status=ilegal activo mentía (la desaladora es 'en trámite')
    await render(ui());
    await fireEvent.press(screen.getByLabelText('Estado: Todos'));
    await fireEvent.press(screen.getByText('No autorizados (1)'));
    await fireEvent.press(screen.getByLabelText('Municipio: Todos'));
    expect(screen.getByText('San Cristóbal de La Laguna (1)')).toBeTruthy();
    expect(screen.getByText('Adeje (0)')).toBeTruthy();
  });

  it('filtra por nivel de riesgo y lo quita al volver a tocarlo', async () => {
    await render(ui());
    await fireEvent.press(screen.getByLabelText('Riesgo: Todos'));
    await fireEvent.press(screen.getByText(/^Alto \(\d+\)/));
    // El vertido fecal ilegal + ZEC + orilla + malo es el único alto
    expect(rowNames()).toEqual(['Vertido Bajamar']);
    await fireEvent.press(screen.getByLabelText('Riesgo: Alto (1)'));
    await fireEvent.press(screen.getByText(/^Alto \(\d+\)/));
    expect(rowNames()).toHaveLength(3);
  });

  it('la legalidad va en la línea de hechos; la píldora es solo riesgo', async () => {
    // Antes eran dos píldoras apiladas: 'Autorizado' verde competía
    // con 'Riesgo alto' rojo. Ahora el estado legal es un glifo de
    // la línea de hechos y la columna solo trae la valoración
    await render(ui());
    expect(screen.getByText('✗ sin autorizar')).toBeTruthy();
    expect(screen.getByText('⏳ en trámite')).toBeTruthy();
    expect(screen.getByText('✓ autorizado')).toBeTruthy();
    expect(screen.queryByText('Autorizado')).toBeNull();
    expect(screen.queryByText('No autorizado')).toBeNull();
    expect(screen.queryByText('En trámite')).toBeNull();
    expect(screen.getAllByText(/^Riesgo /)).toHaveLength(3);
  });

  it('cada faceta muestra el valor completo del filtro en su chip', async () => {
    // Chips-combobox: el valor va entero en el chip, sin truncar
    await render(ui());
    await fireEvent.press(screen.getByLabelText('Estado: Todos'));
    await fireEvent.press(screen.getByText('No autorizados (1)'));
    await fireEvent.press(screen.getByLabelText('Riesgo: Todos'));
    await fireEvent.press(screen.getByText('Alto (1)'));
    expect(screen.getByLabelText('Estado: No autorizados (1)')).toBeTruthy();
    expect(screen.getByLabelText('Riesgo: Alto (1)')).toBeTruthy();
    expect(rowNames()).toEqual(['Vertido Bajamar']);
  });

  it('tocar una fila selecciona el emisario', async () => {
    const onSelect = jest.fn();
    await render(ui(onSelect));
    await fireEvent.press(screen.getByText('Desaladora Adeje'));
    expect(onSelect).toHaveBeenCalledWith(salmuera);
  });
});

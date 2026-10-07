import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import React from 'react';

import QualityCard from '../../components/beach/QualityCard';
import { measurement } from '../../test/fixtures';

// Ionicons arrastra expo-font → expo-asset, que no está instalado en el
// entorno de tests; el icono no aporta nada a lo que se comprueba
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

const STALE =
  'El incidente oficial ya está cerrado · pendiente de nueva muestra';

describe('<QualityCard />', () => {
  it('última muestra con clase y % del límite por parámetro', async () => {
    await render(
      <QualityCard
        quality={[measurement({ ecoli: '100', enterococci: '300' })]}
        beachKey="open"
        sampleNote={null}
      />,
    );
    expect(screen.getByText('Calidad del agua · 01/07/2026')).toBeTruthy();
    expect(screen.getByText('E. coli')).toBeTruthy();
    expect(screen.getByText('Excelente · 20% del límite')).toBeTruthy();
    expect(screen.getByText('Enterococo')).toBeTruthy();
    expect(screen.getByText('Insuficiente · 150% del límite')).toBeTruthy();
    expect(screen.queryByText(STALE)).toBeNull();
  });

  it('valor ausente: guion y sin clasificación', async () => {
    await render(
      <QualityCard
        quality={[measurement({ ecoli: null, enterococci: '150' })]}
        beachKey="open"
        sampleNote={null}
      />,
    );
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('Buena · 75% del límite')).toBeTruthy();
  });

  it('playa abierta con última muestra prohibida: pendiente de muestra', async () => {
    const quality = [measurement({ evaluation: 'Baño prohibido' })];
    const { rerender } = await render(
      <QualityCard quality={quality} beachKey="open" sampleNote={null} />,
    );
    expect(screen.getByText(STALE)).toBeTruthy();
    await rerender(
      <QualityCard quality={quality} beachKey="closed" sampleNote={null} />,
    );
    expect(screen.queryByText(STALE)).toBeNull();
  });

  it('muestra la nota de hueco de muestreo', async () => {
    await render(
      <QualityCard
        quality={[measurement()]}
        beachKey="open"
        sampleNote={{
          text: 'Sin muestras desde hace 40 días',
          anomalous: true,
        }}
      />,
    );
    expect(screen.getByText('Sin muestras desde hace 40 días')).toBeTruthy();
  });
});

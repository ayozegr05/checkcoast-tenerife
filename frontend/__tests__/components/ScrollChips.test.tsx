import { describe, expect, it } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import ScrollChips from '../../components/ScrollChips';

// Los eventos se disparan sobre un hijo: fireEvent sube por el árbol
// hasta el ScrollView, que es quien tiene onLayout/onScroll
const layout = (width: number) =>
  fireEvent(screen.getByText('Chip A'), 'layout', {
    nativeEvent: { layout: { width, height: 40, x: 0, y: 0 } },
  });
const contentSize = (width: number) =>
  fireEvent(screen.getByText('Chip A'), 'contentSizeChange', width, 40);
const scrollTo = (x: number) =>
  fireEvent.scroll(screen.getByText('Chip A'), {
    nativeEvent: {
      contentOffset: { x, y: 0 },
      contentSize: { width: 300, height: 40 },
      layoutMeasurement: { width: 100, height: 40 },
    },
  });

const left = () =>
  screen.queryByRole('button', { name: 'Desplazar municipios a la izquierda' });
const right = () =>
  screen.queryByRole('button', { name: 'Desplazar municipios a la derecha' });

describe('<ScrollChips />', () => {
  const ui = (
    <ScrollChips a11yLabel="municipios">
      <Text>Chip A</Text>
      <Text>Chip B</Text>
    </ScrollChips>
  );

  it('sin desbordamiento no muestra flechas', async () => {
    await render(ui);
    await layout(300);
    await contentSize(250);
    expect(left()).toBeNull();
    expect(right()).toBeNull();
    expect(screen.getByText('Chip B')).toBeTruthy();
  });

  it('las flechas siguen la posición del scroll', async () => {
    await render(ui);
    await layout(100);
    await contentSize(300);
    expect(left()).toBeNull();
    expect(right()).toBeTruthy();

    await scrollTo(100);
    expect(left()).toBeTruthy();
    expect(right()).toBeTruthy();

    await scrollTo(200);
    expect(left()).toBeTruthy();
    expect(right()).toBeNull();
  });

  it('pulsar una flecha no rompe el componente', async () => {
    await render(ui);
    await layout(100);
    await contentSize(300);
    await fireEvent.press(right()!);
    expect(screen.getByText('Chip A')).toBeTruthy();
  });

  it('con anchorEnd abre anclado al final', async () => {
    await render(
      <ScrollChips a11yLabel="municipios" anchorEnd>
        <Text>Chip A</Text>
      </ScrollChips>,
    );
    await layout(100);
    await contentSize(300);
    expect(left()).toBeTruthy();
    expect(right()).toBeNull();
  });
});

import { describe, expect, it } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React, { useState } from 'react';

import LayersPanel from '../../components/map/LayersPanel';

function Harness() {
  const [beachSel, setBeachSel] = useState(
    new Set(['open', 'warning', 'closed', 'unmonitored']),
  );
  const [outfallSel, setOutfallSel] = useState(new Set(['illegal']));
  return (
    <LayersPanel
      beachSel={beachSel}
      setBeachSel={setBeachSel}
      outfallSel={outfallSel}
      setOutfallSel={setOutfallSel}
    />
  );
}

const checked = (name: string) =>
  screen.getByRole('togglebutton', { name }).props.accessibilityState.checked;

describe('<LayersPanel />', () => {
  it('refleja la selección inicial', async () => {
    await render(<Harness />);
    expect(checked('Todas')).toBe(true);
    expect(checked('Todos')).toBe(false);
    expect(checked('No autorizado')).toBe(true);
    expect(checked('Autorizado')).toBe(false);
  });

  it('un estado se activa y desactiva por separado', async () => {
    await render(<Harness />);
    await fireEvent.press(screen.getByRole('togglebutton', { name: 'Aviso' }));
    expect(checked('Aviso')).toBe(false);
    expect(checked('Todas')).toBe(false);
    await fireEvent.press(screen.getByRole('togglebutton', { name: 'Aviso' }));
    expect(checked('Todas')).toBe(true);
  });

  it('«Todos» marca todo y, si ya estaba todo, lo vacía', async () => {
    await render(<Harness />);
    const todos = () => screen.getByRole('togglebutton', { name: 'Todos' });
    await fireEvent.press(todos());
    expect(checked('Autorizado')).toBe(true);
    expect(checked('En trámite')).toBe(true);
    await fireEvent.press(todos());
    expect(checked('No autorizado')).toBe(false);
  });
});

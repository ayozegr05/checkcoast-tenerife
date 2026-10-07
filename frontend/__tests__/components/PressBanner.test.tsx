import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import PressBanner from '../../components/beach/PressBanner';
import { groupNewsItems } from '../../lib/news';
import { news } from '../../test/fixtures';

type Props = React.ComponentProps<typeof PressBanner>;

const press = {
  main: 'Cerrada por contaminación · desde el 01/07',
  sub: 'según prensa · 2 medios',
  tone: 'closure',
} as unknown as Props['press'];

const props = (over: Partial<Props> = {}): Props => ({
  press,
  reopened: false,
  groups: groupNewsItems([news({ title: 'Cierran Playa Jardín' })]),
  itemCount: 1,
  open: false,
  onToggle: jest.fn(),
  ...over,
});

describe('<PressBanner />', () => {
  it('plegado: resumen y botón con el número de titulares', async () => {
    const p = props({ itemCount: 3 });
    await render(<PressBanner {...p} />);
    expect(screen.getByText(press.main)).toBeTruthy();
    expect(screen.getByText(press.sub)).toBeTruthy();
    expect(screen.getByText('Ver titulares (3) ▾')).toBeTruthy();
    expect(screen.queryByText('Cierran Playa Jardín')).toBeNull();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver 3 titulares de prensa' }),
    );
    expect(p.onToggle).toHaveBeenCalled();
  });

  it('desplegado: titulares y aviso de que la prensa no es oficial', async () => {
    await render(<PressBanner {...props({ open: true })} />);
    expect(screen.getByText('Cierran Playa Jardín')).toBeTruthy();
    expect(
      screen.getByText(
        'Contexto de prensa: no altera el estado oficial (Náyade)',
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Ocultar titulares de prensa' }),
    ).toBeTruthy();
  });
});

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { BackHandler } from 'react-native';

import HelpHub from '../../components/HelpHub';

describe('<HelpHub />', () => {
  afterEach(() => jest.restoreAllMocks());

  it('muestra el índice de temas y la tarjeta de bienvenida', async () => {
    const onShowIntro = jest.fn();
    await render(<HelpHub onClose={jest.fn()} onShowIntro={onShowIntro} />);
    expect(screen.getByText('Guía')).toBeTruthy();
    for (const t of [
      'El mapa',
      'Playas y fichas',
      'Emisarios',
      'Municipios',
      'Noticias',
    ]) {
      expect(
        screen.getByRole('button', { name: `Ayuda sobre ${t}` }),
      ).toBeTruthy();
    }
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver la tarjeta de bienvenida' }),
    );
    expect(onShowIntro).toHaveBeenCalled();
  });

  it('sin onShowIntro no ofrece la tarjeta de bienvenida', async () => {
    await render(<HelpHub onClose={jest.fn()} />);
    expect(
      screen.queryByRole('button', { name: 'Ver la tarjeta de bienvenida' }),
    ).toBeNull();
  });

  it('abre un tema y vuelve al índice', async () => {
    await render(<HelpHub onClose={jest.fn()} />);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ayuda sobre Emisarios' }),
    );
    expect(
      screen.getByText('Los 180 vertidos de la isla y su estado legal'),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Ayuda sobre El mapa' }),
    ).toBeNull();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Volver al índice de la guía' }),
    );
    expect(
      screen.getByRole('button', { name: 'Ayuda sobre El mapa' }),
    ).toBeTruthy();
  });

  it('el atrás del sistema vuelve al índice desde un tema', async () => {
    const handlers: (() => boolean | null | undefined)[] = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, h) => {
      handlers.push(h);
      return { remove: jest.fn() };
    });
    await render(<HelpHub onClose={jest.fn()} />);
    expect(handlers.at(-1)!()).toBe(false);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ayuda sobre Noticias' }),
    );
    let handled: boolean | null | undefined;
    await act(async () => {
      handled = handlers.at(-1)!();
    });
    expect(handled).toBe(true);
    expect(
      screen.getByText('Elige un tema para ver cómo funciona'),
    ).toBeTruthy();
  });

  it('el botón cerrar llama a onClose', async () => {
    const onClose = jest.fn();
    await render(<HelpHub onClose={onClose} />);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Cerrar la guía' }),
    );
    expect(onClose).toHaveBeenCalled();
  });
});

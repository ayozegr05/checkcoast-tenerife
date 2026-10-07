import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import IntroCard from '../../components/IntroCard';

describe('<IntroCard />', () => {
  it('«Entendido» cierra sin marcar la casilla por defecto', async () => {
    const onClose = jest.fn();
    await render(<IntroCard onClose={onClose} />);
    expect(screen.getByText('CheckCoast Tenerife')).toBeTruthy();
    expect(screen.getByText(/no una\s+garantía/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Entendido'));
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('«No mostrar al inicio» se refleja en el checkbox y en onClose', async () => {
    const onClose = jest.fn();
    await render(<IntroCard onClose={onClose} />);
    const box = screen.getByRole('checkbox');
    expect(box).not.toBeChecked();
    await fireEvent.press(box);
    expect(box).toBeChecked();
    await fireEvent.press(screen.getByText('Entendido'));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('en modo revisita navega con volver y cerrar, sin pie', async () => {
    const onClose = jest.fn();
    const onBack = jest.fn();
    await render(<IntroCard onClose={onClose} revisit onBack={onBack} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('Entendido')).toBeNull();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Volver a la guía' }),
    );
    expect(onBack).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalledWith(false);
  });
});

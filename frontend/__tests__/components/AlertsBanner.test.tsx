import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import AlertsBanner from '../../components/map/AlertsBanner';
import { STRUCTURAL_SECTION, type AlertSection } from '../../lib/mapData';
import { beach, episode } from '../../test/fixtures';

const props = (over: Partial<React.ComponentProps<typeof AlertsBanner>>) => ({
  closedCount: 0,
  warningCount: 0,
  alertsOpen: false,
  alertCount: 0,
  alertSections: [] as AlertSection[],
  resueltas: [],
  onPress: jest.fn(),
  onOpenAlertBeach: jest.fn(),
  onOpenEpisodeBeach: jest.fn(),
  ...over,
});

describe('<AlertsBanner />', () => {
  it('sin incidencias: pill verde sin desplegable', async () => {
    const p = props({ alertsOpen: true });
    await render(<AlertsBanner {...p} />);
    expect(screen.getByText('Todas las playas sin incidencias')).toBeTruthy();
    expect(screen.queryByText(/Activas ahora/)).toBeNull();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Resumen del estado de las playas' }),
    );
    expect(p.onPress).toHaveBeenCalledTimes(1);
  });

  it('cerrado: resume cerradas y avisos con singular/plural', async () => {
    await render(
      <AlertsBanner {...props({ closedCount: 2, warningCount: 1 })} />,
    );
    expect(screen.getByText('2 cerradas · 1 aviso ▾')).toBeTruthy();
    expect(screen.queryByText(/Activas ahora/)).toBeNull();
  });

  it('abierto: lista alertas y reabiertas y abre su ficha', async () => {
    const closed = beach(1, 'Playa Jardín', {
      status: 'closed',
      alert_cause: 'Contaminación fecal',
    });
    const warn = beach(2, 'Playa Chica', { status: 'warning' });
    const p = props({
      closedCount: 1,
      warningCount: 1,
      alertsOpen: true,
      alertCount: 2,
      alertSections: [
        ['Contaminación', [closed]],
        ['Avisos', [warn]],
      ],
      resueltas: [episode({ beach_id: 42, beach_name: 'Playa Benijo' })],
      onOpenTemporada: jest.fn(),
    });
    await render(<AlertsBanner {...p} />);

    expect(screen.getByText('1 cerrada · 1 aviso ▴')).toBeTruthy();
    expect(screen.getByText('Activas ahora · 2')).toBeTruthy();
    expect(screen.getByText('Contaminación fecal')).toBeTruthy();
    expect(screen.getByText('Reabiertas recientemente · 1')).toBeTruthy();

    await fireEvent.press(
      screen.getByRole('button', { name: 'Playa Jardín, cerrada' }),
    );
    expect(p.onOpenAlertBeach).toHaveBeenCalledWith(closed);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Playa Benijo, reabierta' }),
    );
    expect(p.onOpenEpisodeBeach).toHaveBeenCalledWith(42);
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Ver todos los episodios del verano',
      }),
    );
    expect(p.onOpenTemporada).toHaveBeenCalledTimes(1);
  });

  it('pliega los cierres estructurales antiguos en «N más»', async () => {
    const old = Array.from({ length: 6 }, (_, i) =>
      beach(100 + i, `Playa Estructural ${i + 1}`, {
        status: 'closed',
        alerted_at: '2024-07-01',
        municipality: i < 3 ? 'Arona' : 'Adeje',
      }),
    );
    await render(
      <AlertsBanner
        {...props({
          closedCount: 6,
          alertsOpen: true,
          alertCount: 6,
          alertSections: [[STRUCTURAL_SECTION, old]],
        })}
      />,
    );
    expect(screen.getByText('Playa Estructural 3')).toBeTruthy();
    expect(screen.queryByText('Playa Estructural 4')).toBeNull();
    expect(screen.getByText('3 más')).toBeTruthy();

    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver 3 cierres estructurales más' }),
    );
    expect(screen.getByText('Playa Estructural 6')).toBeTruthy();
    expect(screen.getByText('Ver menos')).toBeTruthy();
  });
});

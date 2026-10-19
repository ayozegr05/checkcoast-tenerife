import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import IncidentHistory from '../../components/beach/IncidentHistory';
import { incident, news } from '../../test/fixtures';

// Incidentes antiguos (fuera de «este año» y de «últimos 5 años»): el
// resumen no depende de la fecha en que corre el test
const incidents = [
  incident({ id: 1, opened_at: '2015-08-01', closed_at: '2015-08-04' }),
  incident({
    id: 2,
    opened_at: '2015-06-10',
    closed_at: '2015-06-11',
    observations: 'Se recomienda no bañarse',
  }),
  incident({
    id: 3,
    opened_at: '2014-07-01',
    closed_at: '2014-07-02',
    via: 'press',
    observations: null,
    press_items: [news({ id: 9, title: 'Cierran la playa por vertido' })],
  }),
  incident({
    id: 4,
    opened_at: '2014-05-01',
    closed_at: null,
    observations: 'Sin Calificar',
  }),
  incident({
    id: 5,
    opened_at: '2015-09-01',
    closed_at: '2015-09-02',
    attributed_pm: 'PM4',
  }),
];

describe('<IncidentHistory />', () => {
  it('resumen de cifras sin contar la zona hermana', async () => {
    await render(
      <IncidentHistory
        incidents={incidents}
        openIncs={new Set()}
        onToggleIncident={jest.fn()}
      />,
    );
    expect(screen.getByText('Historial de incidencias (5)')).toBeTruthy();
    // 2 cierres propios (oficial prohibido + prensa), 1 aviso, 1 sin calificar
    expect(screen.getByText('2 cierres')).toBeTruthy();
    expect(screen.getByText('1 aviso')).toBeTruthy();
    expect(screen.getByText('1 sin calificar')).toBeTruthy();
    expect(
      screen.getByText(
        'Este año: sin episodios  ·  Últimos 5 años: sin episodios',
      ),
    ).toBeTruthy();
  });

  it('agrupa por año con etiquetas, fechas y zona hermana aparte', async () => {
    await render(
      <IncidentHistory
        incidents={incidents}
        openIncs={new Set()}
        onToggleIncident={jest.fn()}
      />,
    );
    expect(screen.getByText('2015')).toBeTruthy();
    expect(screen.getByText('2014')).toBeTruthy();
    // Cierres con badge de causa (sin "Cerrada" — se
    // sobreentiende), avisos/sin calificar con etiqueta; las causas
    // van debajo (fallback "Contaminación"; la muestra sin
    // calificar no lleva causa)
    expect(screen.queryByText('Cerrada')).toBeNull();
    expect(screen.getAllByTestId('incident-badge')).toHaveLength(3);
    expect(screen.getByText('Aviso')).toBeTruthy();
    expect(screen.getByText('Sin calificar')).toBeTruthy();
    expect(screen.getAllByTestId('incident-cause')).toHaveLength(4);
    expect(screen.getByText('01/08/2015 → 04/08/2015 · 4 días')).toBeTruthy();
    expect(
      screen.getByText('Muestra tomada pero nunca clasificada por Sanidad'),
    ).toBeTruthy();
    expect(screen.getByText('En la zona 4')).toBeTruthy();
    expect(screen.getByText('Ocurrió en la zona 4')).toBeTruthy();
  });

  it('despliega los titulares del episodio', async () => {
    const onToggle = jest.fn();
    const { rerender } = await render(
      <IncidentHistory
        incidents={incidents}
        openIncs={new Set()}
        onToggleIncident={onToggle}
      />,
    );
    expect(screen.queryByText('Cierran la playa por vertido')).toBeNull();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver 1 titulares del episodio' }),
    );
    expect(onToggle).toHaveBeenCalledWith(3);
    await rerender(
      <IncidentHistory
        incidents={incidents}
        openIncs={new Set([3])}
        onToggleIncident={onToggle}
      />,
    );
    expect(screen.getByText('Cierran la playa por vertido')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Ocultar titulares del episodio' }),
    ).toBeTruthy();
  });
});

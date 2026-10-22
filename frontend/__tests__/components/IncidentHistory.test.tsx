import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';

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

// Los años antiguos llegan colapsados (acordeón): los tests que
// miran filas tienen que expandirlos primero
const expandYears = async () => {
  for (;;) {
    const btn = screen
      .queryAllByRole('button')
      .find((b) => (b.props.accessibilityLabel ?? '').includes('expandir'));
    if (!btn) break;
    await fireEvent.press(btn);
  }
};

describe('<IncidentHistory />', () => {
  it('resumen de cifras sin contar la zona hermana', async () => {
    await render(
      <IncidentHistory
        incidents={incidents}
        openIncs={new Set()}
        onToggleIncident={jest.fn()}
      />,
    );
    expect(screen.getByText('Episodios (5)')).toBeTruthy();
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
    await expandYears();
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
    // El detalle "muestra sin clasificar" no aporta: la etiqueta
    // lo dice y no se repite como nota
    expect(
      screen.queryByText('Muestra tomada pero nunca clasificada por Sanidad'),
    ).toBeNull();
    expect(screen.getByText('En la zona 4')).toBeTruthy();
    expect(screen.getByText('Ocurrió en la zona 4')).toBeTruthy();
  });

  it('episodio de laboratorio mudo: badge propio, ni cierre ni aviso', async () => {
    const lab = incident({
      id: 9,
      opened_at: '2015-10-01',
      closed_at: '2015-10-20',
      via: 'measurement',
      observations: 'Laboratorio: muestra no apta · Sin cierre oficial',
    });
    await render(
      <IncidentHistory
        incidents={[lab]}
        openIncs={new Set()}
        onToggleIncident={jest.fn()}
      />,
    );
    // Icono propio (tubo + aviso) + etiqueta, jamás "Cierre"
    await expandYears();
    expect(screen.getAllByTestId('incident-badge')).toHaveLength(1);
    expect(screen.getByText('Agua no apta')).toBeTruthy();
    expect(screen.queryByText('Aviso')).toBeNull();
    // El resumen lo cuenta aparte, con nombre propio de muestra
    expect(screen.getByText('1 muestra no apta')).toBeTruthy();
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
    await expandYears();
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

  it('deep-link municipal: abre el año del episodio y resalta su fila', async () => {
    // >10 episodios → el acordeón existe y los años antiguos llegan
    // colapsados; el foco apunta a un episodio de 2014
    const many = [
      incident({ id: 3, opened_at: '2014-07-01', closed_at: '2014-07-02' }),
      incident({ id: 4, opened_at: '2013-05-01', closed_at: '2013-05-02' }),
      ...Array.from({ length: 10 }, (_, i) =>
        incident({
          id: 100 + i,
          opened_at: `2020-0${(i % 9) + 1}-10`,
          closed_at: `2020-0${(i % 9) + 1}-12`,
        }),
      ),
    ];
    await render(
      <IncidentHistory
        incidents={many}
        openIncs={new Set()}
        onToggleIncident={jest.fn()}
        focus={{ beach_id: 1, id: 3, opened_at: '2014-07-01' }}
        scrollRef={{ current: null }}
      />,
    );
    // El año del episodio llega desplegado sin tocar el acordeón…
    expect(screen.getByText('01/07/2014 → 02/07/2014 · 2 días')).toBeTruthy();
    // …mientras el resto de años antiguos siguen colapsados
    expect(screen.queryByText('01/05/2013 → 02/05/2013 · 2 días')).toBeNull();
    expect(screen.queryByText('10/01/2020 → 12/01/2020 · 3 días')).toBeNull();
    // La fila objetivo va marcada con el velo de su color de acento
    const row = screen.getByTestId('incident-focused');
    const style = StyleSheet.flatten(row.props.style);
    expect(style.backgroundColor.startsWith(style.borderLeftColor)).toBe(true);
  });
});

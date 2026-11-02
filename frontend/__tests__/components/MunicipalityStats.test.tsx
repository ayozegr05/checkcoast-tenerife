import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import MunicipalityStats from '../../components/MunicipalityStats';
import { fetchBeachStats, fetchMunicipalityIncidents } from '../../lib/api';
import { beach, episode } from '../../test/fixtures';

jest.mock('../../lib/api', () => ({
  ...jest.requireActual<typeof import('../../lib/api')>('../../lib/api'),
  fetchBeachStats: jest.fn(),
  fetchMunicipalityIncidents: jest.fn(),
}));

const beaches = [
  beach(1, 'Playa Las Vistas', { status: 'open' }),
  beach(2, 'Playa Jardín', {
    municipality: 'Puerto de la Cruz',
    status: 'open',
  }),
  beach(3, 'Playa El Camisón', { status: 'open' }),
];

const episodes = [
  episode({
    id: 1,
    beach_id: 1,
    beach_name: 'Playa Las Vistas',
    municipality: 'Arona',
    opened_at: '2025-07-10',
    closed_at: '2025-07-12',
    cause: 'Contaminación',
  }),
  episode({
    id: 2,
    beach_id: 2,
    beach_name: 'Playa Jardín',
    kind: 'warning',
    opened_at: '2025-03-01',
    closed_at: '2025-03-02',
  }),
  episode({
    id: 3,
    beach_id: 3,
    beach_name: 'Playa El Camisón',
    municipality: 'Arona',
    opened_at: '2024-08-01',
    closed_at: '2024-08-02',
    cause: 'Mar agitado',
  }),
];

const muniNames = () =>
  screen
    .getAllByRole('button', { name: /, posición \d+ de \d+/ })
    .map((r) => r.props.accessibilityLabel.split(',')[0]);
const episodeNames = () =>
  screen
    .getAllByRole('button', { name: /^Ver ficha de / })
    .map((r) => r.props.accessibilityLabel.replace('Ver ficha de ', ''));

const props = (
  over: Partial<React.ComponentProps<typeof MunicipalityStats>> = {},
): React.ComponentProps<typeof MunicipalityStats> => ({
  visible: true,
  beaches,
  episodes,
  onSelect: jest.fn(),
  onSelectBeach: jest.fn(),
  onClose: jest.fn(),
  ...over,
});

describe('<MunicipalityStats />', () => {
  // Los selectores de año llegan hasta el año en curso: se fija el reloj
  // (solo Date) para que el test no dependa de cuándo se ejecuta
  beforeEach(() => {
    jest.useFakeTimers({
      now: new Date('2025-10-15T12:00:00Z'),
      doNotFake: [
        'nextTick',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'hrtime',
        'performance',
      ],
    });
    jest.mocked(fetchBeachStats).mockReset().mockResolvedValue([]);
    jest.mocked(fetchMunicipalityIncidents).mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('cerrado no pinta nada', async () => {
    await render(<MunicipalityStats {...props({ visible: false })} />);
    expect(screen.queryByText('Incidencias de baño')).toBeNull();
  });

  it('abre el ranking en el año en curso', async () => {
    await render(<MunicipalityStats {...props()} />);
    expect(
      screen.getByText('Cierres y avisos de baño en Tenerife'),
    ).toBeTruthy();
    // El conteo del año vive en la cara de la faceta, no en una
    // línea redundante de la cabecera
    expect(screen.getByRole('button', { name: 'Año: 2025 (2)' })).toBeTruthy();
    expect(muniNames()).toEqual(['Arona', 'Puerto de la Cruz']);
  });

  it('las chips de año cambian el ranking; «Histórico» muestra el total', async () => {
    await render(<MunicipalityStats {...props()} />);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Año: 2025 (2)' }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Ver año 2024' }));
    expect(screen.getByRole('button', { name: 'Año: 2024 (1)' })).toBeTruthy();
    expect(muniNames()).toEqual(['Arona']);

    await fireEvent.press(
      screen.getByRole('button', { name: 'Año: 2024 (1)' }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver histórico completo' }),
    );
    // La cara de la faceta confirma el modo histórico
    expect(
      screen.getByRole('button', { name: 'Año: Histórico (3)' }),
    ).toBeTruthy();
    // El histórico usa el diseño de episodios con ámbito total —
    // badges de cierres/avisos + playas afectadas, no el vivo
    expect(screen.getByText('2 cierres')).toBeTruthy();
    expect(screen.getByText('1 aviso')).toBeTruthy();
    expect(screen.getByText('1 de 1 playa afectada')).toBeTruthy();
    expect(screen.getByText('2 de 2 playas afectadas')).toBeTruthy();
    expect(
      screen.getByText('Playa El Camisón · Playa Las Vistas'),
    ).toBeTruthy();
    // Titular insular del ámbito: episodios + municipios + abiertos
    expect(
      screen.getByText(
        '3 episodios desde 2024 · 2 de 2 municipios con playa afectados',
      ),
    ).toBeTruthy();
  });

  it('faceta Municipio: índice alfabético para saltar a uno', async () => {
    await render(<MunicipalityStats {...props()} />);
    // Primera faceta del ranking — solo existe en esta vista
    expect(
      screen.getByRole('button', { name: 'Municipio: Todos' }),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Municipio: Todos' }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver solo Puerto de la Cruz' }),
    );
    expect(
      screen.getByRole('button', { name: 'Municipio: Puerto de la Cruz' }),
    ).toBeTruthy();
    expect(muniNames()).toEqual(['Puerto de la Cruz']);
    // «Todos» restaura el ranking completo
    await fireEvent.press(
      screen.getByRole('button', { name: 'Municipio: Puerto de la Cruz' }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver todos los municipios' }),
    );
    expect(muniNames()).toEqual(['Arona', 'Puerto de la Cruz']);
  });

  it('faceta Municipio acota el ranking al elegir una chip', async () => {
    await render(<MunicipalityStats {...props()} />);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Municipio: Todos' }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver solo Puerto de la Cruz' }),
    );
    expect(muniNames()).toEqual(['Puerto de la Cruz']);
  });

  it('vista «Año»: cronología filtrable por causa', async () => {
    const p = props();
    await render(<MunicipalityStats {...p} />);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver cronología de episodios' }),
    );
    expect(episodeNames()).toEqual(['Playa Las Vistas', 'Playa Jardín']);
    await fireEvent.press(screen.getByRole('button', { name: 'Causa: Todos' }));
    await fireEvent.press(
      screen.getByRole('button', { name: 'Filtrar por Contaminación' }),
    );
    expect(episodeNames()).toEqual(['Playa Las Vistas']);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver ficha de Playa Las Vistas' }),
    );
    expect(p.onSelectBeach).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ beach_id: 1 }),
    );
    // Las chips de año cuentan dentro de la causa activa: 2025 solo
    // tiene 1 episodio de contaminación, 2024 ninguno
    await fireEvent.press(
      screen.getByRole('button', { name: 'Año: 2025 (1)' }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Ver año 2024' }));
    expect(screen.getByRole('button', { name: 'Año: 2024 (0)' })).toBeTruthy();
    expect(screen.getByText('Sin episodios en 2024')).toBeTruthy();
  });

  it('ventana Verano: solo episodios de junio a septiembre', async () => {
    await render(<MunicipalityStats {...props({ initialView: 'verano' })} />);
    expect(episodeNames()).toEqual(['Playa Las Vistas']);
    // Verano 2025 tiene un único episodio (cierre): «1 cierre»
    // filtraría lo mismo que «Todos» — solo queda el total
    expect(screen.getByText('Todos (1)')).toBeTruthy();
    expect(screen.queryByText('1 cierre')).toBeNull();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Año: 2025 (1)' }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver verano 2024' }),
    );
    expect(screen.getByRole('button', { name: 'Año: 2024 (1)' })).toBeTruthy();
    expect(episodeNames()).toEqual(['Playa El Camisón']);
  });

  it('abre con una causa preseleccionada desde el banner', async () => {
    await render(
      <MunicipalityStats
        {...props({ initialView: 'año', initialCause: 'Contaminación' })}
      />,
    );
    expect(episodeNames()).toEqual(['Playa Las Vistas']);
  });

  it('detalle de municipio: entra, vuelve y abre sus playas', async () => {
    const p = props();
    await render(<MunicipalityStats {...p} />);
    await fireEvent.press(
      screen.getByRole('button', { name: /^Arona, posición 1/ }),
    );
    expect(fetchMunicipalityIncidents).toHaveBeenCalledWith('Arona');
    expect(await screen.findByText('Sin incidentes registrados')).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('link', { name: 'Ver playas del municipio' }),
    );
    expect(p.onSelect).toHaveBeenCalledWith('Arona');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Volver al ranking' }),
    );
    expect(screen.getByText('Incidencias de baño')).toBeTruthy();
  });

  it('si el año en curso no tiene episodios abre el último con datos', async () => {
    jest.setSystemTime(new Date('2026-03-01T12:00:00Z'));
    await render(<MunicipalityStats {...props()} />);
    expect(
      screen.getByText('Cierres y avisos de baño en Tenerife'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Año: 2025 (2)' })).toBeTruthy();
    expect(muniNames()).toEqual(['Arona', 'Puerto de la Cruz']);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Año: 2025 (2)' }),
    );
    expect(screen.getByRole('button', { name: 'Ver año 2026' })).toBeTruthy();
  });

  it('sin episodios abre el histórico; la ✕ cierra', async () => {
    const p = props({ episodes: [] });
    await render(<MunicipalityStats {...p} />);
    expect(screen.queryByRole('button', { name: /^Ver año/ })).toBeNull();
    // Sin años con datos no hay facetas — el histórico es el estado
    // implícito y las filas se enseñan sin vacío de año
    expect(screen.queryByRole('button', { name: /^Año:/ })).toBeNull();
    expect(
      screen.getByText('Cierres y avisos de baño en Tenerife'),
    ).toBeTruthy();
    expect(screen.queryByText(/^Sin episodios en/)).toBeNull();
    await fireEvent.press(screen.getByText('✕'));
    expect(p.onClose).toHaveBeenCalled();
  });

  it('«Tipo» son chips siempre visibles en las cronologías', async () => {
    await render(<MunicipalityStats {...props()} />);
    expect(screen.getByRole('button', { name: 'Año: 2025 (2)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Causa: Todos' })).toBeTruthy();
    // En el ranking no hay chips de tipo — el desglose ya vive en
    // las filas
    expect(
      screen.queryByRole('button', { name: /^Filtrar por cierres?$/ }),
    ).toBeNull();
    // En las cronologías sí: «Año» cuenta 1 cierre + 1 aviso en 2025
    // — ambos segmentos discriminan y aparecen
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver cronología de episodios' }),
    );
    expect(
      screen.getByRole('button', { name: 'Filtrar por cierre' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Filtrar por aviso' }),
    ).toBeTruthy();
    // En Verano 2025 solo hay 1 episodio: ningún segmento añade
    // discriminación sobre «Todos» — la barra se queda en el total
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver episodios de verano' }),
    );
    expect(
      screen.queryByRole('button', { name: 'Filtrar por cierre' }),
    ).toBeNull();
    expect(screen.getByText('Todos (1)')).toBeTruthy();
  });

  it('«Verano» filtra jun-sep y su «Histórico» junta todos los veranos', async () => {
    await render(<MunicipalityStats {...props({ initialView: 'verano' })} />);
    expect(episodeNames()).toEqual(['Playa Las Vistas']);
    // Cambiar de pestaña = cambiar de ventana: entra el episodio de marzo
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver cronología de episodios' }),
    );
    expect(episodeNames()).toEqual(['Playa Las Vistas', 'Playa Jardín']);
    // Histórico en la pestaña «Año»: los tres episodios registrados
    await fireEvent.press(
      screen.getByRole('button', { name: 'Año: 2025 (2)' }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver histórico completo' }),
    );
    expect(episodeNames()).toEqual([
      'Playa Las Vistas',
      'Playa Jardín',
      'Playa El Camisón',
    ]);
    // Histórico en «Verano» = todos los veranos (jun-sep) registrados:
    // entra el Camisón de 2024 pero no el Jardín de marzo
    await fireEvent.press(
      screen.getByRole('button', { name: 'Ver episodios de verano' }),
    );
    expect(episodeNames()).toEqual(['Playa Las Vistas', 'Playa El Camisón']);
  });

  it('elegir en una faceta cierra su panel; solo una abierta a la vez', async () => {
    await render(<MunicipalityStats {...props()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Causa: Todos' }));
    expect(
      screen.getByRole('button', { name: 'Filtrar por Contaminación' }),
    ).toBeTruthy();
    // Abrir otra pestaña sustituye el panel — nunca dos abiertos
    await fireEvent.press(
      screen.getByRole('button', { name: 'Año: 2025 (2)' }),
    );
    expect(
      screen.queryByRole('button', { name: 'Filtrar por Contaminación' }),
    ).toBeNull();
    // Single-select: elegir cierra y la cara refleja la selección
    await fireEvent.press(screen.getByRole('button', { name: 'Ver año 2024' }));
    expect(screen.queryByRole('button', { name: 'Ver año 2025' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Año: 2024 (1)' })).toBeTruthy();
  });
});

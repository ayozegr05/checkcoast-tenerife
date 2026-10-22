// Tests del resumen "según prensa": el cierre se cuenta en presente
// solo mientras siga vivo; si Sanidad lo cerró, pasa a pasado y cita
// la fecha de reapertura oficial.

import { describe, expect, it } from '@jest/globals';

import type { BeachNews, BeachNewsSummary } from '../lib/api';
import { anchorIsNewClosureWave, pressSummary } from '../lib/press';

const summary = (s: Partial<BeachNewsSummary>): BeachNewsSummary => ({
  event_type: 'closure',
  cause: 'riesgo de desprendimientos',
  items_count: 13,
  outlets_count: 9,
  since: '2026-06-03T10:00:00Z',
  ...s,
});

describe('pressSummary — ciclo de vida del cierre', () => {
  it('cerrada ahora: presente + "desde el" + días que lleva', () => {
    const r = pressSummary(summary({}), {
      stillClosed: true,
      reopenedAt: null,
      now: new Date('2026-09-27T12:00:00Z'),
    });
    expect(r.main).toBe(
      'Cerrada por riesgo de desprendimientos\n' +
        'desde el 03/06/2026 · lleva 117 días',
    );
    expect(r.sub).toBe('según prensa · 9 medios');
  });

  it('cierre resuelto: pasado + rango completo + días', () => {
    const r = pressSummary(
      summary({
        cause: 'vertido de gasoil',
        since: '2026-08-21T08:00:00Z',
        outlets_count: 1,
      }),
      {
        stillClosed: false,
        reopenedAt: '2026-08-26',
        now: new Date('2026-10-01T12:00:00Z'),
      },
    );
    expect(r.main).toBe(
      'Estuvo cerrada por vertido de gasoil\n' +
        'del 21/08/2026 al 26/08/2026 · 6 días',
    );
    expect(r.sub).toBe('según prensa · 1 medio');
  });

  it('cierre pasado sin reapertura oficial registrada', () => {
    const r = pressSummary(summary({}), {
      stillClosed: false,
      reopenedAt: null,
    });
    expect(r.main).toBe(
      'Estuvo cerrada por riesgo de desprendimientos · el 03/06/2026',
    );
    expect(r.sub).toBe('según prensa · 9 medios');
  });

  it('reapertura reciente (≤7d): banner verde con ambas fechas', () => {
    const r = pressSummary(
      summary({ cause: 'contaminación', since: '2026-09-23T08:00:00Z' }),
      {
        stillClosed: false,
        reopenedAt: '2026-09-25',
        now: new Date('2026-09-26T12:00:00Z'),
      },
    );
    expect(r.tone).toBe('reopened');
    expect(r.main).toBe('Reabierta el 25/09/2026');
    expect(r.sub).toBe(
      'según prensa · 9 medios · estuvo cerrada desde el ' +
        '23/09/2026 · ~3 días',
    );
  });

  it('reapertura de hace >7d: vuelve al modo pasado normal', () => {
    const r = pressSummary(summary({}), {
      stillClosed: false,
      reopenedAt: '2026-06-10',
      now: new Date('2026-09-26T12:00:00Z'),
    });
    expect(r.tone).toBe('default');
    expect(r.main).toContain('Estuvo cerrada');
  });

  it('reapertura como evento dominante', () => {
    const r = pressSummary(
      summary({ event_type: 'reopening', cause: 'obras autorizadas' }),
      { stillClosed: false, reopenedAt: null },
    );
    expect(r.main).toBe('Reapertura tras obras autorizadas · el 03/06/2026');
  });

  it('sin causa ni fecha: solo el evento', () => {
    const r = pressSummary(summary({ cause: null, since: null }), {
      stillClosed: true,
      reopenedAt: null,
    });
    expect(r.main).toBe('Cerrada');
  });

  it('closed_since parcial gana a la fecha de cobertura (Benijo)', () => {
    // El texto afirma "cerrada desde julio de 2024" aunque los
    // titulares sean de 2026: el banner muestra el inicio real
    const r = pressSummary(
      summary({
        since: '2026-07-31T10:00:00Z',
        closed_since: '2024-07',
      }),
      {
        stillClosed: true,
        reopenedAt: null,
        now: new Date('2026-07-01T12:00:00Z'),
      },
    );
    expect(r.main).toBe(
      'Cerrada por riesgo de desprendimientos\n' +
        'desde jul-2024 · lleva ~2 años',
    );
  });

  it('closed_since de solo año: "desde 2024"', () => {
    const r = pressSummary(
      summary({ since: '2026-05-21T10:00:00Z', closed_since: '2024' }),
      {
        stillClosed: true,
        reopenedAt: null,
        now: new Date('2026-01-01T12:00:00Z'),
      },
    );
    expect(r.main).toBe(
      'Cerrada por riesgo de desprendimientos\n' + 'desde 2024 · lleva ~2 años',
    );
  });

  it('closed_since con fecha completa: formato dd/mm/aaaa', () => {
    const r = pressSummary(
      summary({
        since: '2026-05-21T10:00:00Z',
        closed_since: '2024-07-15',
      }),
      {
        stillClosed: true,
        reopenedAt: null,
        now: new Date('2026-07-15T12:00:00Z'),
      },
    );
    expect(r.main).toBe(
      'Cerrada por riesgo de desprendimientos\n' +
        'desde el 15/07/2024 · lleva 2 años',
    );
  });

  it('reabierta: "estuvo cerrada desde jul-2024" con closed_since', () => {
    const r = pressSummary(
      summary({
        since: '2026-05-21T10:00:00Z',
        closed_since: '2024-07',
      }),
      {
        stillClosed: false,
        reopenedAt: '2026-09-25',
        now: new Date('2026-09-26T12:00:00Z'),
      },
    );
    expect(r.tone).toBe('reopened');
    expect(r.sub).toBe(
      'según prensa · 9 medios · estuvo cerrada desde jul-2024 ' +
        '· ~2 años y 3 meses',
    );
  });
});

describe('anchorIsNewClosureWave — día-frontera', () => {
  const item = (
    day: string,
    source: string,
    event_type = 'closure',
  ): BeachNews => ({
    id: 1,
    beach_id: 1,
    title: 't',
    url: 'u',
    source,
    published_at: `${day}T12:00:00Z`,
    event_type,
    cause: null,
  });

  it('ola corroborada el día del ancla → episodio nuevo', () => {
    // Jardín 07/10: 5 medios contaron el 4º cierre la tarde del día
    // que Sanidad reabría
    const items = ['eldia', 'diario', 'canarias7', 'ep', 'atv'].map((s) =>
      item('2026-10-07', s),
    );
    expect(anchorIsNewClosureWave(items, summary({}), '2026-10-07')).toBe(true);
  });

  it('pieza suelta en día de reapertura → cobertura vieja', () => {
    const items = [item('2026-09-30', 'eldia'), item('2026-10-07', 'eldia')];
    expect(anchorIsNewClosureWave(items, summary({}), '2026-10-07')).toBe(
      false,
    );
  });

  it('closed_since posterior al ancla prueba el episodio nuevo', () => {
    const items = [item('2026-10-07', 'eldia')];
    expect(
      anchorIsNewClosureWave(
        items,
        summary({ closed_since: '2026-10-08' }),
        '2026-10-07',
      ),
    ).toBe(true);
  });

  it('reaperturas y otros días no corroboran', () => {
    const items = [
      item('2026-10-07', 'eldia'),
      item('2026-10-07', 'diario', 'reopening'),
      item('2026-10-08', 'canarias7'),
    ];
    expect(anchorIsNewClosureWave(items, summary({}), '2026-10-07')).toBe(
      false,
    );
  });
});

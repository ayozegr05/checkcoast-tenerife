import { describe, expect, it } from '@jest/globals';

import { pointLongLabel } from '../lib/format';
import { siblingZoneRef, zoneName } from '../lib/zones';

describe('zonas con nombre propio (Playa Jardín)', () => {
  it('resuelve el nombre común de cada cala', () => {
    expect(zoneName('PLAYA JARDIN PM1')).toBe('El Castillo');
    expect(zoneName('PLAYA JARDIN PM5')).toBe('El Charcón');
    expect(zoneName('PLAYA JARDIN PM4')).toBe('Punta Brava');
  });

  it('resuelve el PM hermano dentro del mismo complejo', () => {
    // Ficha de PM1 hablando del episodio de PM4
    expect(zoneName('PLAYA JARDIN PM1', 'PM4')).toBe('Punta Brava');
  });

  it('devuelve null fuera de complejos mapeados', () => {
    expect(zoneName('PLAYA MEDANO (EL) PM3', 'PM9')).toBeNull();
    expect(zoneName('PLAYA JARDIN PM1', 'PM9')).toBeNull();
    expect(zoneName('PLAYA RISCO (EL) PM1')).toBeNull();
  });

  it('siblingZoneRef cae a "zona N" sin mapa', () => {
    expect(siblingZoneRef('PLAYA JARDIN PM1', 'PM4')).toBe('cala Punta Brava');
    expect(siblingZoneRef('PLAYA RISCO (EL) PM1', 'PM4')).toBe('zona 4');
  });

  it('pointLongLabel usa el nombre de la cala', () => {
    expect(pointLongLabel('PLAYA JARDIN PM4')).toBe('Punta Brava');
    expect(pointLongLabel('PLAYA MEDANO (EL) PM3')).toBe('Playa central');
  });
});

describe('arenal del Médano (calas con nombre propio)', () => {
  it('las tres zonas resuelven nombre propio aunque dos sean PM1', () => {
    expect(zoneName('PLAYA MEDANO (EL) PM3')).toBe('Playa central');
    expect(zoneName('PLAYA MEDANO (EL)-CHICA PM1')).toBe('Playa Chica');
    expect(zoneName('PLAYA MEDANO (EL)-LEOCADIO MACHADO PM1')).toBe(
      'Leocadio Machado',
    );
  });

  it('la zona hermana se identifica por sufijo, no por número de PM', () => {
    expect(zoneName('PLAYA MEDANO (EL) PM3', 'CHICA')).toBe('Playa Chica');
    expect(zoneName('PLAYA MEDANO (EL) PM3', 'LEOCADIO MACHADO')).toBe(
      'Leocadio Machado',
    );
  });

  it('siblingZoneRef usa la forma narrativa de la cala', () => {
    expect(siblingZoneRef('PLAYA MEDANO (EL) PM3', 'CHICA')).toBe(
      'playa Chica',
    );
    expect(
      siblingZoneRef('PLAYA MEDANO (EL)-CHICA PM1', 'LEOCADIO MACHADO'),
    ).toBe('playa de Leocadio Machado');
    expect(siblingZoneRef('PLAYA MEDANO (EL)-CHICA PM1', 'PM3')).toBe(
      'playa central',
    );
  });
});

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
    expect(zoneName('PLAYA MEDANO (EL) PM3')).toBeNull();
    expect(zoneName('PLAYA JARDIN PM1', 'PM9')).toBeNull();
  });

  it('siblingZoneRef cae a "zona N" sin mapa', () => {
    expect(siblingZoneRef('PLAYA JARDIN PM1', 'PM4')).toBe('cala Punta Brava');
    expect(siblingZoneRef('PLAYA MEDANO (EL) PM3', 'PM4')).toBe('zona 4');
  });

  it('pointLongLabel usa el nombre de la cala', () => {
    expect(pointLongLabel('PLAYA JARDIN PM4')).toBe('Punta Brava');
    expect(pointLongLabel('PLAYA MEDANO (EL) PM3')).toBe('Zona 3');
  });
});

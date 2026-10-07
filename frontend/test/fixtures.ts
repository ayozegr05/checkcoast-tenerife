import type { GeoFeature, MunicipalityIncident } from '../lib/api';

export const beach = (
  id: number,
  name: string,
  props: Partial<GeoFeature['properties']> = {},
): GeoFeature => ({
  type: 'Feature',
  id,
  geometry: { type: 'Point', coordinates: [-16.5, 28.3] },
  properties: { name, municipality: 'Arona', monitored: true, ...props },
});

export const episode = (
  e: Partial<MunicipalityIncident> = {},
): MunicipalityIncident => ({
  id: 1,
  beach_id: 10,
  beach_name: 'Playa Jardín',
  municipality: 'Puerto de la Cruz',
  kind: 'closure',
  opened_at: '2026-07-01',
  closed_at: '2026-07-03',
  observations: null,
  ...e,
});

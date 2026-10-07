import type {
  BeachIncident,
  BeachMeasurement,
  BeachNews,
  BeachStats,
  GeoFeature,
  MunicipalityIncident,
} from '../lib/api';

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

export const outfall = (
  id: number,
  name: string,
  props: Partial<GeoFeature['properties']> = {},
): GeoFeature => ({
  type: 'Feature',
  id,
  geometry: { type: 'Point', coordinates: [-16.25, 28.46] },
  properties: { name, municipality: 'Santa Cruz de Tenerife', ...props },
});

export const news = (n: Partial<BeachNews> = {}): BeachNews => ({
  id: 1,
  beach_id: 10,
  title: 'Cierran Playa Jardín por contaminación',
  url: 'https://example.org/noticia',
  source: 'Diario de Avisos',
  published_at: '2026-07-02T10:00:00Z',
  event_type: 'closure',
  cause: 'Contaminación',
  ...n,
});

export const incident = (i: Partial<BeachIncident> = {}): BeachIncident => ({
  id: 1,
  beach_id: 10,
  opened_at: '2026-07-01',
  closed_at: '2026-07-03',
  observations: 'Baño prohibido por contaminación',
  source_url: null,
  via: 'official',
  ...i,
});

export const measurement = (
  m: Partial<BeachMeasurement> = {},
): BeachMeasurement => ({
  id: 1,
  beach_id: 10,
  sampled_at: '2026-07-01',
  ecoli: '100',
  enterococci: '50',
  evaluation: 'Apta',
  source_url: null,
  ...m,
});

export const stats = (s: Partial<BeachStats> = {}): BeachStats => ({
  beach_id: 10,
  closures: 0,
  warnings: 0,
  closures_last_year: 0,
  bad_samples: 0,
  non_apta_samples: 0,
  contam_episodes: 0,
  total_samples: 0,
  latest_evaluation: null,
  latest_sampled_at: null,
  ...s,
});

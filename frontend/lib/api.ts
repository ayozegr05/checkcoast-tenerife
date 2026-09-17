const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

export type GeoFeature = {
  type: 'Feature';
  id: number;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    name: string;
    municipality?: string | null;
    monitored?: boolean;
    kind?: string | null;
    status?: string | null;
    source_url?: string | null;
    fetched_at?: string | null;
    alert?: boolean;
  };
};

export type FeatureCollection = {
  type: 'FeatureCollection';
  features: GeoFeature[];
};

export type BeachIncident = {
  id: number;
  beach_id: number;
  opened_at: string; // YYYY-MM-DD
  closed_at: string | null;
  observations: string | null;
  source_url: string | null;
};

export type BeachMeasurement = {
  id: number;
  beach_id: number;
  sampled_at: string; // YYYY-MM-DD
  ecoli: string | null;
  enterococci: string | null;
  evaluation: string | null;
  source_url: string | null;
};

export type BeachStats = {
  beach_id: number;
  closures: number;
  warnings: number;
  closures_last_year: number;
  bad_samples: number;
  total_samples: number;
  latest_evaluation: string | null;
  latest_sampled_at: string | null;
};

export type Alert = {
  beach_id: number;
  beach_name: string;
  municipality: string | null;
  status: 'closed' | 'warning';
  reported_at: string | null;
  source_url: string | null;
  longitude: number;
  latitude: number;
};

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`API ${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const fetchOutfalls = () => getJson<FeatureCollection>('/outfalls');
export const fetchBeaches = () => getJson<FeatureCollection>('/beaches');
export const fetchAlerts = () => getJson<Alert[]>('/alerts');
export const fetchBeachIncidents = (beachId: number) =>
  getJson<BeachIncident[]>(`/beaches/${beachId}/incidents`);
export const fetchBeachQuality = (beachId: number) =>
  getJson<BeachMeasurement[]>(`/beaches/${beachId}/quality`);
export const fetchBeachStats = () => getJson<BeachStats[]>('/beaches/stats');

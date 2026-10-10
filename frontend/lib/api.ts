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
    // Detalle del censo de vertidos (emisarios): naturaleza, régimen,
    // estado físico, procedencia, responsable y ubicación legible
    nature?: string | null;
    continuity?: string | null;
    is_active?: boolean | null;
    condition?: string | null;
    origin?: string | null;
    entity?: string | null;
    protected_area?: string | null;
    settlement?: string | null;
    location?: string | null;
    zone_desc?: string | null;
    // Operador del saneamiento (GestSan) + ingeniería de la conducción
    manager?: string | null;
    length_m?: number | null;
    outfall_depth?: number | null;
    // Punto de arranque en tierra: trazado tierra → mar en la ficha
    start_lon?: number | null;
    start_lat?: number | null;
    // Distancia en recta a la costa (derivada, línea de costa OSM)
    shore_m?: number | null;
    status_via?: 'official' | 'press' | null;
    // Causa corta de la alerta viva ("Contaminación", "Desprendimientos")
    // y su procedencia — solo presentes con alerta activa
    alert_cause?: string | null;
    cause_via?: 'official' | 'press' | null;
    source_url?: string | null;
    fetched_at?: string | null;
    reported_at?: string | null;
    // Inicio de la alerta efectiva (press → fecha de la noticia);
    // reported_at es el scrape oficial y no ordena la lista del banner
    alerted_at?: string | null;
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
  // 'official' = incidencia Náyade | 'measurement' = ventana de
  // analítica prohibida sin incidencia | 'press' = solo en prensa
  via?: 'official' | 'measurement' | 'press';
  // La ventana de analítica además la recogió la prensa
  press_confirmed?: boolean;
  // closed_at es la última mención en prensa (cota), no cierre real —
  // la UI lo marca "~" en vez de inventar una duración exacta
  end_estimated?: boolean;
  // Titulares que sustentan/corroboran el episodio — la fila del
  // historial los despliega como evidencia ("según prensa")
  press_items?: BeachNews[];
  // El episodio de prensa corresponde a un punto de muestreo hermano
  // del arenal (ej. "PM4") — este punto no cerró oficialmente
  attributed_pm?: string | null;
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

export type MunicipalityIncident = {
  id: number;
  beach_id: number;
  beach_name: string;
  municipality: string | null;
  kind: 'closure' | 'warning';
  opened_at: string; // YYYY-MM-DD
  closed_at: string | null;
  observations: string | null;
  // Procedencia del episodio: "official" (incidencia Náyade) |
  // "measurement" (analítica prohibida sin incidencia) | "press"
  // (cierre solo recogido por prensa). El backend compone el texto de
  // observations con la aclaración correspondiente
  via?: 'official' | 'measurement' | 'press';
  // closed_at = última mención en prensa, no un cierre corroborado
  end_estimated?: boolean;
  // Inicio del último tramo de cierre real dentro del episodio
  // (incidente oficial largo con reaperturas de prensa dentro →
  // "estuvo cerrada" se mide desde aquí, no desde opened_at)
  last_leg_start?: string | null;
  // Causa normalizada ("Contaminación", "Desprendimientos"...) — el
  // backend la infiere de la prensa en ventana; un cierre de Sanidad
  // sin contexto es Contaminación por definición
  cause?: string | null;
};

export type BeachStats = {
  beach_id: number;
  closures: number;
  warnings: number;
  closures_last_year: number;
  bad_samples: number;
  // No aptas en sentido amplio (prohibido + Sin Calificar +
  // recomendación): cualquier evaluación que no sea "Apta"
  non_apta_samples: number;
  // Episodios de agua: incidencias oficiales + prensa con causa
  // Contaminación (Desprendimientos/obras/mar agitado no cuentan)
  contam_episodes: number;
  total_samples: number;
  latest_evaluation: string | null;
  latest_sampled_at: string | null;
  // Episodios reconstruidos (analítica sin incidencia + cierres solo
  // en prensa): cuentan en el ranking como incidentes reales
  reconstructed?: number;
  // Conteo propio del PM, sin deduplicar entre hermanos de una playa
  // multi-PM: lo que muestra su ficha. closures/warnings son el
  // conteo deduplicado por playa física (atribuido a un solo PM)
  own_closures?: number;
  own_warnings?: number;
};

export type BeachNearbyOutfall = {
  outfall_id: number;
  name: string;
  kind: string | null;
  status: 'legal' | 'illegal' | 'unknown';
  distance_m: number;
};

export type BeachNews = {
  id: number;
  beach_id: number;
  title: string;
  url: string;
  source: string | null;
  published_at: string | null; // ISO datetime
  event_type: string | null; // closure|reopening|warning|pollution|other
  cause: string | null;
};

export type BeachNewsSummary = {
  event_type: string | null; // evento dominante según prensa
  cause: string | null; // causa dominante según prensa
  items_count: number;
  outlets_count: number;
  since: string | null; // inicio del episodio de prensa (ISO)
  // inicio real afirmado por el texto ("cerrada desde julio de 2024"
  // → "2024-07"), ISO parcial — puede ser YYYY, YYYY-MM o YYYY-MM-DD
  closed_since?: string | null;
  // El episodio corresponde a un punto de muestreo hermano (ej.
  // "PM4") — este punto no registró cierre oficial
  attributed_pm?: string | null;
};

export type BeachNewsResponse = {
  summary: BeachNewsSummary;
  items: BeachNews[];
  // Solo los titulares del último episodio de cobertura — el banner
  // de la ficha despliega estos, no el saco completo de `items`
  episode_items?: BeachNews[];
};

export type SamplingSummary = {
  season_per_month: number; // media muestras/mes jun–sep (toda la isla)
  offseason_per_month: number; // media muestras/mes oct–may
  season_months: number;
  offseason_months: number;
};

export type OutfallNearbyBeach = {
  outfall_id: number;
  beach_id: number;
  beach_name: string;
  municipality: string | null;
  distance_m: number;
};

export type Alert = {
  beach_id: number;
  beach_name: string;
  municipality: string | null;
  status: 'closed' | 'warning';
  via?: 'official' | 'press'; // press = cierre dominante en noticias
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
export const fetchBeachNews = (beachId: number) =>
  getJson<BeachNewsResponse>(`/beaches/${beachId}/news`);
export const fetchOutfallNearbyBeaches = (outfallId: number) =>
  getJson<OutfallNearbyBeach[]>(`/outfalls/${outfallId}/nearby-beaches`);
export const fetchBeachNearbyOutfalls = (beachId: number) =>
  getJson<BeachNearbyOutfall[]>(
    `/beaches/${beachId}/nearby-outfalls?radius_m=1000`,
  );
export const fetchMunicipalityIncidents = (municipality: string) =>
  getJson<MunicipalityIncident[]>(
    `/incidents?municipality=${encodeURIComponent(municipality)}`,
  );
// Episodios de toda la isla (oficiales + reconstruidos), una fila por
// episodio agrupado por playa base + municipio — alimenta el resumen
// anual, "Resueltas recientemente" y la vista Temporada
export const fetchEpisodes = () => getJson<MunicipalityIncident[]>('/episodes');
export const fetchSampling = () => getJson<SamplingSummary>('/sampling');

// URL pública compartible de una playa (mini-página OG del backend);
// WhatsApp/Telegram la convierten en tarjeta con foto satélite.
// Usa el dominio https (Caddy en la VM): una IP pelada + puerto raro
// no genera tarjeta de preview en los chats.
const SHARE_BASE_URL = 'https://checkcoast.duckdns.org';
export const beachShareUrl = (beachId: number) =>
  `${SHARE_BASE_URL}/b/${beachId}`;

// Registro del Expo push token en el backend (idempotente)
export const registerDevice = (token: string, platform: string) =>
  fetch(`${API_URL}/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, platform }),
  }).then((res) => {
    if (!res.ok) throw new Error(`API /devices: HTTP ${res.status}`);
  });

// Telemetría de errores de la app instalada — write-only, fire and
// forget: si el envío falla no hay nada mejor que hacer con el error
export const reportClientEvent = (
  kind: string,
  platform: string,
  message?: string,
) =>
  fetch(`${API_URL}/client-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, platform, message }),
  }).catch(() => {});

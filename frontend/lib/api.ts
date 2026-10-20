import { appCheckHeaders } from './appCheck';

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
    // El episodio ES estructural (causa mayoritaria de prensa, o
    // causa oficial) — distinto de alert_cause, que gana por
    // especificidad y puede nombrar una causa minoritaria
    alert_structural?: boolean | null;
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
  // PMs de las zonas que la prensa nombró en el episodio (complejo
  // multipunto): la UI las lista "Playa Jardín · Punta Brava";
  // vacío si el episodio fue genérico — la playa se nombra a secas
  zone_beach_ids?: number[];
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
  // Episodios reconstruidos (cierres solo en prensa + analítica
  // corroborada por prensa de cierre): cuentan en el ranking
  reconstructed?: number;
  // Analítica prohibida sin corroboración: agua no apta, NUNCA
  // cierre — va aparte para no inflar el contador
  lab_episodes?: number;
  // Conteo propio del PM, sin deduplicar entre hermanos de una playa
  // multi-PM: lo que muestra su ficha. closures/warnings son el
  // conteo deduplicado por playa física (atribuido a un solo PM)
  own_closures?: number;
  own_warnings?: number;
  own_lab?: number;
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
  // en /beaches/{id}/news siempre va casada; en la ficha de emisario
  // un ítem atribuido por cuerpo puede no tener playa
  beach_id: number | null;
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

export type OutfallNearbyBeach = {
  outfall_id: number;
  beach_id: number;
  beach_name: string;
  municipality: string | null;
  distance_m: number;
};

export type OutfallNewsItem = BeachNews & {
  // playa a la que está casada la noticia — es noticia DE la playa
  // cercana, el emisario es contexto geográfico
  beach_name: string | null;
  // hecho de infraestructura extraído del cuerpo del artículo
  // ("rotura del emisario") — distinto de `cause`, que es la causa
  // del evento de playa cuando el ítem sirve a las dos fichas
  infra_cause: string | null;
};

export type OutfallInfraSummary = {
  // resumen "de este punto": cuántas noticias lo nombran y qué
  // hechos de infraestructura describen (roturas, vertidos…)
  named_count: number;
  causes: string[];
};

export type OutfallEpisodeBeach = {
  beach_id: number;
  name: string | null;
  municipality: string | null;
  episodes: number;
  closures: number;
  last: string | null;
};

export type OutfallEpisodes = {
  // episodios de contaminación (familia agua) en playas a <2 km,
  // últimos 5 años — contexto estadístico, nunca causalidad
  total: number;
  closures: number;
  last: string | null;
  beaches: OutfallEpisodeBeach[];
};

export type OutfallNewsResponse = {
  // titulares que nombran ESTE punto (instalación + topónimo del
  // censo): roturas, vertidos, reparaciones, denuncias
  named: OutfallNewsItem[];
  // infraestructura de la zona sin punto concreto nombrado —
  // contexto de prensa: la proximidad no implica causalidad
  zone: OutfallNewsItem[];
  // línea resumen de las `named` ("rotura del emisario — 3 noticias
  // lo nombran"); null si ninguna nombra el punto
  summary: OutfallInfraSummary | null;
  // episodios de contaminación del entorno — contexto; null en
  // puntos no residuales (sin sección)
  episodes: OutfallEpisodes | null;
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
export const fetchOutfallNews = (outfallId: number) =>
  getJson<OutfallNewsResponse>(`/outfalls/${outfallId}/news`);
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

// URL pública compartible de una playa (mini-página OG del backend);
// WhatsApp/Telegram la convierten en tarjeta con foto satélite.
// Usa el dominio https (Caddy en la VM): una IP pelada + puerto raro
// no genera tarjeta de preview en los chats.
const SHARE_BASE_URL = 'https://checkcoast.duckdns.org';
export const beachShareUrl = (beachId: number) =>
  `${SHARE_BASE_URL}/b/${beachId}`;

// Registro del Expo push token en el backend (idempotente)
export const registerDevice = async (token: string, platform: string) => {
  const res = await fetch(`${API_URL}/devices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await appCheckHeaders()),
    },
    body: JSON.stringify({ token, platform }),
  });
  if (!res.ok) throw new Error(`API /devices: HTTP ${res.status}`);
};

// Telemetría de errores de la app instalada — write-only, fire and
// forget: si el envío falla no hay nada mejor que hacer con el error
export const reportClientEvent = async (
  kind: string,
  platform: string,
  message?: string,
) => {
  try {
    await fetch(`${API_URL}/client-events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await appCheckHeaders()),
      },
      body: JSON.stringify({ kind, platform, message }),
    });
  } catch {}
};

import { useEffect, useMemo, useState } from 'react';

import {
  Alert,
  FeatureCollection,
  MunicipalityIncident,
  fetchAlerts,
  fetchBeaches,
  fetchEpisodes,
  fetchOutfalls,
} from './api';

const EMPTY_FC: FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

// Datos vivos de la app: fetch inicial de las 4 colecciones + refresco
// periódico de lo que puede cambiar sin reiniciar (alertas, playas,
// episodios — la API los sincroniza con Náyade). `beachesFC` inyecta el
// status vivo de /alerts en cada feature de playa.
export function useBeachData() {
  const [outfalls, setOutfalls] = useState<FeatureCollection>(EMPTY_FC);
  const [beaches, setBeaches] = useState<FeatureCollection>(EMPTY_FC);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [episodes, setEpisodes] = useState<MunicipalityIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = () =>
    Promise.all([
      fetchOutfalls(),
      fetchBeaches(),
      fetchAlerts(),
      fetchEpisodes(),
    ])
      .then(([o, b, a, ep]) => {
        setOutfalls(o);
        setBeaches(b);
        setAlerts(a);
        setEpisodes(ep);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));

  const reload = () => {
    setError(null);
    setLoading(true);
    fetchAll();
  };

  useEffect(() => {
    fetchAll();

    // Refresco periódico: alertas + playas (estado/incidencias nuevas
    // sin reiniciar la app — la API las sincroniza con Náyade)
    const timer = setInterval(
      () => {
        fetchAlerts()
          .then(setAlerts)
          .catch(() => {});
        fetchBeaches()
          .then(setBeaches)
          .catch(() => {});
        fetchEpisodes()
          .then(setEpisodes)
          .catch(() => {});
      },
      5 * 60 * 1000,
    );
    return () => clearInterval(timer);
  }, []);

  // Inyecta `alert` y el status vivo (de /alerts) en cada feature de playa
  const beachesFC = useMemo<FeatureCollection>(() => {
    const byId = new Map(alerts.map((a) => [a.beach_id, a.status]));
    return {
      ...beaches,
      features: beaches.features.map((f) => ({
        ...f,
        properties: {
          ...f.properties,
          status: byId.get(f.id) ?? f.properties.status,
          alert: byId.has(f.id),
        },
      })),
    };
  }, [beaches, alerts]);

  return { outfalls, beachesFC, episodes, loading, error, reload };
}

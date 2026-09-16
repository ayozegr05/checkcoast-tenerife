import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import CoastMap, { Selection } from './components/CoastMap';
import FeatureSheet from './components/FeatureSheet';
import {
  Alert,
  FeatureCollection,
  fetchAlerts,
  fetchBeaches,
  fetchOutfalls,
} from './lib/api';

const EMPTY_FC: FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

export default function App() {
  const [outfalls, setOutfalls] = useState<FeatureCollection>(EMPTY_FC);
  const [beaches, setBeaches] = useState<FeatureCollection>(EMPTY_FC);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  useEffect(() => {
    Promise.all([fetchOutfalls(), fetchBeaches(), fetchAlerts()])
      .then(([o, b, a]) => {
        setOutfalls(o);
        setBeaches(b);
        setAlerts(a);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));

    // Refresco periódico de alertas de playa (la API las sincroniza
    // con Náyade en segundo plano)
    const timer = setInterval(() => {
      fetchAlerts()
        .then(setAlerts)
        .catch(() => {});
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // Inyecta la flag `alert` en cada feature de playa para el estilo del mapa
  const beachesFC = useMemo<FeatureCollection>(() => {
    const ids = new Set(alerts.map((a) => a.beach_id));
    return {
      ...beaches,
      features: beaches.features.map((f) => ({
        ...f,
        properties: { ...f.properties, alert: ids.has(f.id) },
      })),
    };
  }, [beaches, alerts]);

  return (
    <View style={styles.container}>
      <CoastMap
        outfalls={outfalls}
        beaches={beachesFC}
        onSelect={setSelection}
      />

      {loading && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" />
        </View>
      )}
      {error && (
        <View style={styles.overlay}>
          <Text style={styles.errorText}>Error cargando datos: {error}</Text>
        </View>
      )}

      {selection && (
        <FeatureSheet selection={selection} onClose={() => setSelection(null)} />
      )}

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  errorText: {
    color: '#c62828',
    paddingHorizontal: 24,
    textAlign: 'center',
  },
});

import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import CoastMap, { Selection } from './components/CoastMap';
import FeatureSheet from './components/FeatureSheet';
import {
  Alert,
  fetchAlerts,
  fetchBeaches,
  fetchOutfalls,
  GeoFeature,
} from './lib/api';

export default function App() {
  const [outfalls, setOutfalls] = useState<GeoFeature[]>([]);
  const [beaches, setBeaches] = useState<GeoFeature[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  useEffect(() => {
    Promise.all([fetchOutfalls(), fetchBeaches(), fetchAlerts()])
      .then(([o, b, a]) => {
        setOutfalls(o.features);
        setBeaches(b.features);
        setAlerts(a);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const alertBeachIds = useMemo(
    () => new Set(alerts.map((a) => a.beach_id)),
    [alerts],
  );

  return (
    <View style={styles.container}>
      <CoastMap
        outfalls={outfalls}
        beaches={beaches}
        alertBeachIds={alertBeachIds}
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

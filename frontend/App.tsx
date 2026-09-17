import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import BeachList from './components/BeachList';
import CoastMap, { Selection } from './components/CoastMap';
import FeatureSheet from './components/FeatureSheet';
import {
  Alert,
  FeatureCollection,
  GeoFeature,
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
  const [listOpen, setListOpen] = useState(false);
  const [focus, setFocus] = useState<[number, number] | null>(null);

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

  const handleListSelect = (feature: GeoFeature) => {
    setListOpen(false);
    setSelection({
      type: 'beach',
      feature,
      hasAlert: feature.properties.alert === true,
    });
    setFocus([...feature.geometry.coordinates]);
  };

  return (
    <View style={styles.container}>
      <CoastMap
        outfalls={outfalls}
        beaches={beachesFC}
        focus={focus}
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

      <Pressable
        style={styles.listButton}
        onPress={() => setListOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Abrir lista de playas"
      >
        <Image
          source={require('./assets/icons/beach.png')}
          style={styles.listButtonIcon}
        />
        <Text style={styles.listButtonText}>Playas</Text>
      </Pressable>

      {listOpen && (
        <BeachList
          beaches={beachesFC.features}
          onSelect={handleListSelect}
          onClose={() => setListOpen(false)}
        />
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
  listButton: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 24,
    paddingVertical: 10,
    paddingHorizontal: 16,
    elevation: 4,
  },
  listButtonIcon: {
    width: 20,
    height: 20,
    marginRight: 6,
  },
  listButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#222',
  },
});

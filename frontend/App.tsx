import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
  const [introDismissed, setIntroDismissed] = useState(false);

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
        onOpenList={() => setListOpen(true)}
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

      {!introDismissed && !loading && !error && (
        <View style={styles.introCard}>
          <Text style={styles.introTitle}>CheckCoast Tenerife</Text>
          <Text style={styles.introText}>
            Estado de las playas y puntos de vertido de la isla, con datos
            oficiales actualizados.
          </Text>
          <Text style={styles.introHint}>· Toca un punto para ver su detalle</Text>
          <Text style={styles.introHint}>
            · «Playas» para buscar por nombre o municipio
          </Text>
          <Text style={styles.introHint}>
            · Gris = playa sin monitorización oficial
          </Text>
          <Pressable
            style={styles.introBtn}
            onPress={() => setIntroDismissed(true)}
            accessibilityRole="button"
          >
            <Text style={styles.introBtnText}>Entendido</Text>
          </Pressable>
        </View>
      )}

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
  introCard: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: '30%',
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: 14,
    padding: 20,
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  introTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0277bd',
    marginBottom: 8,
  },
  introText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 10,
    lineHeight: 20,
  },
  introHint: {
    fontSize: 13,
    color: '#555',
    marginTop: 2,
  },
  introBtn: {
    marginTop: 14,
    alignSelf: 'flex-end',
    backgroundColor: '#0277bd',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 18,
  },
  introBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});

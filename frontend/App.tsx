import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { useFonts } from 'expo-font';
import {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  NativeModules,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import BeachList from './components/BeachList';
import CoastMap, { Selection } from './components/CoastMap';
import FeatureSheet from './components/FeatureSheet';
import IntroCard from './components/IntroCard';
import MunicipalityStats from './components/MunicipalityStats';
import OutfallList from './components/OutfallList';
import {
  Alert,
  FeatureCollection,
  GeoFeature,
  fetchAlerts,
  fetchBeaches,
  fetchOutfalls,
} from './lib/api';
import { beachPointLabel } from './lib/format';
import { setupPushNotifications } from './lib/notifications';
import { colors, fonts } from './lib/theme';

const EMPTY_FC: FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

// AsyncStorage es nativo: si el build instalado no lleva el módulo ni
// se toca — la card de bienvenida sale en cada arranque, como antes.
// En el próximo build con el módulo la preferencia persiste sola.
const INTRO_SEEN_KEY = 'checkcoast.intro_seen';
const storage: {
  getItem: (k: string) => Promise<string | null>;
  setItem: (k: string, v: string) => Promise<void>;
} | null = NativeModules.RNCAsyncStorage
  ? require('@react-native-async-storage/async-storage').default
  : null;

export default function App() {
  const [fontsLoaded] = useFonts({
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });
  const [outfalls, setOutfalls] = useState<FeatureCollection>(EMPTY_FC);
  const [beaches, setBeaches] = useState<FeatureCollection>(EMPTY_FC);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [muniOpen, setMuniOpen] = useState(false);
  const [outfallListOpen, setOutfallListOpen] = useState(false);
  const [listMunicipality, setListMunicipality] = useState<
    string | null | undefined
  >(undefined);
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const [introVisible, setIntroVisible] = useState(false);

  const loadData = () => {
    setError(null);
    setLoading(true);
    Promise.all([fetchOutfalls(), fetchBeaches(), fetchAlerts()])
      .then(([o, b, a]) => {
        setOutfalls(o);
        setBeaches(b);
        setAlerts(a);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();

    // Refresco periódico: alertas + playas (estado/incidencias nuevas
    // sin reiniciar la app — la API las sincroniza con Náyade)
    const timer = setInterval(() => {
      fetchAlerts()
        .then(setAlerts)
        .catch(() => {});
      fetchBeaches()
        .then(setBeaches)
        .catch(() => {});
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // La card de bienvenida solo se muestra en el primer arranque;
  // también se puede reabrir desde el botón de ayuda del mapa
  useEffect(() => {
    if (!storage) {
      setIntroVisible(true);
      return;
    }
    storage
      .getItem(INTRO_SEEN_KEY)
      .then((seen) => setIntroVisible(!seen))
      .catch(() => setIntroVisible(true));
  }, []);

  const closeIntro = (dontShow: boolean) => {
    setIntroVisible(false);
    if (dontShow) storage?.setItem(INTRO_SEEN_KEY, '1').catch(() => {});
  };

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

  // Puntos de muestreo pintados en el mapa mientras la card de una
  // playa agrupada está abierta (selector de PMs o ficha de un PM)
  const pmPointsFC = useMemo<FeatureCollection>(
    () =>
      selection?.type === 'beach' &&
      selection.members &&
      selection.members.length > 1
        ? {
            type: 'FeatureCollection',
            features: selection.members.map((m) => ({
              ...m,
              properties: {
                ...m.properties,
                pointLabel: beachPointLabel(m.properties.name) ?? '',
              },
            })),
          }
        : EMPTY_FC,
    [selection],
  );

  // Push: registro del token + al tocar la notificación abrir la playa
  const beachesRef = useRef(beachesFC);
  beachesRef.current = beachesFC;

  // Abre la ficha de una playa por id: cierra modales y vuela el mapa
  // al punto. Compartido por push y por deep-links checkcoast://beach/ID
  const openBeachById = (id: number) => {
    const f = beachesRef.current.features.find((x) => x.id === id);
    if (!f) return;
    setListOpen(false);
    setMuniOpen(false);
    setOutfallListOpen(false);
    setSelection({
      type: 'beach',
      feature: f,
      hasAlert: f.properties.alert === true,
    });
    setFocus([...f.geometry.coordinates]);
  };
  const openBeachRef = useRef(openBeachById);
  openBeachRef.current = openBeachById;

  useEffect(() => {
    setupPushNotifications();
    const sub = Notifications.addNotificationResponseReceivedListener(
      (resp) => {
        const id = (
          resp.notification.request.content.data as
            | { beach_id?: number }
            | undefined
        )?.beach_id;
        if (id != null) openBeachRef.current(id);
      },
    );
    return () => sub.remove();
  }, []);

  // Deep-links compartidos: checkcoast://beach/123 (y el equivalente
  // del dev-client exp+...://...beach/123). Funciona al tocar un link
  // con la app abierta y como URL de arranque.
  useEffect(() => {
    const handle = (url: string | null) => {
      const m = url?.match(/beach\/(\d+)/);
      if (m) openBeachRef.current(Number(m[1]));
    };
    Linking.getInitialURL().then(handle).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    return () => sub.remove();
  }, []);

  const handleListSelect = (feature: GeoFeature) => {
    setListOpen(false);
    setMuniOpen(false);
    setListMunicipality(undefined);
    setSelection({
      type: 'beach',
      feature,
      hasAlert: feature.properties.alert === true,
    });
    setFocus([...feature.geometry.coordinates]);
  };

  const handleOutfallSelect = (feature: GeoFeature) => {
    setOutfallListOpen(false);
    setSelection({ type: 'outfall', feature });
    setFocus([...feature.geometry.coordinates]);
  };

  // Al tocar un municipio en el ranking, se abre la lista filtrada por él
  const handleMunicipalitySelect = (municipality: string | null) => {
    setMuniOpen(false);
    setListMunicipality(municipality);
    setListOpen(true);
  };

  return (
    <View style={styles.container}>
      <CoastMap
        outfalls={outfalls}
        beaches={beachesFC}
        focus={focus}
        selectionActive={!!selection}
        pmPoints={pmPointsFC}
        onSelect={setSelection}
        onOpenList={() => setListOpen(true)}
        onOpenMunicipalities={() => setMuniOpen(true)}
        onOpenOutfalls={() => setOutfallListOpen(true)}
        onOpenHelp={() => setIntroVisible(true)}
      />

      {(loading || !fontsLoaded) && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
      {error && (
        <View style={styles.overlay}>
          <Text style={styles.errorText}>Error cargando datos: {error}</Text>
          <Pressable
            style={styles.retryBtn}
            onPress={loadData}
            accessibilityRole="button"
            accessibilityLabel="Reintentar cargar datos"
          >
            <Text style={styles.retryText}>Reintentar</Text>
          </Pressable>
        </View>
      )}

      {introVisible && !loading && !error && fontsLoaded && (
        <IntroCard onClose={closeIntro} />
      )}

      <BeachList
        visible={listOpen}
        beaches={beachesFC.features}
        initialMunicipality={listMunicipality}
        onSelect={handleListSelect}
        onClose={() => {
          setListOpen(false);
          // Si la lista venia del ranking de municipios, al cerrar se
          // vuelve a el en vez de salir al mapa
          if (listMunicipality !== undefined) setMuniOpen(true);
          setListMunicipality(undefined);
        }}
        onOpenMunicipalities={() => {
          setListOpen(false);
          setMuniOpen(true);
        }}
      />

      <OutfallList
        visible={outfallListOpen}
        outfalls={outfalls.features}
        onSelect={handleOutfallSelect}
        onClose={() => setOutfallListOpen(false)}
      />

      {muniOpen && (
        <MunicipalityStats
          beaches={beachesFC.features}
          onSelect={handleMunicipalitySelect}
          onClose={() => setMuniOpen(false)}
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
    backgroundColor: colors.surface,
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
    color: colors.danger,
    paddingHorizontal: 24,
    textAlign: 'center',
    fontFamily: fonts.semibold,
  },
  retryBtn: {
    marginTop: 14,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 22,
  },
  retryText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: fonts.bold,
  },
});

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
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import BeachList from './components/BeachList';
import CoastMap, { Selection } from './components/CoastMap';
import FeatureSheet from './components/FeatureSheet';
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
import { setupPushNotifications } from './lib/notifications';
import { colors, fonts } from './lib/theme';

const EMPTY_FC: FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

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

  // Push: registro del token + al tocar la notificación abrir la playa
  const beachesRef = useRef(beachesFC);
  beachesRef.current = beachesFC;
  useEffect(() => {
    setupPushNotifications();
    const sub = Notifications.addNotificationResponseReceivedListener(
      (resp) => {
        const id = (
          resp.notification.request.content.data as
            | { beach_id?: number }
            | undefined
        )?.beach_id;
        const f =
          id != null
            ? beachesRef.current.features.find((x) => x.id === id)
            : undefined;
        if (!f) return;
        setListOpen(false);
        setMuniOpen(false);
        setSelection({
          type: 'beach',
          feature: f,
          hasAlert: f.properties.alert === true,
        });
        setFocus([...f.geometry.coordinates]);
      },
    );
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
        onSelect={setSelection}
        onOpenList={() => setListOpen(true)}
        onOpenMunicipalities={() => setMuniOpen(true)}
        onOpenOutfalls={() => setOutfallListOpen(true)}
      />

      {(loading || !fontsLoaded) && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
      {error && (
        <View style={styles.overlay}>
          <Text style={styles.errorText}>Error cargando datos: {error}</Text>
        </View>
      )}

      {!introDismissed && !loading && !error && fontsLoaded && (
        <View style={styles.introCard}>
          <View style={styles.introWave} />
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
            · «Municipios» para ver dónde hay más incidencias
          </Text>
          <Text style={styles.introHint}>
            · «Vertidos» para ver los emisarios y su situación legal
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
  introCard: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: '30%',
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: 14,
    padding: 20,
    paddingTop: 14,
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    overflow: 'hidden',
  },
  introWave: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 6,
    backgroundColor: colors.accent,
    borderBottomWidth: 3,
    borderBottomColor: colors.primary,
  },
  introTitle: {
    fontSize: 20,
    fontFamily: fonts.extrabold,
    color: colors.primaryDark,
    marginBottom: 8,
  },
  introText: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
    marginBottom: 10,
    lineHeight: 20,
  },
  introHint: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 2,
  },
  introBtn: {
    marginTop: 14,
    alignSelf: 'flex-end',
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 18,
  },
  introBtnText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: fonts.bold,
  },
});

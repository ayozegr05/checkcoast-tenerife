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
  BackHandler,
  Linking,
  NativeModules,
  Pressable,
  StyleSheet,
  Text,
  ToastAndroid,
  TurboModuleRegistry,
  View,
} from 'react-native';

import BeachList from './components/BeachList';
import CoastMap, { Selection } from './components/CoastMap';
import FeatureSheet from './components/FeatureSheet';
import HelpHub from './components/HelpHub';
import IntroCard from './components/IntroCard';
import MunicipalityStats from './components/MunicipalityStats';
import OutfallList from './components/OutfallList';
import {
  Alert,
  FeatureCollection,
  GeoFeature,
  MunicipalityIncident,
  fetchAlerts,
  fetchBeaches,
  fetchEpisodes,
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
// Con New Architecture el módulo vive como TurboModule (NativeModules
// puede no listarlo), así que se consultan ambos registros.
const INTRO_SEEN_KEY = 'checkcoast.intro_seen';
const storage: {
  getItem: (k: string) => Promise<string | null>;
  setItem: (k: string, v: string) => Promise<void>;
} | null =
  NativeModules.RNCAsyncStorage ??
  TurboModuleRegistry.get('RNCAsyncStorage')
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
  const [episodes, setEpisodes] = useState<MunicipalityIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [muniOpen, setMuniOpen] = useState(false);
  // Vista inicial del panel de municipios: el enlace del banner de
  // alertas lo abre directamente en "Temporada"
  const [muniView, setMuniView] = useState<
    'ranking' | 'temporada' | 'year'
  >('ranking');
  // Causa preseleccionada al abrir la vista "Este año" (drill-down
  // del paréntesis del banner de alertas)
  const [muniCause, setMuniCause] = useState<string | null>(null);
  const [outfallListOpen, setOutfallListOpen] = useState(false);
  const [listMunicipality, setListMunicipality] = useState<
    string | null | undefined
  >(undefined);
  // [lon, lat, zoom?, tipoCard?]: sin zoom = fly-to estándar (13,
  // con card); con zoom sin tipo = pin exacto sin card; con tipo =
  // zoom con ficha abierta (padding de la card)
  const [focus, setFocus] = useState<
    [number, number, number?, ('beach' | 'outfall')?] | null
  >(null);
  const [introVisible, setIntroVisible] = useState(false);
  // Intro reabierta desde la Guía: sin checkbox y con ‹/✕ de sección
  const [introRevisit, setIntroRevisit] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // "Ver en mapa" desde la ficha: la card se oculta pero la selección
  // se mantiene — el pin queda grande y el mapa no restaura la vista
  const [sheetHidden, setSheetHidden] = useState(false);
  // Emisario abierto desde "Emisarios cercanos" de una ficha de playa:
  // la selección previa se guarda para restaurarla al cerrar/atrás
  const [restoreSel, setRestoreSel] = useState<Selection | null>(null);
  // Doble atrás para salir: marca temporal del último atrás en el mapa
  const lastBackRef = useRef(0);

  const loadData = () => {
    setError(null);
    setLoading(true);
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
      fetchEpisodes()
        .then(setEpisodes)
        .catch(() => {});
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // La card de bienvenida solo se muestra en el primer arranque;
  // la ayuda bajo demanda vive en HelpHub (botón "?" del mapa)
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
  const pmPointsFC = useMemo<FeatureCollection>(() => {
    // Solo miembros con etiqueta de PM: los duplicados OSM sin
    // monitorizar agrupados por nombre (p.ej. La Hornilla) no tienen
    // punto de muestreo — pintarlos dejaría dots grises huérfanos
    const labeled =
      selection?.type === 'beach'
        ? (selection.members ?? []).filter((m) =>
            beachPointLabel(m.properties.name),
          )
        : [];
    return labeled.length > 1
      ? {
          type: 'FeatureCollection',
          features: labeled.map((m) => ({
            ...m,
            properties: {
              ...m.properties,
              pointLabel: beachPointLabel(m.properties.name) ?? '',
            },
          })),
        }
      : EMPTY_FC;
  }, [selection]);

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
    setReturnToOutfalls(false);
    setRestoreSel(null);
    setSheetHidden(false);
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

  // Deep-links compartidos: checkcoast://beach/123, el equivalente del
  // dev-client (exp+...://...beach/123) y los App Links https
  // (checkcoast.duckdns.org/b/123). Funciona al tocar un link con la
  // app abierta y como URL de arranque.
  useEffect(() => {
    const handle = (url: string | null) => {
      const m = url?.match(/(?:beach|b)\/(\d+)/);
      if (m) openBeachRef.current(Number(m[1]));
    };
    Linking.getInitialURL().then(handle).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    return () => sub.remove();
  }, []);

  // "Ver en mapa" desde la lista: cerrar y volar cerca de la playa con
  // la selección mantenida pero sin card — el pin queda grande al
  // alcance del dedo si se quiere reabrir la ficha
  const handleListSelect = (feature: GeoFeature) => {
    setListOpen(false);
    setMuniOpen(false);
    setListMunicipality(undefined);
    setReturnToMuni(false);
    setReturnToOutfalls(false);
    setRestoreSel(null);
    setSheetHidden(true);
    setSelection({
      type: 'beach',
      feature,
      hasAlert: feature.properties.alert === true,
    });
    setFocus([...feature.geometry.coordinates, 15.5]);
  };

  // Emisario abierto desde la lista: al cerrar su ficha se vuelve a
  // la lista de emisarios, no al mapa
  const [returnToOutfalls, setReturnToOutfalls] = useState(false);
  const handleOutfallSelect = (feature: GeoFeature) => {
    setOutfallListOpen(false);
    setReturnToOutfalls(true);
    setRestoreSel(null);
    setSheetHidden(false);
    setSelection({ type: 'outfall', feature });
    setFocus([...feature.geometry.coordinates]);
  };

  // Al tocar un municipio en el ranking, se abre la lista filtrada por él
  const handleMunicipalitySelect = (municipality: string | null) => {
    setMuniOpen(false);
    setListMunicipality(municipality);
    setListOpen(true);
  };

  // Ficha abierta desde un incidente de Municipios: al cerrarla se
  // vuelve a la línea temporal del municipio, no al mapa
  const [returnToMuni, setReturnToMuni] = useState(false);
  const openBeachFromMuni = (id: number) => {
    setReturnToMuni(true);
    openBeachById(id);
  };
  // Pin tocado desde dentro de una ficha (emisario cercano en la de
  // playa, playa más cercana en la de emisario): el mapa vuela al punto
  // con su pin seleccionado. `entries` = pasos que se apilan para el
  // botón atrás (la ficha de origen y, si venía de la lista, su ficha
  // dentro del modal). showSheet abre la ficha del punto en vez de
  // dejar solo el pin destacado (emisario desde ficha de playa)
  const flyToPin = (
    sel: Selection,
    restore: Selection | null,
    showSheet = false,
  ) => {
    setListOpen(false);
    setMuniOpen(false);
    setOutfallListOpen(false);
    setRestoreSel(restore);
    setSheetHidden(!showSheet);
    setSelection(sel);
    // Con ficha abierta la cámara aplica su padding (la card tapa la
    // zona baja); sin ficha el pin se centra exacto
    setFocus(
      showSheet
        ? [...sel.feature.geometry.coordinates, 15.5, sel.type]
        : [...sel.feature.geometry.coordinates, 15.5],
    );
  };
  const openOutfall = (
    feature: GeoFeature,
    restore: Selection | null,
  ) => flyToPin({ type: 'outfall', feature }, restore, true);
  const openBeachPin = (
    feature: GeoFeature,
    restore: Selection | null,
  ) =>
    flyToPin(
      {
        type: 'beach',
        feature,
        hasAlert: feature.properties.alert === true,
      },
      restore,
    );

  // Cierre explícito (✕ o gesto de arrastrar): suelta en el mapa
  // libre — no retrocede por la cadena de origen ni reabre listas
  const closeSheet = () => {
    setRestoreSel(null);
    setReturnToMuni(false);
    setReturnToOutfalls(false);
    setSelection(null);
    setSheetHidden(false);
  };

  // Atrás hardware: retrocede por donde viniste — si la ficha se abrió
  // desde otra (emisario desde playa) su card se restaura; si venía de
  // una lista (emisarios, municipios) esa lista se reabre
  const backSheet = () => {
    if (restoreSel) {
      const back = restoreSel;
      setRestoreSel(null);
      setSheetHidden(false);
      setSelection(back);
      setFocus([
        ...back.feature.geometry.coordinates,
        15.5,
        back.type,
      ]);
      return;
    }
    setSelection(null);
    setSheetHidden(false);
    if (returnToMuni) {
      setReturnToMuni(false);
      setMuniOpen(true);
    }
    if (returnToOutfalls) {
      setReturnToOutfalls(false);
      setOutfallListOpen(true);
    }
  };

  // Botón atrás de Android: la ficha no es un Modal, así que sin este
  // handler atrás cerraría la app. Orden: overlays propios (guía,
  // intro) → ficha (backSheet, que recuerda la de origen a diferencia
  // de la ✕) → mapa limpio → doble atrás para salir. Los Modals
  // (listas) consumen su propio atrás nativo antes de llegar aquí
  const backSheetRef = useRef(backSheet);
  backSheetRef.current = backSheet;
  const hasSelectionRef = useRef(false);
  hasSelectionRef.current = selection !== null;
  const helpOpenRef = useRef(helpOpen);
  helpOpenRef.current = helpOpen;
  const introOpenRef = useRef(introVisible);
  introOpenRef.current = introVisible;
  const introRevisitRef = useRef(introRevisit);
  introRevisitRef.current = introRevisit;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (helpOpenRef.current) {
        setHelpOpen(false);
        return true;
      }
      if (introOpenRef.current) {
        setIntroVisible(false);
        // Reabierta desde la Guía: atrás vuelve al índice, no al mapa
        if (introRevisitRef.current) setHelpOpen(true);
        return true;
      }
      if (hasSelectionRef.current) {
        backSheetRef.current();
        return true;
      }
      // Doble atrás para salir: el primer toque avisa, el segundo
      // (≤2,5 s) envía a fondo — sin salidas accidentales ni modal que
      // prometía un "salir" que Android no concede de verdad
      if (Date.now() - lastBackRef.current < 2500) {
        BackHandler.exitApp();
        return true;
      }
      lastBackRef.current = Date.now();
      ToastAndroid.show(
        'Pulsa atrás otra vez para salir',
        ToastAndroid.SHORT,
      );
      return true;
    });
    return () => sub.remove();
  }, []);

  return (
    <View style={styles.container}>
      <CoastMap
        outfalls={outfalls}
        beaches={beachesFC}
        focus={focus}
        selectionActive={!!selection}
        selectedBeachId={
          selection?.type === 'beach' ? selection.feature.id : null
        }
        selectedOutfallId={
          selection?.type === 'outfall' ? selection.feature.id : null
        }
        pmPoints={pmPointsFC}
        onSelect={(s) => {
          setSelection(s);
          setSheetHidden(false);
          setRestoreSel(null);
          setReturnToMuni(false);
          setReturnToOutfalls(false);
        }}
        // Buscar/Ayuda pisan la ficha: cierra directo (no retrocede)
        onDismissSelection={() => {
          setReturnToMuni(false);
          setReturnToOutfalls(false);
          closeSheet();
        }}
        onOpenList={() => {
          closeSheet();
          setListOpen(true);
        }}
        onOpenMunicipalities={() => {
          closeSheet();
          setMuniView('ranking');
          setMuniCause(null);
          setMuniOpen(true);
        }}
        onOpenTemporada={() => {
          closeSheet();
          setMuniView('temporada');
          setMuniCause(null);
          setMuniOpen(true);
        }}
        episodes={episodes}
        onOpenOutfalls={() => {
          closeSheet();
          setOutfallListOpen(true);
        }}
        onOpenHelp={() => {
          closeSheet();
          setHelpOpen(true);
        }}
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
            style={({ pressed }) => [
              styles.retryBtn,
              pressed && styles.pressFx,
            ]}
            onPress={loadData}
            accessibilityRole="button"
            accessibilityLabel="Reintentar cargar datos"
          >
            <Text style={styles.retryText}>Reintentar</Text>
          </Pressable>
        </View>
      )}

      {introVisible && !loading && !error && fontsLoaded && (
        <IntroCard
          revisit={introRevisit}
          onClose={closeIntro}
          onBack={() => {
            setIntroVisible(false);
            setHelpOpen(true);
          }}
        />
      )}

      {helpOpen && (
        <HelpHub
          onClose={() => setHelpOpen(false)}
          onShowIntro={() => {
            setHelpOpen(false);
            setIntroRevisit(true);
            setIntroVisible(true);
          }}
        />
      )}

      <BeachList
        visible={listOpen}
        beaches={beachesFC.features}
        outfalls={outfalls.features}
        initialMunicipality={listMunicipality}
        onSelect={handleListSelect}
        onSelectOutfall={(f, restore) =>
          openOutfall(
            f,
            restore
              ? {
                  type: 'beach',
                  feature: restore,
                  hasAlert: restore.properties.alert === true,
                }
              : null,
          )
        }
        onClose={() => {
          setListOpen(false);
          // Si la lista venia del ranking de municipios, al cerrar se
          // vuelve a el en vez de salir al mapa
          if (listMunicipality !== undefined) setMuniOpen(true);
          setListMunicipality(undefined);
        }}
      />

      <OutfallList
        visible={outfallListOpen}
        outfalls={outfalls.features}
        onSelect={handleOutfallSelect}
        onClose={() => setOutfallListOpen(false)}
      />

      {/* Montado siempre (visible): conserva municipio/scroll al abrir
          una ficha de playa desde su línea temporal */}
      <MunicipalityStats
        visible={muniOpen}
        beaches={beachesFC.features}
        episodes={episodes}
        initialView={muniView}
        initialCause={muniCause}
        onSelect={handleMunicipalitySelect}
        onSelectBeach={openBeachFromMuni}
        onClose={() => setMuniOpen(false)}
      />

      {selection && !sheetHidden && (
        <FeatureSheet
          // Remount por selección: la animación de cierre deja el
          // componente con alto 0 y closing=true — sin key la ficha
          // restaurada (y todas las siguientes) quedan invisibles
          key={`${selection.type}-${selection.feature.id}`}
          selection={selection}
          onClose={closeSheet}
          outfalls={outfalls.features}
          beaches={beachesFC.features}
          onSelectOutfall={(f, origin) =>
            // Se guarda la ficha concreta vista (sin members): atrás
            // la restaura directa, no el selector de PMs del grupo
            openOutfall(f, {
              type: 'beach',
              feature: origin,
              hasAlert: origin.properties.alert === true,
            })
          }
          onSelectBeach={(f) => openBeachPin(f, selection)}
          onViewOnMap={() => {
            // Ocultar la card pero mantener la selección: el pin sigue
            // destacado y el mapa vuela cerca del punto
            setReturnToMuni(false);
            setReturnToOutfalls(false);
            setSheetHidden(true);
            setFocus([
              selection.feature.geometry.coordinates[0],
              selection.feature.geometry.coordinates[1],
              15.5,
            ]);
          }}
        />
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
  pressFx: {
    opacity: 0.6,
  },
});

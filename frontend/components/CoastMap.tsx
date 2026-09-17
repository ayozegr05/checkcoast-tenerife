import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Images,
  Layer,
  Map,
  type CameraRef,
  type PressEventWithFeatures,
  type StyleSpecification,
} from '@maplibre/maplibre-react-native';

import type { FeatureCollection, GeoFeature } from '../lib/api';
import { colors, fonts } from '../lib/theme';
import seaStyle from '../assets/mapstyle-sea.json';

// Estilo vectorial tematico (OpenFreeMap/OpenMapTiles retenido con la
// paleta oceanica por scripts_gen_mapstyle.py). Sin API key.
const SEA_STYLE = seaStyle as unknown as StyleSpecification;

// Estilo raster satélite con Esri World Imagery + capa de etiquetas
// transparente (vista híbrida). Gratuito, sin API key.
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    esri: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Esri, Maxar, Earthstar Geographics',
    },
    'esri-labels': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Esri',
    },
  },
  layers: [
    { id: 'esri', type: 'raster', source: 'esri' },
    { id: 'esri-labels', type: 'raster', source: 'esri-labels' },
  ],
};

// Vista inicial centrada en Tenerife
const TENERIFE_VIEW = {
  center: [-16.6291, 28.2916] as [number, number],
  zoom: 9,
};

export type Selection =
  | { type: 'outfall'; feature: GeoFeature }
  | { type: 'beach'; feature: GeoFeature; hasAlert: boolean };

type CoastMapProps = {
  outfalls: FeatureCollection;
  beaches: FeatureCollection; // con properties.alert ya inyectado
  focus?: [number, number] | null; // [lon, lat] a donde volar la cámara
  selectionActive: boolean; // hay card abierta -> al cerrar restaura vista
  onSelect: (selection: Selection) => void;
  onOpenList?: () => void;
  onOpenMunicipalities?: () => void;
  onOpenOutfalls?: () => void;
};

const OUTFALL_COLORS = colors.outfall;
const BEACH_COLORS = colors.status;

export default function CoastMap({
  outfalls,
  beaches,
  focus,
  selectionActive,
  onSelect,
  onOpenList,
  onOpenMunicipalities,
  onOpenOutfalls,
}: CoastMapProps) {
  const [satellite, setSatellite] = useState(false);
  const [showOutfalls, setShowOutfalls] = useState(true);
  const [showBeaches, setShowBeaches] = useState(true);
  const [pulse, setPulse] = useState(0);
  const cameraRef = useRef<CameraRef>(null);
  // Vista actual + vista guardada antes de volar a un pin (para restaurar
  // al cerrar la card)
  const lastView = useRef<{ center: [number, number]; zoom: number }>({
    center: TENERIFE_VIEW.center,
    zoom: TENERIFE_VIEW.zoom,
  });
  const savedView = useRef<{
    center: [number, number];
    zoom: number;
  } | null>(null);
  const prevSelection = useRef(selectionActive);

  const saveView = () => {
    // Solo guarda si venimos de mapa libre: al cambiar de playa con la
    // card ya abierta no machaca la posicion original
    if (!selectionActive) savedView.current = { ...lastView.current };
  };

  // Card cerrada -> vuelve a la vista previa al toque del pin
  useEffect(() => {
    if (prevSelection.current && !selectionActive && savedView.current) {
      cameraRef.current?.flyTo({
        center: savedView.current.center,
        zoom: savedView.current.zoom,
        duration: 800,
      });
      savedView.current = null;
    }
    prevSelection.current = selectionActive;
  }, [selectionActive]);

  // Conteo de alertas vivas para el banner y la capa de pulse
  const closedCount = beaches.features.filter(
    (f) => f.properties.status === 'closed',
  ).length;
  const warningCount = beaches.features.filter(
    (f) => f.properties.status === 'warning',
  ).length;
  const hasAlerts = closedCount + warningCount > 0;

  const alertBeaches = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: beaches.features.filter(
        (f) =>
          f.properties.monitored !== false &&
          (f.properties.status === 'closed' ||
            f.properties.status === 'warning'),
      ),
    }),
    [beaches],
  );

  // Halo que crece y se desvance ~1 ciclo/seg solo si hay alertas
  useEffect(() => {
    if (!hasAlerts) return;
    const t = setInterval(() => setPulse((p) => (p + 0.1) % 1), 110);
    return () => clearInterval(t);
  }, [hasAlerts]);

  // Vuela a la playa elegida en la lista
  useEffect(() => {
    if (focus) {
      saveView();
      cameraRef.current?.flyTo({
        center: [focus[0], focus[1] - 0.014],
        zoom: 13,
        duration: 1500,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const handlePress =
    (type: 'outfall' | 'beach') =>
    (e: NativeSyntheticEvent<PressEventWithFeatures>) => {
      const feature = e.nativeEvent.features?.[0] as unknown as
        | GeoFeature
        | undefined;
      if (!feature) return;
      saveView();
      // Zoom de detalle + centro desplazado al sur: el pin queda justo
      // por encima de la card flotante.
      const [lon, lat] = (
        feature.geometry as { coordinates: [number, number] }
      ).coordinates;
      cameraRef.current?.flyTo({
        center: [lon, lat - (type === 'beach' ? 0.014 : 0.03)],
        zoom: type === 'beach' ? 13 : 12,
        duration: 900,
      });
      if (type === 'outfall') {
        onSelect({ type: 'outfall', feature });
      } else {
        onSelect({
          type: 'beach',
          feature,
          hasAlert: feature.properties.alert === true,
        });
      }
    };

  return (
    <View style={styles.container}>
      <Map
        style={styles.map}
        mapStyle={satellite ? SATELLITE_STYLE : SEA_STYLE}
        attributionPosition={{ bottom: 8, right: 8 }}
        onRegionDidChange={(e) => {
          const vs = e.nativeEvent as unknown as {
            center: [number, number];
            zoom: number;
          };
          if (vs?.center && typeof vs.zoom === 'number') {
            lastView.current = { center: vs.center, zoom: vs.zoom };
          }
        }}
      >
        <Camera ref={cameraRef} initialViewState={TENERIFE_VIEW} />

        <Images
          images={{
            'pin-open': require('../assets/icons/pin-open.png'),
            'pin-warning': require('../assets/icons/pin-warning.png'),
            'pin-closed': require('../assets/icons/pin-closed.png'),
            'pin-unmonitored': require('../assets/icons/pin-unmonitored.png'),
            'pin-outfall-legal': require('../assets/icons/pin-outfall-legal.png'),
            'pin-outfall-illegal': require('../assets/icons/pin-outfall-illegal.png'),
            'pin-outfall-processing': require('../assets/icons/pin-outfall-processing.png'),
          }}
        />

        {showOutfalls && (
          <GeoJSONSource
            id="outfalls"
            data={outfalls}
            onPress={handlePress('outfall')}
          >
            <Layer
              id="outfall-icons"
              type="symbol"
              layout={{
                'icon-image': [
                  'match',
                  ['get', 'status'],
                  'legal',
                  'pin-outfall-legal',
                  'illegal',
                  'pin-outfall-illegal',
                  'pin-outfall-processing',
                ],
                'icon-size': 0.36,
                'icon-anchor': 'bottom',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
              }}
            />
          </GeoJSONSource>
        )}

        {showBeaches && hasAlerts && (
          <GeoJSONSource id="beach-alerts" data={alertBeaches}>
            <Layer
              id="beach-pulse"
              type="circle"
              paint={{
                'circle-radius': 14 + pulse * 26,
                'circle-color': [
                  'match',
                  ['get', 'status'],
                  'closed',
                  BEACH_COLORS.closed,
                  BEACH_COLORS.warning,
                ],
                'circle-opacity': 0.6 * (1 - pulse),
              }}
            />
          </GeoJSONSource>
        )}

        {showBeaches && (
          <GeoJSONSource
            id="beaches"
            data={beaches}
            onPress={handlePress('beach')}
          >
            <Layer
              id="beach-pins"
              type="symbol"
              layout={{
                'icon-image': [
                  'case',
                  ['==', ['get', 'monitored'], false],
                  'pin-unmonitored',
                  [
                    'match',
                    ['get', 'status'],
                    'closed',
                    'pin-closed',
                    'warning',
                    'pin-warning',
                    'unknown',
                    'pin-unmonitored',
                    'pin-open',
                  ],
                ],
                'icon-size': 0.42,
                'icon-anchor': 'bottom',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
              }}
            />
          </GeoJSONSource>
        )}
      </Map>

      <View style={styles.bannerWrap} pointerEvents="box-none">
        <Pressable
          style={[
            styles.banner,
            {
              backgroundColor: closedCount
                ? colors.status.closed
                : warningCount
                  ? colors.status.warning
                  : colors.status.open,
            },
          ]}
          onPress={() => {
            // Con alertas: vuela a la mas grave y abre su ficha.
            // Sin alertas: abre la lista general.
            const top =
              alertBeaches.features.find(
                (f) => f.properties.status === 'closed',
              ) ?? alertBeaches.features[0];
            if (top) {
              saveView();
              const [lon, lat] = (
                top.geometry as { coordinates: [number, number] }
              ).coordinates;
              cameraRef.current?.flyTo({
                center: [lon, lat - 0.014],
                zoom: 13,
                duration: 1200,
              });
              onSelect({ type: 'beach', feature: top, hasAlert: true });
            } else {
              onOpenList?.();
            }
          }}
          accessibilityRole="button"
          accessibilityLabel="Resumen del estado de las playas"
        >
          <Text style={styles.bannerText}>
            {closedCount || warningCount
              ? [
                  closedCount
                    ? `${closedCount} ${closedCount === 1 ? 'cerrada' : 'cerradas'}`
                    : null,
                  warningCount
                    ? `${warningCount} ${warningCount === 1 ? 'aviso' : 'avisos'}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'Todas las playas sin incidencias'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.legend}>
        <Pressable
          style={[styles.legendRow, !showOutfalls && styles.legendOff]}
          onPress={() => setShowOutfalls((v) => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: showOutfalls }}
        >
          <Image
            source={require('../assets/icons/icon-faucet.png')}
            style={styles.legendIcon}
          />
          <Text style={styles.legendTitle}>Vertidos</Text>
          <View
            style={[
              styles.legendSwitch,
              showOutfalls ? styles.switchOn : styles.switchOff,
            ]}
          >
            <Text style={styles.switchText}>
              {showOutfalls ? 'ON' : 'OFF'}
            </Text>
          </View>
        </Pressable>
        <View style={styles.legendSub}>
          {[
            [OUTFALL_COLORS.legal, 'Autorizado'],
            [OUTFALL_COLORS.illegal, 'No autorizado'],
            [OUTFALL_COLORS.unknown, 'En trámite'],
          ].map(([color, label]) => (
            <View key={label} style={styles.swatchRow}>
              <View style={[styles.dot, { backgroundColor: color }]} />
              <Text style={styles.swatchText}>{label}</Text>
            </View>
          ))}
        </View>
        <Pressable
          style={[styles.legendRow, !showBeaches && styles.legendOff]}
          onPress={() => setShowBeaches((v) => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: showBeaches }}
        >
          <Image
            source={require('../assets/icons/beach.png')}
            style={styles.legendIcon}
          />
          <Text style={styles.legendTitle}>Playas</Text>
          <View
            style={[
              styles.legendSwitch,
              showBeaches ? styles.switchOn : styles.switchOff,
            ]}
          >
            <Text style={styles.switchText}>
              {showBeaches ? 'ON' : 'OFF'}
            </Text>
          </View>
        </Pressable>
        <View style={styles.legendSub}>
          {[
            [BEACH_COLORS.open, 'Apta'],
            [BEACH_COLORS.warning, 'Aviso'],
            [BEACH_COLORS.closed, 'Cerrada'],
            [BEACH_COLORS.unmonitored, 'Sin monitorizar'],
          ].map(([color, label]) => (
            <View key={label} style={styles.swatchRow}>
              <View style={[styles.dot, { backgroundColor: color }]} />
              <Text style={styles.swatchText}>{label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.controls}>
        <Pressable
          style={styles.toggle}
          onPress={() => setSatellite((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel="Cambiar vista del mapa"
        >
          <Image
            source={
              satellite
                ? require('../assets/icons/icon-map.png')
                : require('../assets/icons/icon-satellite.png')
            }
            style={styles.toggleIcon}
          />
          <Text style={styles.toggleText}>
            {satellite ? 'Mapa' : 'Satélite'}
          </Text>
        </Pressable>
        {onOpenList && (
          <Pressable
            style={styles.toggle}
            onPress={onOpenList}
            accessibilityRole="button"
            accessibilityLabel="Abrir lista de playas"
          >
            <Image
              source={require('../assets/icons/beach.png')}
              style={styles.toggleIcon}
            />
            <Text style={styles.toggleText}>Playas</Text>
          </Pressable>
        )}
        {onOpenOutfalls && (
          <Pressable
            style={styles.toggle}
            onPress={onOpenOutfalls}
            accessibilityRole="button"
            accessibilityLabel="Abrir lista de vertidos"
          >
            <Image
              source={require('../assets/icons/icon-faucet.png')}
              style={styles.toggleIcon}
            />
            <Text style={styles.toggleText}>Vertidos</Text>
          </Pressable>
        )}
        {onOpenMunicipalities && (
          <Pressable
            style={styles.toggle}
            onPress={onOpenMunicipalities}
            accessibilityRole="button"
            accessibilityLabel="Abrir incidencias por municipio"
          >
            <Image
              source={require('../assets/icons/icon-townhall.png')}
              style={styles.toggleIcon}
            />
            <Text style={styles.toggleText}>Municipios</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  bannerWrap: {
    position: 'absolute',
    top: (Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 24) + 24,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  banner: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 7,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  bannerText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: fonts.bold,
  },
  controls: {
    position: 'absolute',
    top: (Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 24) + 68,
    right: 16,
    gap: 8,
    alignItems: 'flex-end',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    elevation: 4,
  },
  toggleIcon: {
    width: 16,
    height: 16,
    marginRight: 6,
  },
  toggleText: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  legend: {
    position: 'absolute',
    top: (Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 24) + 68,
    left: 12,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 8,
    padding: 10,
    elevation: 4,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 140,
  },
  legendSwitch: {
    marginLeft: 'auto',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  switchOn: {
    backgroundColor: colors.primary,
  },
  switchOff: {
    backgroundColor: colors.off,
  },
  switchText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: fonts.extrabold,
  },
  legendOff: {
    opacity: 0.35,
  },
  legendTitle: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  legendIcon: {
    width: 16,
    height: 16,
    marginRight: 6,
  },
  legendSub: {
    marginLeft: 14,
    marginBottom: 4,
  },
  swatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#fff',
  },
  swatchText: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
});

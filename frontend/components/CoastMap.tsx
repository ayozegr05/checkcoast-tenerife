import React, { useEffect, useRef, useState } from 'react';
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

// Estilo raster con tiles de OpenStreetMap (sin API key)
const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

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
  onSelect: (selection: Selection) => void;
  onOpenList?: () => void;
};

const STATUS_COLORS: Record<string, string> = {
  legal: '#2e7d32',
  illegal: '#c62828',
  unknown: '#f9a825',
};
const BEACH_COLOR = '#0288d1';
const BEACH_ALERT_COLOR = '#e65100';
const BEACH_UNMONITORED_COLOR = '#9e9e9e';

export default function CoastMap({
  outfalls,
  beaches,
  focus,
  onSelect,
  onOpenList,
}: CoastMapProps) {
  const [satellite, setSatellite] = useState(false);
  const [showOutfalls, setShowOutfalls] = useState(true);
  const [showBeaches, setShowBeaches] = useState(true);
  const cameraRef = useRef<CameraRef>(null);

  // Vuela a la playa elegida en la lista
  useEffect(() => {
    if (focus) {
      cameraRef.current?.flyTo({ center: focus, zoom: 13, duration: 1500 });
    }
  }, [focus]);

  const handlePress =
    (type: 'outfall' | 'beach') =>
    (e: NativeSyntheticEvent<PressEventWithFeatures>) => {
      const feature = e.nativeEvent.features?.[0] as unknown as
        | GeoFeature
        | undefined;
      if (!feature) return;
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
        mapStyle={satellite ? SATELLITE_STYLE : OSM_STYLE}
        attributionPosition={{ bottom: 8, right: 8 }}
      >
        <Camera ref={cameraRef} initialViewState={TENERIFE_VIEW} />

        <Images
          images={{
            'icon-beach': require('../assets/icons/beach.png'),
            'icon-outfall': {
              source: require('../assets/icons/outfall_sil.png'),
              sdf: true,
            },
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
                'icon-image': 'icon-outfall',
                'icon-size': 0.5,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
              }}
              paint={{
                'icon-color': [
                  'match',
                  ['get', 'status'],
                  'legal',
                  STATUS_COLORS.legal,
                  'illegal',
                  STATUS_COLORS.illegal,
                  STATUS_COLORS.unknown,
                ],
                'icon-halo-color': '#ffffff',
                'icon-halo-width': 2,
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
              id="beach-points"
              type="circle"
              paint={{
                'circle-radius': 8,
                'circle-color': [
                  'case',
                  ['get', 'alert'],
                  BEACH_ALERT_COLOR,
                  ['==', ['get', 'monitored'], false],
                  BEACH_UNMONITORED_COLOR,
                  BEACH_COLOR,
                ],
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ffffff',
              }}
            />
            <Layer
              id="beach-icons"
              type="symbol"
              layout={{
                'icon-image': 'icon-beach',
                'icon-size': 0.22,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
              }}
            />
          </GeoJSONSource>
        )}
      </Map>

      <View style={styles.legend}>
        <Pressable
          style={[styles.legendRow, !showOutfalls && styles.legendOff]}
          onPress={() => setShowOutfalls((v) => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: showOutfalls }}
        >
          <Image
            source={require('../assets/icons/outfall.png')}
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
            [STATUS_COLORS.legal, 'Autorizado'],
            [STATUS_COLORS.illegal, 'No autorizado'],
            [STATUS_COLORS.unknown, 'En trámite'],
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
            [BEACH_COLOR, 'Normal'],
            [BEACH_ALERT_COLOR, 'Alerta'],
            [BEACH_UNMONITORED_COLOR, 'Sin monitorizar'],
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
  controls: {
    position: 'absolute',
    top: (Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 24) + 24,
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
    fontWeight: '600',
    color: '#222',
  },
  legend: {
    position: 'absolute',
    top: (Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 24) + 24,
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
    backgroundColor: '#2e7d32',
  },
  switchOff: {
    backgroundColor: '#bdbdbd',
  },
  switchText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  legendOff: {
    opacity: 0.35,
  },
  legendTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#222',
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
    color: '#444',
  },
});

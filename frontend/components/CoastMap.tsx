import React, { useState } from 'react';
import {
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
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

// Estilo raster satélite con Esri World Imagery (gratuito, sin API key)
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
  },
  layers: [{ id: 'esri', type: 'raster', source: 'esri' }],
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
  onSelect: (selection: Selection) => void;
};

export default function CoastMap({ outfalls, beaches, onSelect }: CoastMapProps) {
  const [satellite, setSatellite] = useState(false);

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
        <Camera initialViewState={TENERIFE_VIEW} />

        <GeoJSONSource
          id="outfalls"
          data={outfalls}
          onPress={handlePress('outfall')}
        >
          <Layer
            id="outfall-points"
            type="circle"
            paint={{
              'circle-radius': 7,
              'circle-color': [
                'match',
                ['get', 'status'],
                'legal',
                '#2e7d32',
                'illegal',
                '#c62828',
                '#f9a825',
              ],
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
            }}
          />
        </GeoJSONSource>

        <GeoJSONSource
          id="beaches"
          data={beaches}
          onPress={handlePress('beach')}
        >
          <Layer
            id="beach-points"
            type="circle"
            paint={{
              'circle-radius': 6,
              'circle-color': [
                'case',
                ['get', 'alert'],
                '#e65100',
                '#0288d1',
              ],
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
            }}
          />
        </GeoJSONSource>
      </Map>

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
  toggle: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    elevation: 4,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#222',
  },
});

import React from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';

import type { GeoFeature } from '../lib/api';

// Centro aproximado de Tenerife
const TENERIFE_REGION: Region = {
  latitude: 28.2916,
  longitude: -16.6291,
  latitudeDelta: 0.6,
  longitudeDelta: 0.6,
};

const OUTFALL_COLORS: Record<string, string> = {
  legal: '#2e7d32',
  illegal: '#c62828',
  unknown: '#f9a825',
};

export type Selection =
  | { type: 'outfall'; feature: GeoFeature }
  | { type: 'beach'; feature: GeoFeature; hasAlert: boolean };

type CoastMapProps = {
  outfalls: GeoFeature[];
  beaches: GeoFeature[];
  alertBeachIds: Set<number>;
  onSelect: (selection: Selection) => void;
};

export default function CoastMap({
  outfalls,
  beaches,
  alertBeachIds,
  onSelect,
}: CoastMapProps) {
  return (
    <View style={styles.container}>
      <MapView style={styles.map} initialRegion={TENERIFE_REGION}>
        {outfalls.map((f) => (
          <Marker
            key={`outfall-${f.id}`}
            coordinate={{
              longitude: f.geometry.coordinates[0],
              latitude: f.geometry.coordinates[1],
            }}
            pinColor={OUTFALL_COLORS[f.properties.status ?? 'unknown']}
            onPress={() => onSelect({ type: 'outfall', feature: f })}
          />
        ))}
        {beaches.map((f) => {
          const hasAlert = alertBeachIds.has(f.id);
          return (
            <Marker
              key={`beach-${f.id}`}
              coordinate={{
                longitude: f.geometry.coordinates[0],
                latitude: f.geometry.coordinates[1],
              }}
              onPress={() => onSelect({ type: 'beach', feature: f, hasAlert })}
            >
              <View
                style={[
                  styles.beachDot,
                  hasAlert ? styles.beachDotAlert : styles.beachDotOk,
                ]}
              />
            </Marker>
          );
        })}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    width: '100%',
    height: '100%',
  },
  beachDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#fff',
  },
  beachDotOk: {
    backgroundColor: '#0288d1',
  },
  beachDotAlert: {
    backgroundColor: '#e65100',
  },
});

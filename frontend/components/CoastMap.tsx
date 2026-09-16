import React from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';

// Centro aproximado de Tenerife
const TENERIFE_REGION: Region = {
  latitude: 28.2916,
  longitude: -16.6291,
  latitudeDelta: 0.6,
  longitudeDelta: 0.6,
};

export type OutfallMarker = {
  id: string;
  latitude: number;
  longitude: number;
  title: string;
  isLegal: boolean;
};

type CoastMapProps = {
  markers?: OutfallMarker[];
};

export default function CoastMap({ markers = [] }: CoastMapProps) {
  return (
    <View style={styles.container}>
      <MapView style={styles.map} initialRegion={TENERIFE_REGION}>
        {markers.map((m) => (
          <Marker
            key={m.id}
            coordinate={{ latitude: m.latitude, longitude: m.longitude }}
            title={m.title}
            pinColor={m.isLegal ? 'green' : 'red'}
          />
        ))}
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
});

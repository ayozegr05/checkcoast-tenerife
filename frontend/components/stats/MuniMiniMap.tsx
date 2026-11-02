import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { muniMapImage } from '../../lib/muniMap';

// Silueta de Tenerife con el municipio resaltado en el acento — PNG
// generado desde los límites del Cabildo (build_muni_map.py). La
// tarjeta blanca deja leer la isla sobre el gradiente de la cabecera
export default function MuniMiniMap({ name }: { name: string }) {
  const src = muniMapImage(name);
  if (!src) return null;
  return (
    <View
      style={styles.card}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Mapa de Tenerife con ${name} resaltado`}
    >
      <Image source={src} style={styles.img} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    // Tinte mar pálido — la tarjeta se lee como mapa náutico, no
    // como una caja blanca pegada sobre el gradiente
    backgroundColor: '#e6f1f5',
    borderRadius: 10,
    padding: 8,
  },
  // El PNG va recortado al bounding box de la isla (~1.19:1)
  img: { width: 136, height: 114 },
});

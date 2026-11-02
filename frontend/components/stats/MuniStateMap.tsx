import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { MUNI_BASE, muniOverlay } from '../../lib/muniMap';

// Isla de Tenerife con municipios coloreados por estado: la base
// dibuja la isla entera en gris y cada silueta se apila teñida con
// `tintColor` (mismo recorte → alineación exacta). `tint` asocia el
// nombre del municipio con el color que debe tomar en el mapa
export default function MuniStateMap({
  tint,
  width = 220,
}: {
  tint: Record<string, string>;
  width?: number;
}) {
  const overlays = Object.entries(tint)
    .map(([name, color]) => ({ name, color, src: muniOverlay(name) }))
    .filter(
      (o): o is { name: string; color: string; src: number } => o.src !== null,
    );
  const height = Math.round(width / 1.19); // proporción del recorte
  return (
    <View
      style={{ width, height }}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Mapa de Tenerife con municipios destacados"
    >
      <Image
        source={MUNI_BASE}
        style={{ width, height }}
        resizeMode="contain"
      />
      {overlays.map((o) => (
        <Image
          key={o.name}
          source={o.src}
          style={[
            StyleSheet.absoluteFill,
            { width, height, tintColor: o.color },
          ]}
          resizeMode="contain"
        />
      ))}
    </View>
  );
}

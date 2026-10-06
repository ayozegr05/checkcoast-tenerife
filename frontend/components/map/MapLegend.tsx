import React from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';

import { BEACH_STATES, OUTFALL_STATES } from '../../lib/mapData';
import { colors, fonts } from '../../lib/theme';

type MapLegendProps = {
  beachSel: Set<string>;
  outfallSel: Set<string>;
};

// Leyenda fija abajo: atenúa los estados ocultos en el panel de capas
export default function MapLegend({ beachSel, outfallSel }: MapLegendProps) {
  return (
    <View style={styles.legend} pointerEvents="box-none">
      {/* Leyenda siempre visible: dos filas (Emisarios / Playas)
            pegadas abajo — sin botón Capas */}
      <View style={styles.legendCard}>
        <View style={styles.layerRow}>
          <Image
            source={require('../../assets/icons/icon-faucet.png')}
            style={styles.legendIcon}
          />
          <View style={styles.legendSub}>
            {OUTFALL_STATES.map(([color, label, key]) => (
              <View
                key={label}
                style={[
                  styles.swatchRow,
                  !outfallSel.has(key) && styles.swatchDimmed,
                ]}
              >
                <View style={[styles.dot, { backgroundColor: color }]} />
                <Text style={styles.swatchText}>{label}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={[styles.layerRow, { marginTop: 13 }]}>
          <Image
            source={require('../../assets/icons/beach.png')}
            style={styles.legendIcon}
          />
          <View style={styles.legendSub}>
            {BEACH_STATES.map(([color, label, key]) => (
              <View
                key={label}
                style={[
                  styles.swatchRow,
                  !beachSel.has(key) && styles.swatchDimmed,
                ]}
              >
                <View style={[styles.dot, { backgroundColor: color }]} />
                <Text style={styles.swatchText}>{label}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Wrapper posicional a todo lo ancho: centra la tarjeta de capas
  legend: {
    position: 'absolute',
    // 46 despeja la barra de gestos y casi la de 3 botones (~48dp);
    // número fijo porque no usamos safe-area-context
    bottom: Platform.OS === 'android' ? 46 : 10,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  legendCard: {
    width: '97%', // ancho fijo: tapa las etiquetas de mar a los lados
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 10,
    elevation: 4,
    // Desplazada a la izquierda: tapa el logo de MapLibre (fijo
    // abajo-izquierda, independiente de attributionPosition)
    transform: [{ translateX: -0.5 }],
  },
  // Icono + swatches como un solo bloque centrado en la card (sin
  // flex:1 en legendSub, si no el icono queda pinchado a la izquierda)
  layerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    justifyContent: 'center',
  },
  legendIcon: {
    width: 18,
    height: 18,
    marginLeft: -4,
    marginRight: 14,
  },
  // Swatches informativos en línea (no interactivos — las capas se
  // controlan desde el panel del botón flotante). wrap + flexShrink
  // obligatorios: sin ellos la fila se centra como bloque mayor que
  // el hueco y recorta el primer y último swatch por igual
  // (pantallas estrechas / fuente grande de accesibilidad)
  legendSub: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    flexShrink: 1,
    justifyContent: 'center',
    gap: 14,
    rowGap: 4,
  },
  swatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // La leyenda refleja el filtro: estado desmarcado en el panel =
  // swatch atenuado ("esto es lo que estás viendo ahora")
  swatchDimmed: {
    opacity: 0.35,
  },
  swatchText: {
    fontSize: 12,
    lineHeight: 19,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#fff',
  },
});

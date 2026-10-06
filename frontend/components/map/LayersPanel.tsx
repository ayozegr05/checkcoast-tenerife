import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  BEACH_STATES,
  OUTFALL_STATES,
  toggleInSet,
  type LayerState,
} from '../../lib/mapData';
import { colors, fonts } from '../../lib/theme';

type LayersPanelProps = {
  beachSel: Set<string>;
  setBeachSel: React.Dispatch<React.SetStateAction<Set<string>>>;
  outfallSel: Set<string>;
  setOutfallSel: React.Dispatch<React.SetStateAction<Set<string>>>;
};

// Panel de capas: un checkbox por estado de emisario y de playa
export default function LayersPanel({
  beachSel,
  setBeachSel,
  outfallSel,
  setOutfallSel,
}: LayersPanelProps) {
  // Fila del panel de capas: checkbox cuadrado + dot de color + label.
  // Marcado = visible en el mapa
  const checkRow = (
    rowKey: string,
    color: string,
    label: string,
    on: boolean,
    onPress: () => void,
    isAll = false,
  ) => (
    <Pressable
      key={rowKey}
      style={({ pressed }) => [
        styles.layerItem,
        pressed && styles.layerItemPressed,
      ]}
      onPress={onPress}
      accessibilityRole="togglebutton"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
    >
      <View
        style={[
          styles.check,
          { borderColor: color },
          on && { backgroundColor: color },
        ]}
      >
        {on && <Text style={styles.checkMark}>✓</Text>}
      </View>
      {!isAll && <View style={[styles.dot, { backgroundColor: color }]} />}
      <Text
        style={[
          styles.layerItemText,
          isAll && styles.layerItemTextAll,
          !on && styles.layerItemTextOff,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );

  // Sección del panel (Emisarios / Playas): cabecera + fila Todas +
  // una fila por estado
  const layerSection = (
    title: string,
    allLabel: string,
    states: LayerState[],
    sel: Set<string>,
    setSel: React.Dispatch<React.SetStateAction<Set<string>>>,
  ) => {
    const allOn = sel.size === states.length;
    return (
      <View style={styles.layerSection}>
        <Text style={styles.layerHead}>{title}</Text>
        {checkRow(
          `${title}-all`,
          colors.primary,
          allLabel,
          allOn,
          () => setSel(allOn ? new Set() : new Set(states.map(([, , k]) => k))),
          true,
        )}
        {states.map(([color, label, key]) =>
          checkRow(key, color, label, sel.has(key), () =>
            setSel((s) => toggleInSet(s, key)),
          ),
        )}
      </View>
    );
  };

  return (
    <View style={styles.layersPanel}>
      {layerSection(
        'Emisarios',
        'Todos',
        OUTFALL_STATES,
        outfallSel,
        setOutfallSel,
      )}
      <View style={styles.layerDivider} />
      {layerSection('Playas', 'Todas', BEACH_STATES, beachSel, setBeachSel)}
    </View>
  );
}

const styles = StyleSheet.create({
  // Panel de capas: tarjeta desplegable bajo el botón, alineada a la
  // derecha; tap al mapa la cierra
  layersPanel: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 232 : 216,
    right: 18,
    width: 210,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    // Por encima del backdrop de overlays (30) para seguir interactivo
    zIndex: 40,
    elevation: 40,
  },
  layerSection: {
    paddingHorizontal: 6,
  },
  layerDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 7,
    marginHorizontal: 2,
  },
  layerHead: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fonts.extrabold,
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 4,
    marginBottom: 2,
  },
  layerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  layerItemPressed: {
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  layerItemText: {
    fontSize: 13,
    lineHeight: 17,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  layerItemTextAll: {
    fontFamily: fonts.semibold,
  },
  layerItemTextOff: {
    color: colors.textFaint,
  },
  check: {
    width: 15,
    height: 15,
    borderRadius: 4,
    borderWidth: 2,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: {
    color: '#fff',
    fontSize: 10,
    lineHeight: 11,
    fontFamily: fonts.extrabold,
    includeFontPadding: false,
    textAlign: 'center',
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

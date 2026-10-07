import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { GeoFeature } from '../../lib/api';
import { beachStatusKey, BEACH_STATUS_TEXT } from '../../lib/beachStatus';
import { displayBeachName, pointLongLabel } from '../../lib/format';
import { colors, fonts } from '../../lib/theme';

type ZonePickerProps = {
  members: GeoFeature[];
  onPick: (m: GeoFeature) => void;
};

// Selector de PMs: si la playa agrupada tiene varios puntos de
// muestreo, la card muestra primero la lista y el usuario elige
export default function ZonePicker({ members, onPick }: ZonePickerProps) {
  return (
    <View>
      <Text style={styles.pmHint}>{members.length} zonas de esta playa</Text>
      {members.map((m) => {
        const k = beachStatusKey(m);
        return (
          <Pressable
            key={m.id}
            style={({ pressed }) => [styles.pmRow, pressed && styles.pressFx]}
            onPress={() => onPick(m)}
            accessibilityRole="button"
            accessibilityLabel={`${
              pointLongLabel(m.properties.name) ??
              displayBeachName(m.properties.name)
            }, ${BEACH_STATUS_TEXT[k]}`}
            accessibilityHint="Abrir ficha de este punto de muestreo"
          >
            <View
              style={[styles.pmDot, { backgroundColor: colors.status[k] }]}
            />
            <View style={styles.pmText}>
              <Text style={styles.pmName}>
                {pointLongLabel(m.properties.name) ??
                  displayBeachName(m.properties.name)}
              </Text>
              <Text style={styles.pmStatus}>{BEACH_STATUS_TEXT[k]}</Text>
            </View>
            <Text style={styles.pmChevron}>›</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Feedback táctil común: leve fundido al presionar
  pressFx: {
    opacity: 0.6,
  },
  pmHint: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 6,
    marginBottom: 4,
  },
  pmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pmDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  pmText: {
    flex: 1,
  },
  pmName: {
    fontSize: 14,
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  pmStatus: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 1,
  },
  pmChevron: {
    fontSize: 18,
    color: colors.textFaint,
  },
});

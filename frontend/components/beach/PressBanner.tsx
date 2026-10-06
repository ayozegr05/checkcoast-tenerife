import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { NewsGroup } from '../../lib/news';
import type { pressSummary } from '../../lib/press';
import { colors, fonts } from '../../lib/theme';
import NewsGroupList from './NewsGroupList';

type PressBannerProps = {
  press: ReturnType<typeof pressSummary>;
  // Tono verde de reapertura reciente
  reopened: boolean;
  groups: NewsGroup[];
  itemCount: number;
  open: boolean;
  onToggle: () => void;
};

// Banner "según prensa" de la ficha: resumen + titulares desplegables
export default function PressBanner({
  press,
  reopened,
  groups,
  itemCount,
  open,
  onToggle,
}: PressBannerProps) {
  return (
    <View style={[styles.pressBanner, reopened && styles.pressBannerReopened]}>
      <Text
        style={[
          styles.pressBannerText,
          reopened && styles.pressBannerTextReopened,
        ]}
      >
        {press.main}
      </Text>
      <Text
        style={[
          styles.pressBannerSub,
          reopened && styles.pressBannerSubReopened,
        ]}
      >
        {press.sub}
      </Text>
      <Pressable
        onPress={onToggle}
        hitSlop={8}
        style={({ pressed }) => pressed && styles.pressFx}
        accessibilityRole="button"
        accessibilityLabel={
          open
            ? 'Ocultar titulares de prensa'
            : `Ver ${itemCount} titulares de prensa`
        }
      >
        <Text
          style={[styles.newsToggle, reopened && styles.newsToggleReopened]}
        >
          {open ? 'Ocultar titulares ▴' : `Ver titulares (${itemCount}) ▾`}
        </Text>
      </Pressable>
      {open && (
        <>
          <NewsGroupList
            groups={groups}
            accentOverride={reopened ? colors.status.open : undefined}
          />
          <Text style={styles.chartFoot}>
            Contexto de prensa: no altera el estado oficial (Náyade)
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Feedback táctil común: leve fundido al presionar
  pressFx: {
    opacity: 0.6,
  },
  chartFoot: {
    fontSize: 10,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 4,
  },
  pressBanner: {
    marginTop: 8,
    borderLeftWidth: 3,
    borderLeftColor: colors.status.warning,
    backgroundColor: '#fff3e0',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  pressBannerReopened: {
    borderLeftColor: colors.status.open,
    backgroundColor: '#e6f4f1',
  },
  pressBannerText: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: colors.status.warning,
  },
  pressBannerTextReopened: {
    color: colors.status.open,
  },
  pressBannerSub: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.status.warning,
    marginTop: 1,
  },
  pressBannerSubReopened: {
    color: colors.status.open,
  },
  newsToggle: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.status.warning,
    marginBottom: 4,
  },
  // En el banner de reapertura (verde) el enlace sigue la paleta
  newsToggleReopened: {
    color: colors.status.open,
  },
});

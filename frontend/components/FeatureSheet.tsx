import React, { useEffect, useRef } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import BeachDetail from './BeachDetail';
import type { Selection } from './CoastMap';
import { colors, fonts } from '../lib/theme';

const STATUS_LABELS: Record<string, string> = {
  legal: 'Autorizado',
  illegal: 'No autorizado',
  unknown: 'En trámite / sin datos',
};

const STATUS_COLORS = colors.outfall;

// Hoja arrastrable estilo bottom-sheet: peek (~45%) -> expandida (~88%)
// -> cerrada (deslizar abajo). Sin deps nativas: PanResponder + Animated.
export default function FeatureSheet({
  selection,
  onClose,
}: {
  selection: Selection;
  onClose: () => void;
}) {
  const { feature } = selection;
  const p = feature.properties;
  const isBeach = selection.type === 'beach';
  const statusKey = p.status ?? 'unknown';

  const winH = useWindowDimensions().height;
  const FULL_TY = Math.round(winH * 0.12); // expandida
  const PEEK_TY = Math.round(winH * 0.55); // peek
  const ty = useRef(new Animated.Value(winH)).current; // oculta abajo
  const snapped = useRef(PEEK_TY);
  const closing = useRef(false);

  // Entrada: sube hasta peek al montar
  useEffect(() => {
    Animated.spring(ty, {
      toValue: PEEK_TY,
      useNativeDriver: true,
      damping: 20,
      stiffness: 200,
    }).start();
  }, [PEEK_TY, ty]);

  const snapTo = (target: number) => {
    snapped.current = target;
    Animated.spring(ty, {
      toValue: target,
      useNativeDriver: true,
      damping: 22,
      stiffness: 260,
    }).start();
  };

  const dismiss = () => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(ty, {
      toValue: winH,
      duration: 200,
      useNativeDriver: true,
    }).start(({ finished }) => finished && onClose());
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6,
      onPanResponderMove: (_e, g) => {
        const y = Math.max(
          FULL_TY - 30,
          Math.min(winH, snapped.current + g.dy),
        );
        ty.setValue(y);
      },
      onPanResponderRelease: (_e, g) => {
        const y = snapped.current + g.dy;
        const mid = (FULL_TY + PEEK_TY) / 2;
        if (y > PEEK_TY + 90 || g.vy > 1.4) dismiss();
        else if (y < mid || g.vy < -1.2) snapTo(FULL_TY);
        else snapTo(PEEK_TY);
      },
    }),
  ).current;

  return (
    <Animated.View
      style={[styles.sheet, { height: winH * 0.88, transform: [{ translateY: ty }] }]}
    >
      {/* Zona de agarre: asa + cabecera responden al arrastre */}
      <View {...pan.panHandlers}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={2}>
            {p.name}
          </Text>
          <Pressable onPress={dismiss} hitSlop={12}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {isBeach ? (
          <BeachDetail feature={feature} hasAlert={selection.hasAlert} />
        ) : (
          <View>
            <View
              style={[
                styles.chip,
                {
                  backgroundColor:
                    STATUS_COLORS[statusKey] ?? colors.status.unknown,
                },
              ]}
            >
              <Text style={styles.chipText}>
                {STATUS_LABELS[statusKey] ?? 'En trámite / sin datos'}
              </Text>
            </View>
            {p.kind ? <Text style={styles.row}>Tipo: {p.kind}</Text> : null}
            {p.municipality ? (
              <Text style={styles.row}>Municipio: {p.municipality}</Text>
            ) : null}
            <Text style={styles.row}>
              Fuente: Censo de Vertidos 2025 (Gob. Canarias)
            </Text>
          </View>
        )}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginTop: 8,
    marginBottom: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  close: {
    fontSize: 18,
    color: colors.textMuted,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 16,
    paddingBottom: 28,
  },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 8,
    marginBottom: 4,
  },
  chipText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  row: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.text,
    marginTop: 4,
  },
});

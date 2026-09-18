import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import BeachDetail from './BeachDetail';
import type { Selection } from './CoastMap';
import type { GeoFeature } from '../lib/api';
import {
  OutfallNearestBeach,
  fetchOutfallNearestBeach,
} from '../lib/api';
import {
  beachBaseName,
  beachPointLabel,
  displayBeachName,
} from '../lib/format';
import { colors, fonts } from '../lib/theme';

const STATUS_LABELS: Record<string, string> = {
  legal: 'Autorizado',
  illegal: 'No autorizado',
  unknown: 'En trámite',
};

const STATUS_COLORS = colors.outfall;

// Estado de playa para el selector de puntos de muestreo
const beachStatusKey = (f: GeoFeature) =>
  f.properties.monitored === false
    ? 'unmonitored'
    : (f.properties.status ?? 'unknown');

const BEACH_STATUS_TEXT: Record<string, string> = {
  closed: 'Cierre activo',
  warning: 'Aviso activo',
  open: 'Sin alertas activas',
  unknown: 'Sin datos oficiales',
  unmonitored: 'Sin monitorizar',
};

const fmtDistance = (m: number) =>
  m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;

// Card flotante arrastrable: peek (~42% alto) -> expandida (~86%) ->
// cerrada (deslizar abajo). Anima la ALTURA (no translateY) para que la
// card termine dentro de pantalla y se vea el mar debajo.
// Sin deps nativas: PanResponder + Animated.
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

  // Selector de PMs: si la playa agrupada tiene varios puntos de
  // muestreo, la card muestra primero la lista y el usuario elige
  const members = isBeach ? (selection.members ?? []) : [];
  const [chosenPm, setChosenPm] = useState<GeoFeature | null>(null);
  useEffect(() => setChosenPm(null), [selection]);
  const showPmPicker = isBeach && members.length > 1 && !chosenPm;
  const beachFeature = chosenPm ?? feature;

  const winH = useWindowDimensions().height;
  // Card anclada ABAJO: al expandir crece hacia arriba hasta ~92% de
  // pantalla. Antes el top estaba fijo al 45% y el máximo era solo
  // ~55%, así que "Ver más" no expandía de verdad.
  const NAV_INSET = Platform.OS === 'android' ? 30 : 0;
  const CARD_BOTTOM = 14 + NAV_INSET; // flota sobre la barra de gestos
  const TOP_MARGIN = Math.round(winH * 0.08);
  const CARD_MAX = Math.round(winH - CARD_BOTTOM - TOP_MARGIN);
  const HEADER_H = 64; // asa + titulo aprox
  const [bodyH, setBodyH] = useState(0);
  // Peek = altura del contenido (con minimo razonable y tope CARD_MAX)
  const peek = Math.max(170, Math.min(CARD_MAX, bodyH + HEADER_H));
  const h = useRef(new Animated.Value(0)).current; // cerrada = alto 0
  const snapped = useRef(0);
  const expanded = useRef(false);
  const closing = useRef(false);
  // Estado espejo de expanded para re-render (el ref no dispara render)
  const [isExpanded, setIsExpanded] = useState(false);

  // Playa mas cercana al vertido (contexto de impacto)
  const [nearest, setNearest] = useState<OutfallNearestBeach | null>(null);
  useEffect(() => {
    if (isBeach) return;
    setNearest(null);
    fetchOutfallNearestBeach(feature.id)
      .then(setNearest)
      .catch(() => setNearest(null));
  }, [feature.id, isBeach]);

  const snapTo = (target: number, isExpanded = false) => {
    snapped.current = target;
    expanded.current = isExpanded;
    setIsExpanded(isExpanded);
    Animated.spring(h, {
      toValue: target,
      useNativeDriver: false,
      damping: 22,
      stiffness: 260,
    }).start();
  };

  // Peek se reajusta cuando el contenido termina de medirse/cargar
  useEffect(() => {
    if (!expanded.current && !closing.current) snapTo(peek);
  }, [peek]);

  const dismiss = () => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(h, {
      toValue: 0,
      duration: 180,
      useNativeDriver: false,
    }).start(({ finished }) => finished && onClose());
  };

  // Título: el picker muestra el nombre de la playa; el detalle el
  // del punto elegido (Teresitas -> "… · PM2" porque sus PMs se llaman
  // igual; Troya ya se distingue por el romano)
  const stripPm = (n: string) => n.replace(/\s+PM\d+$/, '');
  const sameBase =
    members.length > 1 &&
    new Set(members.map((m) => stripPm(m.properties.name))).size === 1;
  const pmSuffix =
    chosenPm && sameBase
      ? ` · ${chosenPm.properties.name.match(/PM\d+$/)?.[0] ?? ''}`
      : '';
  const title = showPmPicker
    ? displayBeachName(beachBaseName(p.name))
    : displayBeachName(stripPm(beachFeature.properties.name)) + pmSuffix;

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6,
      onPanResponderMove: (_e, g) => {
        // Arrastrar hacia abajo (dy>0) encoge la card
        const nh = Math.max(
          60,
          Math.min(CARD_MAX, snapped.current - g.dy),
        );
        h.setValue(nh);
      },
      onPanResponderRelease: (_e, g) => {
        const nh = snapped.current - g.dy;
        const mid = (peek + CARD_MAX) / 2;
        if (nh < peek * 0.55 || g.vy > 1.4) dismiss();
        else if (nh > mid || g.vy < -1.2) snapTo(CARD_MAX, true);
        else snapTo(peek);
      },
    }),
  ).current;

  return (
    <Animated.View
      style={[styles.sheet, { bottom: CARD_BOTTOM, height: h }]}
    >
      {/* Zona de agarre: asa + cabecera responden al arrastre */}
      <View {...pan.panHandlers}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={2}>
            {title}
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
        onContentSizeChange={(_w, ch) => setBodyH(ch)}
      >
        {isBeach ? (
          showPmPicker ? (
            <View>
              <Text style={styles.pmHint}>
                {members.length} puntos de muestreo oficiales
              </Text>
              {members.map((m) => {
                const k = beachStatusKey(m);
                return (
                  <Pressable
                    key={m.id}
                    style={styles.pmRow}
                    onPress={() => setChosenPm(m)}
                  >
                    <View
                      style={[
                        styles.pmDot,
                        { backgroundColor: colors.status[k] },
                      ]}
                    />
                    <View style={styles.pmText}>
                      <Text style={styles.pmName}>
                        {beachPointLabel(m.properties.name) ??
                          displayBeachName(m.properties.name)}
                      </Text>
                      <Text style={styles.pmStatus}>
                        {BEACH_STATUS_TEXT[k]}
                      </Text>
                    </View>
                    <Text style={styles.pmChevron}>›</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <View>
              {members.length > 1 && (
                <Pressable onPress={() => setChosenPm(null)} hitSlop={6}>
                  <Text style={styles.pmBack}>
                    ‹ {members.length} puntos de muestreo
                  </Text>
                </Pressable>
              )}
              <BeachDetail
                feature={beachFeature}
                hasAlert={
                  chosenPm
                    ? chosenPm.properties.alert === true
                    : selection.hasAlert
                }
              />
            </View>
          )
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
            {nearest ? (
              <View
                style={[
                  styles.nearestBox,
                  {
                    borderLeftColor:
                      STATUS_COLORS[statusKey] ?? colors.status.unknown,
                  },
                ]}
              >
                <Text style={styles.nearestText}>
                  Playa más cercana:{' '}
                  <Text style={styles.nearestName}>
                    {displayBeachName(nearest.beach_name)}
                  </Text>
                  {' · '}a {fmtDistance(nearest.distance_m)}
                </Text>
              </View>
            ) : null}
            <Text style={styles.row}>
              Fuente: Censo de Vertidos 2025 (Gob. Canarias)
            </Text>
          </View>
        )}
      </ScrollView>

      {/* "Ver más": insinúa que hay contenido debajo y expande la card
          (solo si el contenido no cabe en el peek) */}
      {bodyH + HEADER_H > CARD_MAX + 8 && !isExpanded && (
        <Pressable
          style={styles.moreBtn}
          onPress={() => snapTo(CARD_MAX, true)}
          accessibilityRole="button"
          accessibilityLabel="Ver más contenido de la ficha"
        >
          <Text style={styles.moreText}>Ver más ⌄</Text>
        </Pressable>
      )}

    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 10,
    right: 10,
    backgroundColor: colors.surface,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 10,
    overflow: 'hidden',
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
  nearestBox: {
    marginTop: 8,
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 6,
    backgroundColor: colors.background,
    borderRadius: 4,
  },
  nearestText: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  nearestName: {
    fontFamily: fonts.bold,
    color: colors.text,
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
  pmBack: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.primary,
    marginTop: 8,
  },
  moreBtn: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: colors.primary,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  moreText: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: '#fff',
  },
});

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Platform,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import BeachDetail from './BeachDetail';
import SatelliteShot from './SatelliteShot';
import type { Selection } from './CoastMap';
import type { GeoFeature } from '../lib/api';
import {
  OutfallNearestBeach,
  fetchOutfallNearestBeach,
} from '../lib/api';
import {
  beachBaseName,
  pointLongLabel,
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
  f.properties.monitored === false && f.properties.alert !== true
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
  outfalls,
  beaches,
  onViewOnMap,
  onSelectOutfall,
  onSelectBeach,
}: {
  selection: Selection;
  onClose: () => void;
  // Emisarios cargados en la app: se superponen a la foto satélite
  outfalls?: GeoFeature[];
  // Playas cargadas: se superponen a la foto satélite del emisario
  beaches?: GeoFeature[];
  // Tap en la foto satélite → ver el punto en el mapa
  onViewOnMap?: () => void;
  // Tap en un emisario cercano de la ficha de playa → verlo en el
  // mapa; el 2º arg es la ficha concreta abierta (el PM elegido si la
  // playa tiene varios) para que "atrás" vuelva a ELLA, no al picker
  onSelectOutfall?: (feature: GeoFeature, origin: GeoFeature) => void;
  // Tap en "Playa más cercana" de la ficha de emisario → verla en el mapa
  onSelectBeach?: (feature: GeoFeature) => void;
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
  // La topbar queda siempre visible: la card ni en expandido la tapa
  const TOP_MARGIN = 118;
  const CARD_MAX = Math.round(winH - CARD_BOTTOM - TOP_MARGIN);
  const HEADER_H = 64; // asa + titulo aprox
  // Peek tope ~52% de pantalla: fichas con mucha info abren a media
  // altura y el resto (informe de calidad, histórico…) se descubre
  // con "Ver más" o arrastrando el asa
  const PEEK_MAX = Math.round(winH * 0.64);
  const [bodyH, setBodyH] = useState(0);
  // Peek = altura del contenido (con minimo razonable y tope PEEK_MAX)
  const peek = Math.max(
    170,
    Math.min(PEEK_MAX, CARD_MAX, bodyH + HEADER_H),
  );
  const h = useRef(new Animated.Value(0)).current; // cerrada = alto 0
  const b = useRef(new Animated.Value(CARD_BOTTOM)).current;
  // Card bajita en reposo: flota sobre el borde en vez de ir pegada
  // abajo. Emisarios suben más (cards muy cortas), playas sin
  // monitorizar un punto menos; las fichas con contenido o de playas
  // monitorizadas siguen ancladas abajo
  const liftFrac = !isBeach
    ? 0.3
    : beachStatusKey(feature) === 'unmonitored'
      ? 0.2
      : 0;
  const restBottom =
    liftFrac > 0 && peek < winH * 0.45
      ? Math.round(winH * liftFrac)
      : CARD_BOTTOM;
  const snapped = useRef(0);
  const expanded = useRef(false);
  const closing = useRef(false);
  // Estado espejo de expanded para re-render (el ref no dispara render)
  const [isExpanded, setIsExpanded] = useState(false);
  // Scroll del cuerpo: BeachDetail lo usa para bajar a "Ver titulares"
  const bodyRef = useRef<ScrollView>(null);
  // "Ver más" visible mientras quede contenido por debajo del viewport.
  // Derivado de las métricas de scroll (offset, alto visible, alto de
  // contenido) — como estado, no ref: el render depende de él.
  const [showMore, setShowMore] = useState(false);
  const scrollMetrics = useRef({ y: 0, vh: 0, ch: 0 });
  const recomputeMore = () => {
    const m = scrollMetrics.current;
    setShowMore(
      m.vh > 0 && m.ch > m.vh + 8 && m.y + m.vh < m.ch - 32,
    );
  };
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } =
      e.nativeEvent;
    scrollMetrics.current = {
      y: contentOffset.y,
      vh: layoutMeasurement.height,
      ch: contentSize.height,
    };
    recomputeMore();
  };

  // Playa mas cercana al vertido (contexto de impacto)
  const [nearest, setNearest] = useState<OutfallNearestBeach | null>(null);
  useEffect(() => {
    if (isBeach) return;
    setNearest(null);
    fetchOutfallNearestBeach(feature.id)
      .then(setNearest)
      .catch(() => setNearest(null));
  }, [feature.id, isBeach]);

  // Marcadores de la foto satélite del emisario: otros vertidos y las
  // playas del entorno proyectados al encuadre (el propio emisario es
  // el dot central)
  const shotMarkers = useMemo(() => {
    if (isBeach) return [];
    const others = (outfalls ?? [])
      .filter((o) => o.id !== feature.id)
      .map((o) => {
        const s = o.properties.status ?? 'unknown';
        return {
          id: `o${o.id}`,
          coords: o.geometry.coordinates as [number, number],
          color:
            STATUS_COLORS[s as keyof typeof STATUS_COLORS] ??
            colors.status.unknown,
          icon: require('../assets/icons/icon-faucet-sil.png'),
        };
      });
    const beachMarks = (beaches ?? []).map((b) => {
      const k = beachStatusKey(b);
      return {
        id: `b${b.id}`,
        coords: b.geometry.coordinates as [number, number],
        color: colors.status[k],
        icon: require('../assets/icons/beach_sil.png'),
      };
    });
    return [...beachMarks, ...others];
  }, [isBeach, outfalls, beaches, feature.id]);

  const snapTo = (target: number, isExpanded = false) => {
    snapped.current = target;
    expanded.current = isExpanded;
    setIsExpanded(isExpanded);
    const bottom = isExpanded ? CARD_BOTTOM : restBottom;
    Animated.parallel([
      Animated.spring(h, {
        toValue: target,
        useNativeDriver: false,
        damping: 22,
        stiffness: 260,
      }),
      Animated.spring(b, {
        toValue: bottom,
        useNativeDriver: false,
        damping: 22,
        stiffness: 260,
      }),
    ]).start();
  };

  // Peek se reajusta cuando el contenido termina de medirse/cargar
  useEffect(() => {
    if (!expanded.current && !closing.current) snapTo(peek);
  }, [peek]);

  const dismiss = (after?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(h, {
      toValue: 0,
      duration: 180,
      useNativeDriver: false,
    }).start(({ finished }) => finished && (after ?? onClose)());
  };

  // Tap en la foto satélite: cierra la card con la misma animación y
  // se queda en el mapa (ya centrado en el punto)
  const handleViewOnMap =
    onViewOnMap != null ? () => dismiss(onViewOnMap) : undefined;

  // Título: el picker muestra el nombre de la playa; el detalle el
  // del punto elegido (Teresitas -> "… · Punto 2" porque sus PMs se
  // llaman igual; Troya ya se distingue por el romano)
  const stripPm = (n: string) => n.replace(/\s+PM\d+$/, '');
  const sameBase =
    members.length > 1 &&
    new Set(members.map((m) => stripPm(m.properties.name))).size === 1;
  const pmSuffix =
    chosenPm && sameBase
      ? ` · Punto ${
          chosenPm.properties.name.match(/PM(\d+)$/)?.[1] ?? ''
        }`
      : '';
  const muni = isBeach ? beachFeature.properties.municipality : null;
  const title =
    (showPmPicker
      ? displayBeachName(beachBaseName(p.name))
      : displayBeachName(stripPm(beachFeature.properties.name)) +
        pmSuffix) + (muni ? ` · ${muni}` : '');

  // Acento de la cabecera según estado (playa o vertido): tinta sutil
  // + línea superior del color de estado
  const accent = isBeach
    ? (colors.status[beachStatusKey(feature)] ?? colors.status.unknown)
    : (STATUS_COLORS[statusKey] ?? colors.status.unknown);

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
      style={[styles.sheet, { bottom: b, height: h }]}
    >
      {/* Zona de agarre: asa + cabecera responden al arrastre */}
      <View
        {...pan.panHandlers}
        style={[
          styles.headerZone,
          { backgroundColor: `${accent}26`, borderTopColor: accent },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: accent }]} />
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          <Pressable
            onPress={() => dismiss()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Cerrar ficha"
          >
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        ref={bodyRef}
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
        onLayout={(e) => {
          scrollMetrics.current.vh = e.nativeEvent.layout.height;
          recomputeMore();
        }}
        onContentSizeChange={(_w, ch) => {
          setBodyH(ch);
          // Re-evaluar al cambiar el contenido: si veníamos del picker
          // de PMs (corto) la ficha larga debe volver a mostrar el
          // botón aunque nadie haya hecho scroll todavía.
          scrollMetrics.current.ch = ch;
          recomputeMore();
        }}
        onScroll={handleScroll}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={80}
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
                    accessibilityRole="button"
                    accessibilityLabel={`${
                      pointLongLabel(m.properties.name) ??
                      displayBeachName(m.properties.name)
                    }, ${BEACH_STATUS_TEXT[k]}`}
                    accessibilityHint="Abrir ficha de este punto de muestreo"
                  >
                    <View
                      style={[
                        styles.pmDot,
                        { backgroundColor: colors.status[k] },
                      ]}
                    />
                    <View style={styles.pmText}>
                      <Text style={styles.pmName}>
                        {pointLongLabel(m.properties.name) ??
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
                <Pressable
                  onPress={() => setChosenPm(null)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Volver a los ${members.length} puntos de muestreo`}
                >
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
                outfalls={outfalls}
                onViewOnMap={handleViewOnMap}
                onSelectOutfall={
                  onSelectOutfall
                    ? (f) => onSelectOutfall(f, beachFeature)
                    : undefined
                }
              />
            </View>
          )
        ) : (
          <View>
            {/* Vista satélite del entorno: el emisario en el centro,
                otros vertidos y playas alrededor. Clicable → mapa */}
            <SatelliteShot
              center={feature.geometry.coordinates as [number, number]}
              centerColor={
                STATUS_COLORS[statusKey] ?? colors.status.unknown
              }
              centerIcon={require('../assets/icons/icon-faucet-sil.png')}
              markers={shotMarkers}
              onPress={handleViewOnMap}
              startLevel={1}
            />
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
              (() => {
                const beachTarget = (beaches ?? []).find(
                  (b) => b.id === nearest.beach_id,
                );
                return (
                  <>
                    <Text style={styles.nearTitle}>
                      Playa más cercana{' '}
                      <Text style={styles.nearSub}>
                        · si no la ves, aleja el zoom
                      </Text>
                    </Text>
                    <Pressable
                      style={[
                        styles.nearestBox,
                        {
                          borderLeftColor:
                            STATUS_COLORS[statusKey] ??
                            colors.status.unknown,
                        },
                      ]}
                      onPress={
                        beachTarget && onSelectBeach
                          ? () => onSelectBeach(beachTarget)
                          : undefined
                      }
                      disabled={!beachTarget || !onSelectBeach}
                      accessibilityRole="button"
                      accessibilityLabel={`${displayBeachName(nearest.beach_name)}, ver en el mapa`}
                    >
                      <Text style={[styles.nearestText, { flex: 1 }]}>
                        <Text style={styles.nearestName}>
                          {displayBeachName(nearest.beach_name)}
                        </Text>
                        {' · '}a {fmtDistance(nearest.distance_m)}
                      </Text>
                      {beachTarget && onSelectBeach && (
                        <Text style={styles.nearestChevron}>›</Text>
                      )}
                    </Pressable>
                  </>
                );
              })()
            ) : null}
            <Text style={styles.row}>
              Fuente: Censo de Vertidos 2025 (Gob. Canarias)
            </Text>
          </View>
        )}
      </ScrollView>

      {/* "Ver más": insinúa que hay contenido debajo. Aparece cuando el
          contenido no cabe en el viewport actual del ScrollView (aunque
          cupiera en la card expandida — el usuario aún no la ha
          expandido). Si la card está plegada la expande primero; en
          ambos casos baja sola hasta el final. Se oculta al llegar
          abajo. */}
      {showMore && (
        <Pressable
          style={styles.moreBtn}
          onPress={() => {
            // Sin expandir la card: "Ver más" solo baja el contenido
            // una página (~85% del viewport) dentro de la misma altura
            const m = scrollMetrics.current;
            bodyRef.current?.scrollTo({
              y: m.y + m.vh * 0.85,
              animated: true,
            });
            // Respaldo: si el evento de scroll final no llega, retira
            // el botón cuando la última métrica conocida siga cerca
            // del fondo (si el usuario subió a mano, se respeta).
            setTimeout(() => {
              const m2 = scrollMetrics.current;
              if (m2.ch > 0 && m2.y + m2.vh >= m2.ch - 120)
                setShowMore(false);
            }, 800);
          }}
          accessibilityRole="button"
          accessibilityLabel="Ver más contenido de la ficha"
        >
          <ImageBackground
            source={require('../assets/gradient-sea.png')}
            style={StyleSheet.absoluteFill}
            imageStyle={styles.moreBtnImg}
          />
          <Text style={styles.moreText}>Ver más</Text>
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
    borderWidth: 1,
    borderColor: '#b9d3dd', // separa la card del mapa/leyenda
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
    overflow: 'hidden',
  },
  headerZone: {
    borderTopWidth: 3,
    borderTopLeftRadius: 17,
    borderTopRightRadius: 17,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#000',
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
    flexDirection: 'row',
    alignItems: 'center',
  },
  nearestChevron: {
    fontSize: 16,
    fontFamily: fonts.semibold,
    color: colors.textFaint,
    paddingRight: 8,
  },
  nearestText: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  nearTitle: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: colors.text,
    marginTop: 8,
  },
  nearSub: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textFaint,
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
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  moreBtnImg: {
    borderRadius: 12,
    opacity: 0.7,
  },
  moreText: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: '#fff',
  },
});

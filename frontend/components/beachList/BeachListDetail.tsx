import React, { useRef, useState } from 'react';
import {
  ImageBackground,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import BeachDetail from '../BeachDetail';
import { SafeGradient } from '../SafeGradient';
import { GeoFeature } from '../../lib/api';
import {
  pointLongLabel,
  displayBeachName,
  beachBaseName,
} from '../../lib/format';
import { colors, fonts } from '../../lib/theme';

// Ficha de una playa como overlay sobre la lista: la lista queda
// montada debajo y conserva scroll + expansión al volver atrás.
// El padre la monta con key={detail.id} — remount por playa: scroll,
// "Ver más" y estado interno de BeachDetail arrancan limpios.
export default function BeachListDetail({
  detail,
  members,
  outfalls,
  onBack,
  onViewOnMap,
  onSelectOutfall,
}: {
  detail: GeoFeature;
  // PMs del complejo de la ficha abierta (los hermanos de `detail`)
  members: GeoFeature[];
  outfalls?: GeoFeature[];
  onBack: () => void;
  onViewOnMap: () => void;
  onSelectOutfall?: (f: GeoFeature) => void;
}) {
  // "Ver más" del detalle: visible mientras quede contenido bajo el
  // viewport — misma mecánica que la card del mapa
  const detailScrollRef = useRef<ScrollView>(null);
  const [showMore, setShowMore] = useState(false);
  const scrollMetrics = useRef({ y: 0, vh: 0, ch: 0 });
  const recomputeMore = () => {
    const m = scrollMetrics.current;
    setShowMore(m.vh > 0 && m.ch > m.vh + 8 && m.y + m.vh < m.ch - 32);
  };
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    scrollMetrics.current = {
      y: contentOffset.y,
      vh: layoutMeasurement.height,
      ch: contentSize.height,
    };
    recomputeMore();
  };

  return (
    <View style={styles.detailOverlay}>
      <ImageBackground
        source={require('../../assets/gradient-sea.png')}
        style={styles.header}
        resizeMode="cover"
      >
        <View style={styles.detailHeaderRow}>
          <Pressable
            onPress={onBack}
            hitSlop={12}
            style={({ pressed }) => [styles.backBtn, pressed && styles.pressFx]}
            accessibilityRole="button"
            accessibilityLabel="Volver a la lista de playas"
          >
            <Text style={styles.backText}>‹</Text>
          </Pressable>
          <Text
            style={[styles.title, { flex: 1, textAlign: 'center' }]}
            numberOfLines={2}
          >
            {(() => {
              const base = displayBeachName(
                beachBaseName(detail.properties.name),
              );
              // En multipunto el título dice la zona, no la
              // sigla del censo: "Playa Jardín · Punta Brava".
              // En una playa de UN solo punto no hay zonas que
              // distinguir — "San Telmo · Zona 1" sería ruido
              const z =
                members.length > 1
                  ? pointLongLabel(detail.properties.name)
                  : null;
              return z ? `${base} · ${z}` : base;
            })()}
            {detail.properties.municipality
              ? ` · ${detail.properties.municipality}`
              : ''}
          </Text>
          {/* Simétrico al ‹ para que el título quede centrado */}
          <View style={styles.backBtn} />
        </View>
      </ImageBackground>
      <ScrollView
        ref={detailScrollRef}
        style={styles.detailScroll}
        // flexGrow: el contenido corto (playas sin monitorizar)
        // estira el cuerpo para que el pie quede anclado abajo
        contentContainerStyle={{ flexGrow: 1 }}
        onLayout={(e) => {
          scrollMetrics.current.vh = e.nativeEvent.layout.height;
          recomputeMore();
        }}
        onContentSizeChange={(_w, ch) => {
          scrollMetrics.current.ch = ch;
          recomputeMore();
        }}
        onScroll={handleScroll}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={80}
      >
        <View style={styles.detailBody}>
          <BeachDetail
            feature={detail}
            hasAlert={detail.properties.alert === true}
            outfalls={outfalls}
            members={members}
            onViewOnMap={onViewOnMap}
            onSelectOutfall={onSelectOutfall}
          />
        </View>
      </ScrollView>
      {/* "Ver más": insinúa que hay contenido debajo; autoscroll
          hasta el final y se oculta al llegar abajo. Mismo
          tratamiento que la card del mapa: scrim nativo que
          funde el contenido + píldora con arte de mar */}
      {showMore && (
        <>
          <SafeGradient
            colors={['rgba(242,247,248,0)', 'rgba(242,247,248,0.97)']}
            locations={[0, 0.8]}
            style={styles.moreFade}
            pointerEvents="none"
          />
          <Pressable
            style={({ pressed }) => [styles.moreBtn, pressed && styles.pressFx]}
            onPress={() => {
              detailScrollRef.current?.scrollToEnd({
                animated: true,
              });
              setTimeout(() => {
                const m = scrollMetrics.current;
                if (m.ch > 0 && m.y + m.vh >= m.ch - 120) setShowMore(false);
              }, 1200);
            }}
            accessibilityRole="button"
            accessibilityLabel="Ver más contenido de la ficha"
          >
            <ImageBackground
              source={require('../../assets/gradient-sea.png')}
              style={StyleSheet.absoluteFill}
              imageStyle={styles.moreBtnImg}
            />
            <Text style={styles.moreText}>Ver más</Text>
          </Pressable>
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
  header: {
    paddingHorizontal: 16,
    paddingTop:
      (Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 24) + 10,
    paddingBottom: 12,
  },
  detailHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: {
    marginRight: 4,
  },
  backText: {
    fontSize: 26,
    fontFamily: fonts.semibold,
    color: colors.onColor,
    marginTop: -4,
  },
  detailScroll: {
    flex: 1,
  },
  // Cubre toda la modal (lista incluida) — la lista sigue montada debajo
  detailOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
  },
  detailBody: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'android' ? 44 : 24,
  },
  // Scrim: misma geometría que FeatureSheet (44px de fundido que
  // abraza la píldora) pero fundiendo al fondo de esta vista
  // (#f2f7f8) — a blanco puro se vería una mancha sobre el gris
  moreFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: Platform.OS === 'android' ? 42 : 4,
    height: 48,
  },
  // Sin sombra proyectada: sobre el scrim se leía como un
  // "subrayado" claro pegado al texto (mismo fix que FeatureSheet)
  moreBtn: {
    position: 'absolute',
    // Por encima de la barra de gestos/botones nativos de Android,
    // igual que la card del mapa (CARD_BOTTOM ≈ 44)
    bottom: Platform.OS === 'android' ? 49 : 12,
    alignSelf: 'center',
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 12,
    overflow: 'hidden',
  },
  moreBtnImg: {
    borderRadius: 12,
    opacity: 0.7,
  },
  moreText: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: colors.onColor,
  },
  title: {
    fontSize: 18,
    fontFamily: fonts.extrabold,
    color: colors.onColor,
  },
});

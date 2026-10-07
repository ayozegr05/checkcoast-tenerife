import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import BeachDetail from './BeachDetail';
import OutfallSheet from './sheet/OutfallSheet';
import ZonePicker from './sheet/ZonePicker';
import { useSheetDrag } from './sheet/useSheetDrag';
import type { Selection } from './CoastMap';
import type { GeoFeature } from '../lib/api';
import { beachBaseName, displayBeachName } from '../lib/format';
import { beachStatusKey } from '../lib/beachStatus';
import { colors, fonts } from '../lib/theme';

// Ficha flotante sobre el mapa: el shell (asa arrastrable, cabecera,
// ✕, scroll, "Ver más") vive aquí; el contenido delega en
// ZonePicker (playa multi-PM), BeachDetail (playa) u OutfallSheet
// (emisario). La geometría y el gesto de arrastre están en
// useSheetDrag; los textos del emisario en lib/outfallSheet.
export default function FeatureSheet({
  selection,
  onClose,
  outfalls,
  beaches,
  onViewOnMap,
  onSelectOutfall,
  onSelectBeach,
  onZoneShown,
  onCoverageChange,
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
  // Zona concreta abierta en una playa multipunto (null = picker):
  // el mapa la usa para subir un poco el encuadre y que los dots
  // respiren por encima de la ficha
  onZoneShown?: (zone: GeoFeature | null) => void;
  // Cuando la ficha tapa los botones flotantes del mapa (satélite,
  // brújula, capas) el mapa los desactiva para que la ✕ siempre
  // cierre — se calcula por geometría, no solo por "expandida":
  // en pantallas bajas la ficha en reposo ya puede cubrirlos
  onCoverageChange?: (coversControls: boolean) => void;
}) {
  const { feature } = selection;
  const p = feature.properties;
  const isBeach = selection.type === 'beach';
  const statusKey = p.status ?? 'unknown';

  // Selector de PMs: si la playa agrupada tiene varios puntos de
  // muestreo, la card muestra primero la lista y el usuario elige
  const members = isBeach ? (selection.members ?? []) : [];
  const [chosenPm, setChosenPm] = useState<GeoFeature | null>(null);
  // Ref espejo: el PanResponder se crea una sola vez y capturaría el
  // chosenPm inicial (siempre null)
  const chosenPmRef = useRef<GeoFeature | null>(null);
  chosenPmRef.current = chosenPm;
  useEffect(() => setChosenPm(null), [selection]);
  useEffect(() => onZoneShown?.(chosenPm), [chosenPm, onZoneShown]);
  const showPmPicker = isBeach && members.length > 1 && !chosenPm;

  // Atrás hardware: con un PM elegido vuelve primero al selector de
  // puntos de muestreo (este handler corre antes que el de App, que
  // cerraría la ficha entera). Devolviendo false el gesto sigue su
  // cadena normal: picker → cerrar ficha
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (chosenPm) {
        setChosenPm(null);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [chosenPm]);

  const beachFeature = chosenPm ?? feature;

  // Card bajita en reposo: flota sobre el borde en vez de ir pegada
  // abajo. Emisarios suben más (cards muy cortas), playas sin
  // monitorizar un punto menos; las fichas con contenido o de playas
  // monitorizadas siguen ancladas abajo
  const liftFrac = !isBeach
    ? 0.3
    : beachStatusKey(feature) === 'unmonitored'
      ? 0.2
      : 0;

  const {
    h,
    b,
    panHandlers,
    bodyRef,
    bodyProps,
    showMore,
    onMore,
    requestClose,
    dismiss,
  } = useSheetDrag({
    liftFrac,
    // Con una zona abierta, cerrar primero vuelve al selector de
    // zonas (mismo comportamiento que el atrás hardware); desde el
    // selector sí se cierra la card
    interceptClose: () => {
      if (chosenPmRef.current) {
        setChosenPm(null);
        return true;
      }
      return false;
    },
    onClose,
    onCoverageChange,
  });

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
      ? ` · Zona ${chosenPm.properties.name.match(/PM(\d+)$/)?.[1] ?? ''}`
      : '';
  const muni = isBeach ? beachFeature.properties.municipality : null;
  const title =
    (showPmPicker
      ? displayBeachName(beachBaseName(p.name))
      : displayBeachName(stripPm(beachFeature.properties.name)) + pmSuffix) +
    (muni ? ` · ${muni}` : '');

  // Acento de la cabecera según estado (playa o vertido): tinta sutil
  // + línea superior del color de estado
  const accent = isBeach
    ? (colors.status[beachStatusKey(feature)] ?? colors.status.unknown)
    : (colors.outfall[statusKey] ?? colors.status.unknown);

  return (
    <Animated.View style={[styles.sheet, { bottom: b, height: h }]}>
      {/* Zona de agarre: asa + cabecera responden al arrastre */}
      <View
        {...panHandlers}
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
        </View>
        <Pressable
          onPress={requestClose}
          hitSlop={12}
          style={({ pressed }) => [
            styles.closeBtn,
            { backgroundColor: accent },
            pressed && styles.pressFx,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Cerrar ficha"
        >
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={bodyRef}
        style={styles.body}
        contentContainerStyle={[
          styles.bodyContent,
          // El emisario acaba en el enlace a la fuente: menos aire
          // de cola que la ficha de playa (que cierra con cards)
          !isBeach && { paddingBottom: 10 },
        ]}
        showsVerticalScrollIndicator={false}
        {...bodyProps}
      >
        {isBeach ? (
          showPmPicker ? (
            <ZonePicker members={members} onPick={setChosenPm} />
          ) : (
            <View>
              <BeachDetail
                feature={beachFeature}
                hasAlert={
                  chosenPm
                    ? chosenPm.properties.alert === true
                    : selection.hasAlert
                }
                outfalls={outfalls}
                members={members}
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
          <OutfallSheet
            feature={feature}
            outfalls={outfalls}
            beaches={beaches}
            onViewOnMap={handleViewOnMap}
            onSelectBeach={onSelectBeach}
          />
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
          style={({ pressed }) => [styles.moreBtn, pressed && styles.pressFx]}
          onPress={onMore}
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
  // Feedback táctil común: leve fundido al presionar
  pressFx: {
    opacity: 0.6,
  },
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
    paddingBottom: 6,
  },
  title: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.text,
    textAlign: 'center',
    // margen simétrico: la ✕ va absoluta a la esquina y el título
    // queda centrado sin chocar con ella aunque ocupe 2 líneas
    marginHorizontal: 54,
  },
  close: {
    fontSize: 18,
    fontFamily: fonts.extrabold,
    color: '#fff',
  },
  // ✕ fija en la esquina superior derecha de la zona tintada (al
  // lado del asa), con el color de estado — no se mueve aunque el
  // título crezca
  closeBtn: {
    position: 'absolute',
    top: 6,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 16,
    paddingBottom: 28,
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

import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { BeachNearbyOutfall, GeoFeature } from '../../lib/api';
import { colors, fonts } from '../../lib/theme';

const OUTFALL_STATUS_LABELS: Record<string, string> = {
  legal: 'Autorizado',
  illegal: 'No autorizado',
  unknown: 'En trámite',
};

const fmtDistance = (m: number) =>
  m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;

type NearbyOutfallsProps = {
  nearby: BeachNearbyOutfall[];
  outfalls?: GeoFeature[];
  onSelectOutfall?: (feature: GeoFeature) => void;
};

// Emisarios a menos de 1 km, del más próximo al más lejano
export default function NearbyOutfalls({
  nearby,
  outfalls,
  onSelectOutfall,
}: NearbyOutfallsProps) {
  return (
    <View style={[styles.nearbyTop, styles.secCard]}>
      <View style={styles.secHead}>
        <Image
          source={require('../../assets/icons/icon-faucet.png')}
          style={[
            styles.secIcon,
            { tintColor: colors.primaryDark, marginBottom: -1 },
          ]}
        />
        <Text style={styles.secCardTitle}>Emisarios cercanos</Text>
      </View>
      <Text style={styles.nearSub}>
        {nearby.length} a menos de 1 km · el más próximo a{' '}
        <Text
          style={
            nearby[0].distance_m < 500
              ? { color: colors.status.warning }
              : undefined
          }
        >
          {fmtDistance(nearby[0].distance_m).replace(' ', ' ')}
        </Text>
        {' · aleja el zoom si no los ves'}
      </Text>
      {nearby.map((o) => {
        const accent = colors.outfall[o.status] ?? colors.status.unknown;
        const target = (outfalls ?? []).find((f) => f.id === o.outfall_id);
        return (
          <Pressable
            key={o.outfall_id}
            style={({ pressed }) => [
              styles.outfallRow,
              { borderLeftColor: accent },
              pressed && styles.pressFx,
            ]}
            onPress={
              target && onSelectOutfall
                ? () => onSelectOutfall(target)
                : undefined
            }
            disabled={!target || !onSelectOutfall}
            accessibilityRole="button"
            accessibilityLabel={`${o.name}, ver en el mapa`}
          >
            <View style={styles.outfallRowBody}>
              <Text style={styles.outfallName} numberOfLines={1}>
                {o.name}
              </Text>
              <Text style={styles.outfallMeta}>
                {OUTFALL_STATUS_LABELS[o.status] ?? 'En trámite'}
              </Text>
            </View>
            {/* Distancia como badge: columna escaneable para
                    comparar emisarios de un vistazo */}
            <Text style={[styles.outfallDist, { color: accent }]}>
              {fmtDistance(o.distance_m)}
            </Text>
            {target && onSelectOutfall && (
              <Text style={styles.outfallChevron}>›</Text>
            )}
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
  // "Emisarios cercanos" arriba de la ficha: sin borde superior, es el
  // primer bloque de contenido tras la fila de estado
  nearbyTop: {
    marginTop: 10,
  },
  // Card de sección — fondo + cabecera con icono como las cards de la
  // ficha de emisario, pero SIN barra de color: aquí el color es el
  // semáforo de estado y una barra turquesa suelta competía con él
  secCard: {
    paddingVertical: 8,
  },
  secHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 7,
    marginBottom: 2,
  },
  secIcon: {
    width: 22,
    height: 22,
    // Alineación óptica: el margen positivo SUBE el icono hasta que
    // su base casa con la línea base del texto del título (la caja
    // de línea tiene ~4px de descender por debajo de los glifos)
    marginBottom: 3,
  },
  secCardTitle: {
    fontSize: 15,
    fontFamily: fonts.extrabold,
    color: colors.primaryDark,
  },
  nearSub: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginBottom: 6,
  },
  outfallRow: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 4,
    marginBottom: 6,
    backgroundColor: colors.background,
    borderRadius: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  outfallChevron: {
    fontSize: 16,
    fontFamily: fonts.semibold,
    color: colors.textFaint,
    paddingRight: 8,
  },
  outfallRowBody: {
    flex: 1,
    paddingRight: 4,
  },
  outfallName: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  outfallMeta: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 1,
  },
  outfallDist: {
    fontSize: 13,
    fontFamily: fonts.bold,
    alignSelf: 'center',
    marginRight: 6,
    minWidth: 46,
    textAlign: 'right',
  },
});

import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, fonts } from '../lib/theme';
import Skeleton from './Skeleton';

// Punto marcado sobre la foto: posición real proyectada al bbox
export type ShotMarker = {
  id: string | number;
  coords: [number, number];
  color: string;
  // Etiqueta de la mini-leyenda (se deduplica por texto)
  label: string;
  icon?: ImageSourcePropType;
};

// Foto satélite estática del punto (Esri World Imagery, mismo servicio
// que la vista satélite del mapa). Dos encuadres: cerca (~1,2 km x
// 750 m) y contexto (x2,5) para ver emisarios/playas a varios cientos
// de metros
const BASE_DLON = 0.006;
const BASE_DLAT = 0.0033;
const FAR_SCALE = 2.5;
const MAX_MARKERS = 14;

const shotUrl = (lon: number, lat: number, scale: number) => {
  const dLon = BASE_DLON * scale;
  const dLat = BASE_DLAT * scale;
  return (
    'https://server.arcgisonline.com/ArcGIS/rest/services/' +
    `World_Imagery/MapServer/export?bbox=${lon - dLon},${lat - dLat},` +
    `${lon + dLon},${lat + dLat}&bboxSR=4326&imageSR=4326&size=640,300` +
    '&format=png&f=image'
  );
};

// Minimapa estático compartido por las fichas de playa y de emisario:
// foto Esri + marcadores proyectados + leyenda + zoom ±. Si se pasa
// onPress, la foto entera es clicable ("ver en el mapa") y muestra el
// icono de mapa como affordance
export default function SatelliteShot({
  center,
  centerColor,
  centerIcon,
  markers,
  onPress,
}: {
  center: [number, number];
  centerColor: string;
  centerIcon?: ImageSourcePropType;
  markers: ShotMarker[];
  onPress?: () => void;
}) {
  const [lon, lat] = center;
  const [far, setFar] = useState(false);
  // Uri ya cargada: el skeleton solo tapa la foto si la actual aún no
  // llegó (la alejada se prefetcha al cargar la cercana → zoom instantáneo)
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  const uri = shotUrl(lon, lat, far ? FAR_SCALE : 1);

  useEffect(() => {
    setFar(false);
    setLoadedUri(null);
  }, [lon, lat]);

  const dLon = BASE_DLON * (far ? FAR_SCALE : 1);
  const dLat = BASE_DLAT * (far ? FAR_SCALE : 1);

  // Marcadores dentro del encuadre actual: lon/lat → % del contenedor.
  // Ordenados por cercanía al centro, con tope para no saturar zonas
  // densas (puerto de Santa Cruz, Costa Adeje)
  const visible = useMemo(() => {
    const cos = Math.cos((lat * Math.PI) / 180);
    return markers
      .map((m) => {
        const [ml, ma] = m.coords;
        const dLonM = (ml - lon) * 111320 * cos;
        const dLatM = (ma - lat) * 110540;
        return {
          ...m,
          x: ((ml - (lon - dLon)) / (2 * dLon)) * 100,
          y: ((lat + dLat - ma) / (2 * dLat)) * 100,
          d2: dLonM * dLonM + dLatM * dLatM,
        };
      })
      .filter((m) => m.x >= 0 && m.x <= 100 && m.y >= 0 && m.y <= 100)
      .sort((a, b) => a.d2 - b.d2)
      .slice(0, MAX_MARKERS);
  }, [markers, lon, lat, dLon, dLat]);

  // La leyenda solo muestra lo que realmente se ve en el encuadre
  const legend = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of visible) if (!seen.has(m.label)) seen.set(m.label, m.color);
    return [...seen.entries()].map(([label, color]) => ({ label, color }));
  }, [visible]);

  const loading = loadedUri !== uri;

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : 'image'}
        accessibilityLabel={
          onPress
            ? 'Vista satélite de la zona. Ver en el mapa'
            : 'Vista satélite de la zona'
        }
      >
        {loading && <Skeleton style={styles.skeleton} />}
        {loading && <Text style={styles.loading}>Cargando vista satélite…</Text>}
        <Image
          source={{ uri }}
          style={styles.shot}
          resizeMode="stretch"
          onLoad={() => {
            setLoadedUri(uri);
            // Prefetch del encuadre alejado para que el botón − sea instantáneo
            if (!far) Image.prefetch(shotUrl(lon, lat, FAR_SCALE)).catch(() => {});
          }}
        />
      </Pressable>

      {visible.map((m) => (
        <View
          key={m.id}
          pointerEvents="none"
          style={[
            styles.marker,
            { left: `${m.x}%`, top: `${m.y}%`, backgroundColor: m.color },
          ]}
        >
          {m.icon && (
            <Image source={m.icon} style={styles.markerIcon} />
          )}
        </View>
      ))}
      <View
        pointerEvents="none"
        style={[styles.centerDot, { backgroundColor: centerColor }]}
      >
        {centerIcon && (
          <Image source={centerIcon} style={styles.centerIcon} />
        )}
      </View>

      {legend.length > 0 && (
        <View pointerEvents="none" style={styles.legend}>
          {legend.map((l) => (
            <View key={l.label} style={styles.legendRow}>
              <View
                style={[styles.legendDot, { backgroundColor: l.color }]}
              />
              <Text style={styles.legendText}>{l.label}</Text>
            </View>
          ))}
        </View>
      )}



      <View style={styles.zoomCol}>
        <Pressable
          onPress={() => setFar(false)}
          disabled={!far}
          hitSlop={6}
          style={[styles.zoomBtn, !far && styles.zoomBtnOff]}
          accessibilityRole="button"
          accessibilityLabel="Acercar vista satélite"
          accessibilityState={{ disabled: !far }}
        >
          <Text style={[styles.zoomText, !far && styles.zoomTextOff]}>+</Text>
        </Pressable>
        <Pressable
          onPress={() => setFar(true)}
          disabled={far}
          hitSlop={6}
          style={[styles.zoomBtn, far && styles.zoomBtnOff]}
          accessibilityRole="button"
          accessibilityLabel="Alejar vista satélite"
          accessibilityState={{ disabled: far }}
        >
          <Text style={[styles.zoomText, far && styles.zoomTextOff]}>−</Text>
        </Pressable>
      </View>

      <Text pointerEvents="none" style={styles.credit}>
        © Esri, Maxar, Earthstar Geographics
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 8,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.border,
  },
  shot: {
    width: '100%',
    aspectRatio: 640 / 300,
  },
  skeleton: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 0,
    zIndex: 1,
  },
  loading: {
    position: 'absolute',
    top: '50%',
    alignSelf: 'center',
    marginTop: -8,
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
    zIndex: 1,
  },
  centerDot: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 18,
    height: 18,
    marginTop: -9,
    marginLeft: -9,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerIcon: {
    width: 9,
    height: 9,
    tintColor: '#fff',
  },
  marker: {
    position: 'absolute',
    width: 18,
    height: 18,
    marginLeft: -9,
    marginTop: -9,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerIcon: {
    width: 10,
    height: 10,
    tintColor: '#fff',
  },
  legend: {
    position: 'absolute',
    bottom: 4,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    gap: 1,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 8,
    fontFamily: fonts.semibold,
    color: '#fff',
  },

  zoomCol: {
    position: 'absolute',
    top: 6,
    right: 6,
    gap: 5,
  },
  zoomBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomBtnOff: {
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  zoomText: {
    fontSize: 15,
    lineHeight: 17,
    fontFamily: fonts.bold,
    color: '#fff',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  zoomTextOff: {
    color: 'rgba(255,255,255,0.4)',
  },
  credit: {
    position: 'absolute',
    bottom: 4,
    right: 8,
    fontSize: 9,
    fontFamily: fonts.semibold,
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowRadius: 2,
  },
});

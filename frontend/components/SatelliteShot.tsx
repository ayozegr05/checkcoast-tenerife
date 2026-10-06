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
  icon?: ImageSourcePropType;
};

// Trazado arranque → punto de vertido (emisarios): línea discontinua
// desde el punto de tierra hasta el centro del encuadre
export type ShotLine = {
  from: [number, number];
  color: string;
};

// Foto satélite estática del punto (Esri World Imagery, mismo servicio
// que la vista satélite del mapa). Tres encuadres: muy cerca (x0,25 —
// ~300 m, detalle de la arena/el espigón), cerca (~1,2 km x 750 m) y
// contexto
// (x2,5) para ver emisarios/playas a varios cientos de metros
const BASE_DLON = 0.006;
const BASE_DLAT = 0.0033;
const LEVELS = [0.25, 1, 2.5];
// Arranca en el más cerca: el detalle de la playa es lo que vende;
// los marcadores se prefetchean y aparecen al alejar
const START_LEVEL = 0;
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
// foto Esri + marcadores proyectados + zoom ±. Si se pasa onPress, un
// botón de mapa bajo los de zoom lleva al punto en el mapa real
export default function SatelliteShot({
  center,
  centerColor,
  centerIcon,
  markers,
  line,
  onPress,
  startLevel = START_LEVEL,
}: {
  center: [number, number];
  centerColor: string;
  centerIcon?: ImageSourcePropType;
  markers: ShotMarker[];
  line?: ShotLine;
  onPress?: () => void;
  // Nivel inicial: 0 máximo (playas), 1 medio (emisarios — el punto
  // solo no dice nada, interesa el entorno)
  startLevel?: number;
}) {
  const [lon, lat] = center;
  const [level, setLevel] = useState(startLevel);
  // Uri ya cargada: el skeleton solo tapa la foto si la actual aún no
  // llegó (los demás niveles se prefetchan → zoom instantáneo)
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  const uri = shotUrl(lon, lat, LEVELS[level]);

  useEffect(() => {
    setLevel(startLevel);
    setLoadedUri(null);
  }, [lon, lat, startLevel]);

  const dLon = BASE_DLON * LEVELS[level];
  const dLat = BASE_DLAT * LEVELS[level];

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

  // Tamaño real del contenedor: el trazado se dibuja en píxeles
  // (rotar una View con % no funciona — la rotación es sobre su
  // propio centro, así que colocamos el centro en el punto medio)
  const [size, setSize] = useState({ w: 0, h: 0 });
  const seg = useMemo(() => {
    if (!line || !size.w || !size.h) return null;
    const fx = ((line.from[0] - (lon - dLon)) / (2 * dLon)) * size.w;
    const fy = ((lat + dLat - line.from[1]) / (2 * dLat)) * size.h;
    const cx = size.w / 2;
    const cy = size.h / 2;
    return {
      len: Math.hypot(cx - fx, cy - fy),
      ang: Math.atan2(cy - fy, cx - fx),
      mx: (fx + cx) / 2,
      my: (fy + cy) / 2,
      fx,
      fy,
    };
  }, [line, size, lon, lat, dLon, dLat]);

  const loading = loadedUri !== uri;

  return (
    <View
      style={styles.wrap}
      onLayout={(e) =>
        setSize({
          w: e.nativeEvent.layout.width,
          h: e.nativeEvent.layout.height,
        })
      }
    >
      {loading && <Skeleton style={styles.skeleton} />}
      {loading && <Text style={styles.loading}>Cargando vista satélite…</Text>}
      <Image
        source={{ uri }}
        style={styles.shot}
        resizeMode="stretch"
        accessibilityLabel="Vista satélite de la zona"
        onLoad={() => {
          setLoadedUri(uri);
          // Prefetch del resto de niveles para que ± sea instantáneo
          LEVELS.forEach((s, i) => {
            if (i !== level)
              Image.prefetch(shotUrl(lon, lat, s)).catch(() => {});
          });
        }}
      />

      {/* Trazado tierra → mar: la línea sale del punto de arranque
          y llega al centro (el vertido). Si el arranque cae fuera del
          encuadre la línea se recorta sola — sigue apuntando bien */}
      {seg && line && (
        <>
          <View
            pointerEvents="none"
            style={[
              styles.trace,
              {
                left: seg.mx - seg.len / 2,
                top: seg.my - 1.5,
                width: seg.len,
                borderTopColor: line.color,
                transform: [{ rotate: `${seg.ang}rad` }],
              },
            ]}
          />
          <View
            pointerEvents="none"
            style={[
              styles.traceStart,
              {
                left: seg.fx - 6,
                top: seg.fy - 6,
                borderColor: line.color,
              },
            ]}
          />
        </>
      )}
      {visible.map((m) => (
        <View
          key={m.id}
          pointerEvents="none"
          style={[
            styles.marker,
            { left: `${m.x}%`, top: `${m.y}%`, backgroundColor: m.color },
          ]}
        >
          {m.icon && <Image source={m.icon} style={styles.markerIcon} />}
        </View>
      ))}
      <View
        pointerEvents="none"
        style={[styles.centerDot, { backgroundColor: centerColor }]}
      >
        {centerIcon && <Image source={centerIcon} style={styles.centerIcon} />}
      </View>

      <View style={styles.zoomCol}>
        <Pressable
          onPress={() => setLevel((l) => l - 1)}
          disabled={level === 0}
          hitSlop={6}
          style={({ pressed }) => [
            styles.zoomBtn,
            level === 0 && styles.zoomBtnOff,
            pressed && styles.pressFx,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Acercar vista satélite"
          accessibilityState={{ disabled: level === 0 }}
        >
          <Text style={[styles.zoomText, level === 0 && styles.zoomTextOff]}>
            +
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setLevel((l) => l + 1)}
          disabled={level === LEVELS.length - 1}
          hitSlop={6}
          style={({ pressed }) => [
            styles.zoomBtn,
            level === LEVELS.length - 1 && styles.zoomBtnOff,
            pressed && styles.pressFx,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Alejar vista satélite"
          accessibilityState={{ disabled: level === LEVELS.length - 1 }}
        >
          <Text
            style={[
              styles.zoomText,
              level === LEVELS.length - 1 && styles.zoomTextOff,
            ]}
          >
            −
          </Text>
        </Pressable>
        {onPress && (
          <Pressable
            onPress={onPress}
            hitSlop={6}
            style={({ pressed }) => [styles.zoomBtn, pressed && styles.pressFx]}
            accessibilityRole="button"
            accessibilityLabel="Ver en el mapa"
          >
            <Image
              source={require('../assets/icons/icon-map.png')}
              style={styles.mapBtnIcon}
            />
          </Pressable>
        )}
      </View>

      <Text pointerEvents="none" style={styles.credit}>
        © Esri, Maxar, Earthstar Geographics
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Feedback táctil común: leve fundido al presionar
  pressFx: {
    opacity: 0.6,
  },
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
  // Trazado de la conducción: línea discontinua con halo claro para
  // leerse sobre satélite (el borde blanco va por debajo vía sombra)
  trace: {
    position: 'absolute',
    height: 0,
    borderTopWidth: 3,
    borderStyle: 'dashed',
    opacity: 0.95,
    shadowColor: '#fff',
    shadowOpacity: 0.9,
    shadowRadius: 2,
    elevation: 1,
  },
  traceStart: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2.5,
    backgroundColor: '#fff',
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
  mapBtnIcon: {
    width: 14,
    height: 14,
    tintColor: '#fff',
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

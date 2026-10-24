import React, { useMemo, useState } from 'react';
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
  // Número dentro del dot (zonas hermanas de una playa multipunto)
  label?: string;
  // Nombre bajo el dot (zonas con nombre común: "Punta Brava") —
  // un número dentro del punto no identifica la cala
  tag?: string;
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
const BASE_DLAT = 0.0033;
// El bbox debe tener el MISMO aspecto que la imagen pedida (640×300 =
// 2.133): si difiere, Esri expande el encuadre devuelto para casarlo
// y los marcadores proyectados quedan comprimidos hacia el centro
const BASE_DLON = BASE_DLAT * (640 / 300); // ≈ 0.00704
const LEVELS = [0.25, 1, 2.5];
// Encuadre multipunto: además de los niveles estándar hay uno
// intermedio y uno muy ancho — un arenal largo (Jardín: sus zonas
// separadas ~800 m) no cabe con los encuadres de playa simple
const FIT_LEVELS = [0.25, 0.6, 1, 1.8, 2.5, 4];
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

// Miniatura cuadrada para filas de lista (Playas cercanas del
// emisario): mismo servicio Esri, bbox cuadrado en grados para no
// deformar. scale 0.2 ≈ 146 m de encuadre a 160 px ≈ 0.9 m/px —
// el máximo zoom antes de que la imagen de Esri se pixelice
export const thumbUrl = (coords: [number, number], px = 160) => {
  const [lon, lat] = coords;
  const d = BASE_DLAT * 0.2;
  return (
    'https://server.arcgisonline.com/ArcGIS/rest/services/' +
    `World_Imagery/MapServer/export?bbox=${lon - d},${lat - d},` +
    `${lon + d},${lat + d}&bboxSR=4326&imageSR=4326&size=${px},${px}` +
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
  fitMarkers = false,
  fitOver,
  hideCenter = false,
  centerLabel,
  detailCenter,
  biasTo,
  bias,
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
  // Encuadre al abrir: el menor nivel que contiene todos los
  // marcadores de `fitOver` (o de `markers` si no se pasa). En una
  // multipunto interesa encuadrar las zonas — no los emisarios, que
  // forzarían el nivel más ancho
  fitMarkers?: boolean;
  fitOver?: ShotMarker[];
  // Multipunto: el dot central caería en el centroide del arenal —
  // posición inventada que además llevaría la etiqueta de la zona
  // abierta en sitio equivocado. Con zonas reales numeradas sobra
  hideCenter?: boolean;
  // Número dentro del punto central (la zona abierta en la ficha)
  centerLabel?: string;
  // Multipunto: el encuadre inicial va centrado en `center` (el
  // centroide) para que quepan todas las zonas, pero al acercar más
  // allá del fit el centro salta a este punto — el centroide de un
  // arenal largo cae en el mar y el zoom detalle enseñaba agua
  // (Jardín: sus zonas están separadas ~800 m)
  detailCenter?: [number, number];
  // Sesgo de encuadre hacia un punto (p.ej. el arranque en tierra
  // de un emisario): la foto se desplaza una fracción `bias` (0-1)
  // para que entre la costa, y el dot central se proyecta a su
  // posición real en vez de quedar fijado al centro. El sesgo se
  // desvanece al hacer zoom — a nivel detalle interesa el punto
  biasTo?: [number, number];
  bias?: number;
}) {
  const [lon, lat] = center;
  // Nivel de arranque que cubre todos los marcadores con margen
  // (0.78 del semibbox: el dot tiene cuerpo y no debe ir pegado al
  // borde); si ninguno llega, el más alejado. Con fitMarkers el
  // índice es sobre FIT_LEVELS, no sobre LEVELS
  const scales = fitMarkers ? FIT_LEVELS : LEVELS;
  const fitLevel = () => {
    const fitSet = fitOver ?? markers;
    if (!fitMarkers || fitSet.length === 0) return startLevel;
    for (let i = 0; i < scales.length; i++) {
      const mx = BASE_DLON * scales[i] * 0.78;
      const my = BASE_DLAT * scales[i] * 0.78;
      if (
        fitSet.every(
          (m) =>
            Math.abs(m.coords[0] - lon) <= mx &&
            Math.abs(m.coords[1] - lat) <= my,
        )
      )
        return i;
    }
    return scales.length - 1;
  };
  const fitIdx = fitLevel();
  const [level, setLevel] = useState(fitIdx);
  // Al acercar más allá del encuadre de grupo la foto se centra en el
  // punto de la ficha (detailCenter), no en el centroide — ese punto
  // es lo que el usuario quiere ver de cerca
  // El sesgo pierde fuerza a niveles más profundos (factor =
  // escala actual / escala de arranque): al acercar, el dot vuelve
  // al centro y la foto deja de desplazarse
  const biasK = bias && biasTo ? bias * (scales[level] / scales[fitIdx]) : 0;
  const viewCenter =
    detailCenter && level < fitIdx
      ? detailCenter
      : biasK && biasTo
        ? [lon + (biasTo[0] - lon) * biasK, lat + (biasTo[1] - lat) * biasK]
        : center;
  const [vlon, vlat] = viewCenter as [number, number];
  // Uri ya cargada: el skeleton solo tapa la foto si la actual aún no
  // llegó (los demás niveles se prefetchan → zoom instantáneo)
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  const uri = shotUrl(vlon, vlat, scales[level]);

  const dcLon = detailCenter?.[0];
  const dcLat = detailCenter?.[1];
  // Reset durante render al cambiar de punto/encuadre: recalcula el
  // nivel de zoom y libera el skeleton antes de pintar, sin render extra
  const shotKey = `${lon}|${lat}|${dcLon}|${dcLat}|${startLevel}|${fitMarkers}`;
  const [prevShotKey, setPrevShotKey] = useState(shotKey);
  if (prevShotKey !== shotKey) {
    setPrevShotKey(shotKey);
    setLevel(fitLevel());
    setLoadedUri(null);
  }

  const dLon = BASE_DLON * scales[level];
  const dLat = BASE_DLAT * scales[level];

  // Posición proyectada del punto real de la ficha (%): con sesgo
  // el encuadre se desplaza pero el dot queda donde vive — al
  // acercar (sesgo → 0) vuelve al 50%
  const cxPct = ((lon - (vlon - dLon)) / (2 * dLon)) * 100;
  const cyPct = ((vlat + dLat - lat) / (2 * dLat)) * 100;

  // Marcadores dentro del encuadre actual: lon/lat → % del contenedor.
  // Ordenados por cercanía al centro, con tope para no saturar zonas
  // densas (puerto de Santa Cruz, Costa Adeje)
  const visible = useMemo(() => {
    const cos = Math.cos((vlat * Math.PI) / 180);
    return markers
      .map((m) => {
        const [ml, ma] = m.coords;
        const dLonM = (ml - vlon) * 111320 * cos;
        const dLatM = (ma - vlat) * 110540;
        return {
          ...m,
          x: ((ml - (vlon - dLon)) / (2 * dLon)) * 100,
          y: ((vlat + dLat - ma) / (2 * dLat)) * 100,
          d2: dLonM * dLonM + dLatM * dLatM,
        };
      })
      .filter((m) => m.x >= 0 && m.x <= 100 && m.y >= 0 && m.y <= 100)
      .sort((a, b) => a.d2 - b.d2)
      .slice(0, MAX_MARKERS);
  }, [markers, vlon, vlat, dLon, dLat]);

  // Tamaño real del contenedor: el trazado se dibuja en píxeles
  // (rotar una View con % no funciona — la rotación es sobre su
  // propio centro, así que colocamos el centro en el punto medio)
  const [size, setSize] = useState({ w: 0, h: 0 });
  const seg = useMemo(() => {
    if (!line || !size.w || !size.h) return null;
    const fx = ((line.from[0] - (vlon - dLon)) / (2 * dLon)) * size.w;
    const fy = ((vlat + dLat - line.from[1]) / (2 * dLat)) * size.h;
    // La línea llega al dot proyectado, no al centro del
    // contenedor — con sesgo no son el mismo punto
    const cx = (cxPct / 100) * size.w;
    const cy = (cyPct / 100) * size.h;
    return {
      len: Math.hypot(cx - fx, cy - fy),
      ang: Math.atan2(cy - fy, cx - fx),
      mx: (fx + cx) / 2,
      my: (fy + cy) / 2,
      fx,
      fy,
    };
  }, [line, size, vlon, vlat, dLon, dLat, cxPct, cyPct]);

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
          // — cada uno sobre el centro que usará (centroide en el
          // encuadre de grupo, el punto de la ficha al acercar)
          scales.forEach((s, i) => {
            if (i === level) return;
            const c = detailCenter && i < fitIdx ? detailCenter : center;
            Image.prefetch(shotUrl(c[0], c[1], s)).catch(() => {});
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
      {visible.map((m) =>
        m.tag ? (
          // Dot + píldora con el nombre de la zona: el contenedor
          // (120 px centrados en el punto) deja sitio a nombres
          // largos sin desplazar el dot
          <View
            key={m.id}
            pointerEvents="none"
            style={[styles.taggedWrap, { left: `${m.x}%`, top: `${m.y}%` }]}
          >
            <View style={[styles.taggedDot, { backgroundColor: m.color }]} />
            <Text style={styles.markerTag} numberOfLines={1}>
              {m.tag}
            </Text>
          </View>
        ) : (
          <View
            key={m.id}
            pointerEvents="none"
            style={[
              styles.marker,
              { left: `${m.x}%`, top: `${m.y}%`, backgroundColor: m.color },
            ]}
          >
            {m.label ? (
              <Text style={styles.markerLabel}>{m.label}</Text>
            ) : (
              m.icon && <Image source={m.icon} style={styles.markerIcon} />
            )}
          </View>
        ),
      )}
      {/* El dot va a su posición real proyectada — con encuadre
          sesgado (biasTo) no coincide con el centro del contenedor */}
      <View
        pointerEvents="none"
        style={[
          styles.centerDot,
          { backgroundColor: centerColor },
          { left: `${cxPct}%`, top: `${cyPct}%` },
          hideCenter && { opacity: 0 },
        ]}
      >
        {centerLabel ? (
          <Text style={styles.markerLabel}>{centerLabel}</Text>
        ) : (
          centerIcon && <Image source={centerIcon} style={styles.centerIcon} />
        )}
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
          disabled={level === scales.length - 1}
          hitSlop={6}
          style={({ pressed }) => [
            styles.zoomBtn,
            level === scales.length - 1 && styles.zoomBtnOff,
            pressed && styles.pressFx,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Alejar vista satélite"
          accessibilityState={{ disabled: level === scales.length - 1 }}
        >
          <Text
            style={[
              styles.zoomText,
              level === scales.length - 1 && styles.zoomTextOff,
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
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerIcon: {
    width: 9,
    height: 9,
    tintColor: colors.onColor,
  },
  marker: {
    position: 'absolute',
    width: 18,
    height: 18,
    marginLeft: -9,
    marginTop: -9,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerIcon: {
    width: 10,
    height: 10,
    tintColor: colors.onColor,
  },
  markerLabel: {
    fontSize: 10,
    fontFamily: fonts.extrabold,
    color: colors.onColor,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  // Marcador con nombre: caja de 120 px centrada en el punto; el
  // dot queda encima y la píldora cuelga justo debajo
  taggedWrap: {
    position: 'absolute',
    width: 120,
    marginLeft: -60,
    marginTop: -7,
    alignItems: 'center',
  },
  taggedDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  markerTag: {
    marginTop: 3,
    maxWidth: 116,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 7,
    backgroundColor: 'rgba(0,0,0,0.55)',
    overflow: 'hidden',
    fontSize: 9,
    fontFamily: fonts.extrabold,
    color: colors.onColor,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  // Trazado de la conducción: línea discontinua con halo claro para
  // leerse sobre satélite (el borde blanco va por debajo vía sombra)
  trace: {
    position: 'absolute',
    height: 0,
    borderTopWidth: 3,
    borderStyle: 'dashed',
    opacity: 0.95,
    shadowColor: colors.onColor,
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
    backgroundColor: colors.surface,
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
    color: colors.onColor,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  zoomTextOff: {
    color: 'rgba(255,255,255,0.4)',
  },
  mapBtnIcon: {
    width: 14,
    height: 14,
    tintColor: colors.onColor,
  },
  // Atribución Esri: obligatoria pero visualmente discreta —
  // texto blanco semitransparente con sombra, esquina inferior
  // izquierda, sin pisar los marcadores ni el mar
  credit: {
    position: 'absolute',
    bottom: 5,
    left: 7,
    fontSize: 9,
    fontFamily: fonts.semibold,
    color: 'rgba(255,255,255,0.65)',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 2,
  },
});

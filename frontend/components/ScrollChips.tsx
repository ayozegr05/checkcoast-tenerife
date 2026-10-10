import React, { useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';

import { fonts } from '../lib/theme';

// Fade de borde sin expo-linear-gradient (modulo nativo, requeriria
// rebuild): tiras finas con alfa creciente simulan el degradado sobre
// el fondo de la lista
const BG_RGB = '242, 247, 248'; // colors.background
const STEPS = [0.05, 0.25, 0.5, 0.72, 0.88, 0.97];
const EDGE_W = 40;

function EdgeFade({ right, rgb }: { right: boolean; rgb: string }) {
  const steps = right ? STEPS : [...STEPS].reverse();
  return (
    <View style={styles.fade} pointerEvents="none">
      {steps.map((a, i) => (
        <View
          key={i}
          style={{ flex: 1, backgroundColor: `rgba(${rgb},${a})` }}
        />
      ))}
    </View>
  );
}

export default function ScrollChips({
  children,
  style,
  contentContainerStyle,
  fadeRgb = BG_RGB,
  fadeRgbLeft,
  fadeRgbRight,
  a11yLabel = 'filtros',
  edgeFade = true,
  anchorEnd = false,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  // RGB del fondo sobre el que se funde el fade (por defecto el fondo
  // de pantalla; sobre degradado se pueden pasar colores distintos
  // por lado con fadeRgbLeft/fadeRgbRight)
  fadeRgb?: string;
  fadeRgbLeft?: string;
  fadeRgbRight?: string;
  // Qué se desplaza, para los labels de accesibilidad
  a11yLabel?: string;
  // Sobre fondos fotográficos/degradados el bloque del fade queda
  // visible como "sombra cuadrada" — se puede apagar y dejar solo
  // el círculo de la flecha (queda limpio igual que sobre fondo liso)
  edgeFade?: boolean;
  // Series temporales: el scroll abre anclado al final (lo más
  // reciente a la vista, el pasado se explora hacia la izquierda)
  anchorEnd?: boolean;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const dims = useRef({ x: 0, w: 0, cw: 0 });
  const anchoredRef = useRef(false);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = () => {
    const { x, w, cw } = dims.current;
    setCanLeft(x > 8);
    setCanRight(x + w < cw - 8);
  };

  const scrollBy = (dir: 1 | -1) => {
    const x = Math.max(0, dims.current.x + dir * dims.current.w * 0.75);
    scrollRef.current?.scrollTo({ x, animated: true });
  };

  return (
    <View style={styles.wrap}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={style}
        contentContainerStyle={contentContainerStyle}
        scrollEventThrottle={16}
        onScroll={(e) => {
          dims.current.x = e.nativeEvent.contentOffset.x;
          update();
        }}
        onLayout={(e) => {
          dims.current.w = e.nativeEvent.layout.width;
          update();
        }}
        onContentSizeChange={(cw) => {
          const prevCw = dims.current.cw;
          dims.current.cw = cw;
          // Anclado inicial al final: una vez al medir el contenido,
          // sin animación (no es scroll del usuario, es posición inicial)
          if (anchorEnd && !anchoredRef.current && cw > 0) {
            anchoredRef.current = true;
            scrollRef.current?.scrollToEnd({ animated: false });
            dims.current.x = Math.max(0, cw - dims.current.w);
          }
          // Contenido encogido (p.ej. "Menos ›" pliega las chips de
          // año): si el offset queda fuera del nuevo máximo la fila
          // se ve en blanco — vuelve al inicio ella sola
          const maxX = Math.max(0, cw - dims.current.w);
          if (cw < prevCw && dims.current.x > maxX) {
            dims.current.x = maxX;
            scrollRef.current?.scrollTo({ x: maxX, animated: true });
          }
          update();
        }}
      >
        {children}
      </ScrollView>

      {canLeft && (
        <View style={[styles.edge, { left: 0 }]} pointerEvents="box-none">
          {edgeFade && <EdgeFade right={false} rgb={fadeRgbLeft ?? fadeRgb} />}
          <Pressable
            style={({ pressed }) => [
              styles.arrow,
              { left: 2 },
              pressed && styles.pressFx,
            ]}
            onPress={() => scrollBy(-1)}
            accessibilityRole="button"
            accessibilityLabel={`Desplazar ${a11yLabel} a la izquierda`}
          >
            <Text style={styles.arrowText}>‹</Text>
          </Pressable>
        </View>
      )}
      {canRight && (
        <View style={[styles.edge, { right: 0 }]} pointerEvents="box-none">
          {edgeFade && <EdgeFade right rgb={fadeRgbRight ?? fadeRgb} />}
          <Pressable
            style={({ pressed }) => [
              styles.arrow,
              { right: 2 },
              pressed && styles.pressFx,
            ]}
            onPress={() => scrollBy(1)}
            accessibilityRole="button"
            accessibilityLabel={`Desplazar ${a11yLabel} a la derecha`}
          >
            <Text style={styles.arrowText}>›</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Feedback táctil común: leve fundido al presionar
  pressFx: {
    opacity: 0.6,
  },
  wrap: {
    position: 'relative',
  },
  edge: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: EDGE_W,
    justifyContent: 'center',
  },
  fade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
  },
  // Círculo pequeño verde-mar translúcido (casa con las barras de la
  // gráfica) con chevron navy grande: casi llena el círculo, sin halo
  arrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -13,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(13,148,136,0.5)', // verde-mar de las barras
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },

  arrowText: {
    fontSize: 24,
    lineHeight: 26,
    fontFamily: fonts.extrabold,
    color: '#fff',
    textAlign: 'center',
    includeFontPadding: false,
  },
});

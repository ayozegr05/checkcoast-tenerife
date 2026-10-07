import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Platform,
  ScrollView,
  useWindowDimensions,
} from 'react-native';

type UseSheetDragOpts = {
  // Card bajita en reposo: fracción de pantalla que se levanta sobre
  // el borde inferior (0 = anclada abajo)
  liftFrac: number;
  // El cierre puede resolverlo el contenido (p. ej. volver al picker
  // de PMs con una zona abierta): devuelve true si lo gestionó él
  interceptClose: () => boolean;
  onClose: () => void;
  // Cuando la ficha tapa los botones flotantes del mapa (satélite,
  // brújula, capas) el mapa los desactiva para que la ✕ siempre
  // cierre — se calcula por geometría, no solo por "expandida":
  // en pantallas bajas la ficha en reposo ya puede cubrirlos
  onCoverageChange?: (coversControls: boolean) => void;
};

// Card flotante arrastrable: peek (~42% alto) -> expandida (~86%) ->
// cerrada (deslizar abajo). Anima la ALTURA (no translateY) para que la
// card termine dentro de pantalla y se vea el mar debajo.
// Sin deps nativas: PanResponder + Animated.
export function useSheetDrag({
  liftFrac,
  interceptClose,
  onClose,
  onCoverageChange,
}: UseSheetDragOpts) {
  const winH = useWindowDimensions().height;
  // Card anclada ABAJO: al expandir crece hacia arriba hasta ~92% de
  // pantalla. Antes el top estaba fijo al 45% y el máximo era solo
  // ~55%, así que "Ver más" no expandía de verdad.
  const NAV_INSET = Platform.OS === 'android' ? 30 : 0;
  const CARD_BOTTOM = 14 + NAV_INSET; // flota sobre la barra de gestos
  // La topbar queda siempre visible: la card ni en expandido la tapa.
  // La columna de botones flotantes (satélite/brújula/capas) SÍ queda
  // tapada al expandir — CoastMap los desactiva vía onExpandChange
  const TOP_MARGIN = 118;
  // Borde inferior de la columna de botones flotantes del mapa
  // (capas: top 192/176 + ~34 de alto): si el borde superior de la
  // ficha queda por encima, los tapa
  const CONTROLS_BOTTOM = Platform.OS === 'android' ? 230 : 214;
  const CARD_MAX = Math.round(winH - CARD_BOTTOM - TOP_MARGIN);
  const HEADER_H = 64; // asa + titulo aprox
  // Peek tope ~52% de pantalla: fichas con mucha info abren a media
  // altura y el resto (informe de calidad, histórico…) se descubre
  // con "Ver más" o arrastrando el asa
  const PEEK_MAX = Math.round(winH * 0.64);
  const [bodyH, setBodyH] = useState(0);
  // Peek = altura del contenido (con minimo razonable y tope PEEK_MAX)
  const peek = Math.max(170, Math.min(PEEK_MAX, CARD_MAX, bodyH + HEADER_H));
  const h = useRef(new Animated.Value(0)).current; // cerrada = alto 0
  const b = useRef(new Animated.Value(CARD_BOTTOM)).current;
  // Card bajita en reposo: flota sobre el borde en vez de ir pegada
  // abajo. Emisarios suben más (cards muy cortas), playas sin
  // monitorizar un punto menos; las fichas con contenido o de playas
  // monitorizadas siguen ancladas abajo
  const restBottom =
    liftFrac > 0 && peek < winH * 0.45
      ? Math.round(winH * liftFrac)
      : CARD_BOTTOM;
  const snapped = useRef(0);
  const expanded = useRef(false);
  const closing = useRef(false);
  // Estado espejo de expanded para re-render (el ref no dispara render)
  const [isExpanded, setIsExpanded] = useState(false);
  // La ficha tapa los controles si su borde superior queda por encima
  // del borde inferior de la columna de botones. Expandida siempre
  // (top = TOP_MARGIN = 118); en reposo depende del alto de la ficha
  // — en pantallas bajas el peek del 64% ya puede cubrirlos
  const coversControls =
    isExpanded || winH - restBottom - peek < CONTROLS_BOTTOM;
  useEffect(
    () => onCoverageChange?.(coversControls),
    [coversControls, onCoverageChange],
  );
  // Scroll del cuerpo: BeachDetail lo usa para bajar a "Ver titulares"
  const bodyRef = useRef<ScrollView>(null);
  // "Ver más" visible mientras quede contenido por debajo del viewport.
  // Derivado de las métricas de scroll (offset, alto visible, alto de
  // contenido) — como estado, no ref: el render depende de él.
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

  // Geometría y callbacks frescos para el PanResponder: se crea una
  // sola vez y sin refs capturaría el peek inicial (170) y el
  // interceptClose del primer render para siempre
  const geom = useRef({ peek, cardMax: CARD_MAX, restBottom, CARD_BOTTOM });
  geom.current = { peek, cardMax: CARD_MAX, restBottom, CARD_BOTTOM };
  const interceptRef = useRef(interceptClose);
  interceptRef.current = interceptClose;

  const snapTo = (target: number, isExpanded = false) => {
    snapped.current = target;
    expanded.current = isExpanded;
    setIsExpanded(isExpanded);
    const bottom = isExpanded
      ? geom.current.CARD_BOTTOM
      : geom.current.restBottom;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Con una zona abierta, cerrar primero vuelve al selector de zonas
  // (mismo comportamiento que el atrás hardware); desde el selector
  // sí se cierra la card
  const requestClose = () => {
    if (!interceptRef.current()) dismiss();
  };

  // Sin expandir la card: "Ver más" solo baja el contenido
  // una página (~85% del viewport) dentro de la misma altura
  const onMore = () => {
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
      if (m2.ch > 0 && m2.y + m2.vh >= m2.ch - 120) setShowMore(false);
    }, 800);
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6,
      onPanResponderMove: (_e, g) => {
        // Arrastrar hacia abajo (dy>0) encoge la card
        const nh = Math.max(
          60,
          Math.min(geom.current.cardMax, snapped.current - g.dy),
        );
        h.setValue(nh);
      },
      onPanResponderRelease: (_e, g) => {
        const { peek: pk, cardMax } = geom.current;
        const nh = snapped.current - g.dy;
        const mid = (pk + cardMax) / 2;
        if (nh < pk * 0.55 || g.vy > 1.4) requestClose();
        else if (nh > mid || g.vy < -1.2) snapTo(cardMax, true);
        else snapTo(pk);
      },
    }),
  ).current;

  return {
    // Valores animados: bottom y height del sheet
    h,
    b,
    panHandlers: pan.panHandlers,
    bodyRef,
    bodyProps: {
      onLayout: (e: LayoutChangeEvent) => {
        scrollMetrics.current.vh = e.nativeEvent.layout.height;
        recomputeMore();
      },
      onContentSizeChange: (_w: number, ch: number) => {
        setBodyH(ch);
        // Re-evaluar al cambiar el contenido: si veníamos del picker
        // de PMs (corto) la ficha larga debe volver a mostrar el
        // botón aunque nadie haya hecho scroll todavía.
        scrollMetrics.current.ch = ch;
        recomputeMore();
      },
      onScroll: handleScroll,
      onMomentumScrollEnd: handleScroll,
      scrollEventThrottle: 80,
    },
    showMore,
    onMore,
    requestClose,
    // "Ver en el mapa" y similares: cerrar con la misma animación y
    // ejecutar el callback al terminar
    dismiss,
  };
}

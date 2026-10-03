import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Platform,
  Image,
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
  OutfallNearbyBeach,
  fetchOutfallNearbyBeaches,
} from '../lib/api';
import {
  beachBaseName,
  pointLongLabel,
  displayBeachName,
} from '../lib/format';
import { outfallRisk, RISK_LABEL } from '../lib/outfallRisk';
import { colors, fonts } from '../lib/theme';

const STATUS_LABELS: Record<string, string> = {
  legal: 'Autorizado',
  illegal: 'No autorizado',
  unknown: 'En trámite',
};

const STATUS_COLORS = colors.outfall;

// Nivel de preocupación → tinte de la banda "Para el bañista"
const RISK_COLORS: Record<string, string> = {
  alto: '#d84315',
  medio: '#f9a825',
  bajo: '#0d9488',
};

// Estado físico de la conducción: semáforo de 3 niveles — "Precario"
// es naranja fuerte (aviso), el rojo se reserva para "Malo"
const CONDITION_COLORS: Record<string, string> = {
  Bueno: colors.outfall.legal,
  Precario: colors.status.warning,
  Malo: colors.outfall.illegal,
};

// Siglas del censo traducidas a lenguaje de ficha — el campo trae
// el nombre propio ("EBAR Callao Salvaje"), no solo la sigla.
// Siglas del censo traducidas — el campo puede combinar instalaciones
// ("EDAR + EDAM Adeje Arona"): se traduce cada una
// EBAR = bombeo de residuales (vierte sin tratar al desbordarse);
// EDAR/EDAS/ETAR = depuradoras (ya tratadas); EDAM = desaladora
// (vierte salmuera)
const originKindLabel = (t: string) =>
  t.startsWith('EBAR')
    ? 'bombeo de aguas residuales'
    : t.startsWith('EDAM')
      ? 'desaladora'
      : /^E[DT]A[RS]/.test(t)
        ? 'depuradora'
        : null;

// El nombre propio ("EDAR + EDAM Adeje Arona") ya lo dice la
// cabecera de la card — la traducción devuelve solo el tipo
const originLabel = (s: string) => {
  const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
  if (s.includes('+')) {
    const labels = s.split('+').map((t) => originKindLabel(t.trim()));
    if (labels.every(Boolean))
      return cap([...new Set(labels)].join(' + '));
  }
  const l = originKindLabel(s.trim());
  return l ? cap(l) : s;
};

// "ZEC Franja marina Teno - Rasca. nº ZEC 103_TF. Ref. ES7020017"
// → solo el nombre del espacio protegido (los códigos 103_TF /
// ES7020017 son identificadores de registro, no info de ficha)
const protectedAreaName = (s: string) =>
  s
    .split(/\.\s*(?:n[ºú]|Ref\.?|ES\d)/i)[0]
    .trim()
    .replace(/\.$/, '');

// Por qué importa cada espacio protegido: nota ecológica breve para
// la caja ZEC (solo hay dos ZEC en el censo de Tenerife)
const protectedAreaNote = (s: string) =>
  /Teno\s*-\s*Rasca/i.test(s)
    ? ' — hogar de calderones tropicales y delfines mulares, con cachalotes y tortugas de paso'
    : /Sebadales/i.test(s)
      ? ' — protege praderas de sebada, fanerógamas marinas que sirven de criadero de peces'
      : '';

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

// EstadoFunc (¿opera hoy?) + ContinVert (régimen de DISEÑO) en una
// sola frase legible — evita la aparente contradicción "no activo
// pero vertido habitual"
// La conducción como frase: "Emisario submarino que vierte a 646 m
// de la orilla y a 24 m de profundidad". La distancia a la orilla
// (shore_m, derivada) es lo que importa — el largo del tubo puede
// empezar tierra adentro y despistar
const conduitText = (
  kind: string | null | undefined,
  shore: number | null | undefined,
  length: number | null | undefined,
  depth: number | null | undefined,
): string | null => {
  const parts: string[] = [];
  if (kind) parts.push(kind[0].toUpperCase() + kind.slice(1));
  else if (shore != null || length != null || depth != null)
    parts.push('La conducción');
  if (!parts.length) return null;
  let s = parts[0];
  if (shore != null)
    s += ` que vierte a ${Math.round(shore)} m de la orilla`;
  else if (length != null) s += ` de ${Math.round(length)} m`;
  if (depth != null)
    s +=
      depth < 0
        ? ` y a ${Math.abs(depth)} m de profundidad`
        : depth > 0
          ? ' y cae sobre la superficie del mar'
          : ' y sale a ras de mar';
  return `${s}.`;
};

// Filas crudas del censo para el plegable "Datos del censo" — la
// narrativa ya las cuenta, esto es la transparencia para el friki
const censusRows = (p: GeoFeature['properties']) =>
  [
    ['Tipo de conducción', p.kind],
    ['Naturaleza', p.nature],
    ['Régimen', p.continuity],
    [
      'Funcionamiento',
      p.is_active == null ? null : p.is_active ? 'Activo' : 'No activo',
    ],
    ['Estado físico', p.condition],
    ['Procedencia', p.origin],
    ['Titular (Entidad)', p.entity],
    ['Operador (GestSan)', p.manager],
    ['Núcleo urbano', p.settlement],
    ['Localización', p.location],
    ['Espacio protegido', p.protected_area],
    [
      'Longitud de conducción',
      p.length_m != null ? `${Math.round(p.length_m)} m` : null,
    ],
    [
      'Cota del punto de vertido',
      p.outfall_depth != null ? `${p.outfall_depth} m` : null,
    ],
    [
      'Distancia a la orilla (calculada)',
      p.shore_m != null ? `${Math.round(p.shore_m)} m` : null,
    ],
  ].filter(([, v]) => v != null) as [string, string][];

// Qué significa cada sustancia para el ciudadano: la naturaleza
// puede combinar ("Agua residual y salmuera") y el origen dice de
// qué instalación sale cada parte → una línea por apartado
// ("Depuradora — aguas fecales…", "Desaladora — salmuera…")
const natureParts = (
  nature: string,
  origin: string | null | undefined,
  depth: number | null | undefined,
): { label: string; note: string }[] => {
  const n = nature.toLowerCase();
  const o = (origin ?? '').toLowerCase();
  const parts: { src: string | null; name: string; note: string }[] =
    [];
  if (n.includes('residual'))
    parts.push({
      src: /e[dt]a[rs]|depuradora|tratamiento/.test(o)
        ? 'Depuradora'
        : /ebar|bombeo|pretratamiento|saneamiento|aliviadero|red/.test(
              o,
            )
          ? 'Red de saneamiento'
          : null,
      name: n.includes('industrial')
        ? 'aguas fecales, domésticas e industriales'
        : 'aguas fecales y domésticas',
      note: 'el riesgo depende del tratamiento: depurada es leve, en bruto es contaminación fecal.',
    });
  if (n.includes('salmuera')) {
    // La profundidad solo se convierte en aviso cuando es contundente:
    // un vertido somero llega al fondo casi sin diluir pase lo que
    // pase; uno profundo NO garantiza buen diseño (caudal y difusor
    // mandan también) → silencio antes que falsa tranquilidad
    const shallow =
      depth != null && (depth >= 0 || Math.abs(depth) < 8);
    parts.push({
      src: /edam|desaladora|salina/.test(o) ? 'Desaladora' : null,
      name: 'salmuera',
      note:
        'el concentrado de sal que devuelve la desaladora — no lleva fecales, pero es más densa que el mar y puede formar una capa sobre el fondo que daña praderas y bentos.' +
        (shallow
          ? depth! >= 0
            ? ' Y aquí el vertido cae sobre la superficie del mar, así que esa capa salada llega al fondo casi sin diluirse.'
            : ` Y aquí vierte a solo ${Math.abs(depth!)} m de profundidad, así que esa capa salada llega al fondo casi sin diluirse.`
          : '') +
        ' El bañista apenas lo nota.',
    });
  }
  if (n.includes('piscina'))
    parts.push({
      src: /piscina|n[aá]utico|club/.test(o) ? 'Piscinas' : null,
      name: 'agua de piscinas',
      note: 'con cloro y sal — impacto leve y puntual.',
    });
  if (n.includes('refrigeración'))
    parts.push({
      src: null,
      name: 'agua de refrigeración',
      note: 'sale a otra temperatura — impacto térmico puntual.',
    });
  if (n.includes('pluvial'))
    parts.push({
      src: /pluvial/.test(o) ? 'Red de pluviales' : null,
      name: 'agua de lluvia',
      note: 'arrastra aceites, metales y suciedad de las calles — no es fecal, pero tras la sequía sale cargada.',
    });
  // Con varias sustancias la etiqueta nombra cada una
  // ("Depuradora — aguas fecales…" / "Desaladora — salmuera…");
  // con una sola basta la instalación para no repetir el heroValue
  const multi = parts.length > 1;
  return parts.map((p) => ({
    label: multi
      ? [p.src, p.name].filter(Boolean).join(' — ')
      : (p.src ?? p.name),
    note: p.note,
  }));
};

const operationText = (
  active: boolean | null | undefined,
  continuity: string | null | undefined,
): string | null => {
  const habitual = continuity === 'Habitual';
  // "De excedencia-emergencia" del censo = válvula de escape que solo
  // abre cuando el sistema se desborda: lluvia fuerte, avería o
  // mantenimiento — no "emergencia" en sentido de catástrofe
  const overflow =
    'cuando el sistema se desborda (lluvia fuerte, avería o más caudal del que la depuradora puede tratar)';
  if (active === true)
    return continuity == null
      ? 'En funcionamiento actualmente.'
      : habitual
        ? 'Funciona hoy: vierte de forma continua en uso normal.'
        : `Funciona hoy, pero solo debería verter ${overflow}.`;
  if (active === false)
    return continuity == null
      ? 'No opera ahora mismo.'
      : habitual
        ? 'No opera ahora mismo, aunque está pensado para verter a diario.'
        : `No opera ahora mismo; está pensado para abrir solo ${overflow}.`;
  return continuity == null
    ? null
    : habitual
      ? 'Pensado para vertido habitual.'
      : `Pensado para abrir solo ${overflow}.`;
};

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
  const operationLine = isBeach
    ? null
    : operationText(p.is_active, p.continuity);
  const risk = isBeach ? null : outfallRisk(p);
  const [censusOpen, setCensusOpen] = useState(false);
  // Tono de la caja de funcionamiento: ámbar si opera a diario (el
  // combo que importa al bañista), verde si solo en emergencias,
  // gris si está parado
  const opColor =
    p.is_active === true
      ? p.continuity === 'Habitual'
        ? colors.status.warning
        : colors.status.open
      : colors.status.unmonitored;
  // Ubicación en una línea: punto concreto · núcleo urbano, sin
  // repetir el municipio ni valores duplicados ("Barranco de Troya
  // · Playa de Las Américas" y luego Municipio: Adeje)
  const whereLabel = isBeach
    ? null
    : [p.location, p.settlement]
          .filter((v, i, a) => v && a.indexOf(v) === i && v !== p.municipality)
          .join(' · ') || null;

  // Selector de PMs: si la playa agrupada tiene varios puntos de
  // muestreo, la card muestra primero la lista y el usuario elige
  const members = isBeach ? (selection.members ?? []) : [];
  const [chosenPm, setChosenPm] = useState<GeoFeature | null>(null);
  useEffect(() => setChosenPm(null), [selection]);
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

  // Playas en un radio de 1.5 km del vertido (proximidad geométrica,
  // no implica vínculo oficial con ningún cierre)
  const [nearby, setNearby] = useState<OutfallNearbyBeach[]>([]);
  useEffect(() => {
    if (isBeach) return;
    setNearby([]);
    fetchOutfallNearbyBeaches(feature.id)
      // Una fila por playa, no por PM: "Porís de Abona PM1/PM2" son la
      // misma playa — dedup por nombre base conservando la más cercana
      .then((list) =>
        setNearby(
          list.filter(
            (n, i) =>
              list.findIndex(
                (m) =>
                  beachBaseName(m.beach_name) ===
                  beachBaseName(n.beach_name),
              ) === i,
          ),
        ),
      )
      .catch(() => setNearby([]));
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
        </View>
        <Pressable
          onPress={() => dismiss()}
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
                    style={({ pressed }) => [
                      styles.pmRow,
                      pressed && styles.pressFx,
                    ]}
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
                  style={({ pressed }) => pressed && styles.pressFx}
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
              line={
                p.start_lon != null && p.start_lat != null
                  ? {
                      from: [p.start_lon, p.start_lat],
                      color: colors.primary,
                    }
                  : undefined
              }
              onPress={handleViewOnMap}
              startLevel={1}
            />
            {/* Chip único de legalidad + frase fluida de
                funcionamiento: "Activo + habitual" como lectura
                continua, no como etiquetas apiladas */}
            <View style={styles.chipsRow}>
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
            </View>
            {/* Funcionamiento como caja tintada, mismo lenguaje que
                las cajas de prensa/ZEC: el fondo ya cuenta la
                situación antes de leer la frase */}
            {operationLine ? (
              <View
                style={[
                  styles.opBox,
                  {
                    borderLeftColor: opColor,
                    backgroundColor: `${opColor}14`,
                  },
                ]}
              >
                <Text style={styles.opText}>{operationLine}</Text>
              </View>
            ) : null}

            {/* ZEC justo tras el funcionamiento: que vierta en zona
                protegida es contexto de máxima prioridad */}
            {p.protected_area ? (
              <View style={styles.protectedBox}>
                <Text style={styles.protectedTitle}>
                  Emisario en espacio protegido
                </Text>
                <Text style={styles.protectedName}>
                  Este emisario está dentro de la{' '}
                  {protectedAreaName(p.protected_area)}, una Zona
                  Especial de Conservación de la red Natura 2000
                  {protectedAreaNote(p.protected_area)}.
                </Text>
              </View>
            ) : null}
            {/* El vertido: la respuesta protagonista — qué cae al mar
                y de dónde viene. Es la pregunta que abre la ficha */}
            {p.nature || p.entity || p.manager ? (
              <View style={styles.heroBox}>
                <Image
                  source={require('../assets/icons/icon-faucet.png')}
                  style={styles.heroIcon}
                />
                <View style={styles.heroText}>
                  {p.nature ? (
                    <>
                      <Text style={styles.heroKicker}>
                        Qué se vierte
                      </Text>
                      <Text style={styles.heroValue}>{p.nature}</Text>
                      {p.origin ? (
                        <Text style={styles.heroSub}>
                          {originLabel(p.origin)}
                        </Text>
                      ) : null}
                      {natureParts(
                        p.nature,
                        p.origin,
                        p.outfall_depth,
                      ).map(
                        (pt, i) => (
                          <Text key={i} style={styles.heroNote}>
                            <Text style={styles.heroRespStrong}>
                              {pt.label[0].toUpperCase() +
                                pt.label.slice(1)}
                            </Text>
                            {` — ${pt.note}`}
                          </Text>
                        ),
                      )}
                    </>
                  ) : null}
                  {/* Quién responde legalmente (Entidad) y quién lo
                      opera (GestSan) — la responsabilidad es del
                      titular siempre */}
                  {p.entity ? (
                    <Text style={styles.heroResp}>
                      Responsable:{' '}
                      <Text style={styles.heroRespStrong}>
                        {p.entity}
                      </Text>
                      {p.manager && p.manager !== p.entity
                        ? ` · operado por ${p.manager}`
                        : null}
                    </Text>
                  ) : p.manager ? (
                    <Text style={styles.heroResp}>
                      Operador:{' '}
                      <Text style={styles.heroRespStrong}>
                        {p.manager}
                      </Text>
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : null}
            {/* Dónde + conducción en una sola card: son pocos datos
                y juntos narran "está aquí, sale así". El responsable
                vive en el hero; la profundidad va visible */}
            {p.location || p.settlement || p.municipality || p.zone_desc ||
            p.kind || p.length_m != null || p.outfall_depth != null ||
            p.condition ? (
              <View
                style={[
                  styles.secCard,
                  { borderLeftColor: colors.accent },
                ]}
              >
                <View style={styles.secHead}>
                  <Image
                    source={require('../assets/icons/icon-map.png')}
                    style={[
                      styles.secIcon,
                      { tintColor: colors.accent },
                    ]}
                  />
                  <Text style={styles.secCardTitle}>
                    Dónde y cómo
                  </Text>
                </View>
                {whereLabel || p.municipality ? (
                  <Text style={styles.row}>
                    Está en{' '}
                    {[whereLabel, p.municipality]
                      .filter(Boolean)
                      .join(', ')}
                    .
                  </Text>
                ) : null}
                {p.zone_desc ? (
                  <Text style={styles.zoneDesc}>{p.zone_desc}</Text>
                ) : null}
                {conduitText(
                  p.kind,
                  p.shore_m,
                  p.length_m,
                  p.outfall_depth,
                ) ? (
                  <Text style={styles.row}>
                    {conduitText(
                      p.kind,
                      p.shore_m,
                      p.length_m,
                      p.outfall_depth,
                    )}
                  </Text>
                ) : null}
                {p.condition ? (
                  <Text style={styles.row}>
                    Su estado es{' '}
                    <Text
                      style={[
                        styles.rowStrong,
                        {
                          color:
                            CONDITION_COLORS[p.condition] ??
                            colors.text,
                        },
                      ]}
                    >
                      {p.condition.toLowerCase()}
                    </Text>
                    .
                  </Text>
                ) : null}
              </View>
            ) : null}
            {/* Síntesis: la respuesta a "y a mí qué" — el mismo
                índice que ordena la lista de emisarios */}
            {risk ? (
              <View
                style={[
                  styles.opBox,
                  {
                    borderLeftColor: RISK_COLORS[risk.level],
                    backgroundColor: `${RISK_COLORS[risk.level]}14`,
                  },
                ]}
              >
                <Text style={styles.opText}>
                  Para el bañista:{' '}
                  <Text
                    style={[
                      styles.opText,
                      {
                        color: RISK_COLORS[risk.level],
                        fontFamily: fonts.extrabold,
                      },
                    ]}
                  >
                    {RISK_LABEL[risk.level].toLowerCase()}
                  </Text>
                  {risk.reasons.length
                    ? ` — ${risk.reasons.join(', ')}`
                    : ''}
                  .
                </Text>
              </View>
            ) : null}

            {/* Datos brutos del censo, plegados: la narrativa ya lo
                cuenta, esto es la transparencia completa */}
            <Pressable
              onPress={() => setCensusOpen((v) => !v)}
              style={({ pressed }) => [
                styles.censusToggle,
                pressed && styles.pressFx,
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                censusOpen
                  ? 'Ocultar datos del censo'
                  : 'Ver datos del censo'
              }
            >
              <Text style={styles.censusToggleText}>
                {censusOpen ? '▾' : '▸'} Datos del censo
              </Text>
            </Pressable>
            {censusOpen
              ? censusRows(p).map(([k, v]) => (
                  <Text key={k} style={styles.censusRow}>
                    <Text style={styles.censusKey}>{k}: </Text>
                    {v}
                  </Text>
                ))
              : null}

            {nearby.length > 0 ? (
              <>
                <Text style={styles.nearTitle}>
                  Playas cercanas{' '}
                  <Text style={styles.nearSub}>
                    · si no las ves, aleja el zoom
                  </Text>
                </Text>
                {nearby.map((n) => {
                  const beachTarget = (beaches ?? []).find(
                    (b) => b.id === n.beach_id,
                  );
                  return (
                    <Pressable
                      key={n.beach_id}
                      style={({ pressed }) => [
                        styles.nearestBox,
                        {
                          borderLeftColor:
                            STATUS_COLORS[statusKey] ??
                            colors.status.unknown,
                        },
                        pressed && styles.pressFx,
                      ]}
                      onPress={
                        beachTarget && onSelectBeach
                          ? () => onSelectBeach(beachTarget)
                          : undefined
                      }
                      disabled={!beachTarget || !onSelectBeach}
                      accessibilityRole="button"
                      accessibilityLabel={`${displayBeachName(beachBaseName(n.beach_name))}, ver en el mapa`}
                    >
                      <View style={styles.nearestBody}>
                        <Text
                          style={styles.nearestName}
                          numberOfLines={1}
                        >
                          {displayBeachName(beachBaseName(n.beach_name))}
                        </Text>
                        {n.municipality ? (
                          <Text style={styles.nearestMeta}>
                            {n.municipality}
                          </Text>
                        ) : null}
                      </View>
                      {/* Distancia como badge: columna escaneable,
                          mismo formato que "Emisarios cercanos" */}
                      <Text
                        style={[
                          styles.nearestDist,
                          {
                            color:
                              STATUS_COLORS[statusKey] ??
                              colors.status.unknown,
                          },
                        ]}
                      >
                        {fmtDistance(n.distance_m)}
                      </Text>
                      {beachTarget && onSelectBeach && (
                        <Text style={styles.nearestChevron}>›</Text>
                      )}
                    </Pressable>
                  );
                })}
              </>
            ) : null}
          </View>
        )}
      </ScrollView>

      {/* Pie de la ficha: la fuente del dato va fija abajo con
          separador — es metadato, no parte del contenido */}
      {!isBeach && (
        <View style={styles.footer}>
          <Pressable
            onPress={() =>
              p.source_url && Linking.openURL(p.source_url)
            }
            disabled={!p.source_url}
            accessibilityRole="link"
            accessibilityLabel="Abrir el censo oficial de vertidos"
          >
            <Text style={[styles.footerText, styles.footerLink]}>
              Fuente: Censo de Vertidos 2025 (Gob. Canarias) ↗
            </Text>
          </Pressable>
        </View>
      )}

      {/* "Ver más": insinúa que hay contenido debajo. Aparece cuando el
          contenido no cabe en el viewport actual del ScrollView (aunque
          cupiera en la card expandida — el usuario aún no la ha
          expandido). Si la card está plegada la expande primero; en
          ambos casos baja sola hasta el final. Se oculta al llegar
          abajo. */}
      {showMore && (
        <Pressable
          style={({ pressed }) => [
            styles.moreBtn,
            // Con footer fijo (ficha de emisario) el botón sube por
            // encima de él para no pisarlo
            !isBeach && styles.moreBtnRaised,
            pressed && styles.pressFx,
          ]}
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
    marginHorizontal: 40,
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
  // Los chips del emisario van en fila (legalidad + activo + régimen):
  // el chip solo pierde el centrado cuando hay hermanos
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
  },
  chip: {
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
  // Caja de funcionamiento (activo/régimen): barra + fondo tintado
  // del color de escenario, como las cajas de prensa o la ZEC
  opBox: {
    marginTop: 6,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  opText: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.text,
    lineHeight: 17,
  },
  row: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.text,
    marginTop: 4,
  },
  rowStrong: {
    fontFamily: fonts.semibold,
  },
  zoneDesc: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 4,
  },
  // Respuesta protagonista del emisario: "qué se vierte" con icono —
  // no una fila más, es la pregunta que abre la ficha
  heroBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    backgroundColor: colors.background,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  heroIcon: {
    width: 22,
    height: 22,
    tintColor: colors.primary,
  },
  heroText: {
    flex: 1,
  },
  heroKicker: {
    fontSize: 11,
    fontFamily: fonts.bold,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  heroValue: {
    fontSize: 15,
    fontFamily: fonts.extrabold,
    color: colors.text,
    marginTop: 1,
  },
  heroSub: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 2,
  },
  heroNote: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    lineHeight: 15,
    marginTop: 4,
  },
  heroResp: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 4,
  },
  heroRespStrong: {
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  // Mini-cabecera de sección — rompe el "muro de filas" en bloques
  secTitle: {
    fontSize: 11,
    fontFamily: fonts.extrabold,
    color: colors.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 12,
    marginBottom: 2,
  },
  // Sección como mini-card: barra de color + icono + título, mismo
  // lenguaje que heroBox y la caja de espacio protegido
  secCard: {
    marginTop: 10,
    borderLeftWidth: 3,
    backgroundColor: colors.background,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  secHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 2,
  },
  secIcon: {
    width: 15,
    height: 15,
  },
  secCardTitle: {
    fontSize: 11,
    fontFamily: fonts.extrabold,
    color: colors.primaryDark,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  // Espacio protegido (ZEC…): caja tintada verde — es contexto
  // ambiental, no parte de la lista de datos
  // ZEC en ámbar (aviso), no verde: verter dentro de una zona
  // protegida hace al emisario más delicado, no más "correcto"
  protectedBox: {
    marginTop: 8,
    marginBottom: 4,
    borderLeftWidth: 3,
    borderLeftColor: colors.status.warning,
    backgroundColor: `${colors.status.warning}14`,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  protectedTitle: {
    fontSize: 11,
    fontFamily: fonts.bold,
    color: colors.status.warning,
    textTransform: 'uppercase',
  },
  protectedName: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.text,
    marginTop: 1,
  },
  nearestBox: {
    marginBottom: 6,
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 4,
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
  nearestBody: {
    flex: 1,
    paddingRight: 4,
  },
  nearestMeta: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 1,
  },
  // Distancia como badge en columna — mismo patrón que
  // outfallDist en BeachDetail ("Emisarios cercanos")
  nearestDist: {
    fontSize: 13,
    fontFamily: fonts.bold,
    alignSelf: 'center',
    marginRight: 6,
    minWidth: 46,
    textAlign: 'right',
  },
  nearTitle: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: colors.text,
    marginTop: 8,
    marginBottom: 8,
  },
  nearSub: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  nearestName: {
    fontSize: 12,
    fontFamily: fonts.semibold,
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
  // Sobre el footer fijo de la ficha de emisario (~34px alto)
  moreBtnRaised: {
    bottom: 44,
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  censusToggle: {
    marginTop: 2,
    marginBottom: 4,
    paddingVertical: 4,
  },
  censusToggleText: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
  },
  censusRow: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    lineHeight: 16,
  },
  censusKey: {
    fontFamily: fonts.semibold,
    color: colors.textFaint,
  },
  footerText: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  footerLink: {
    color: colors.primary,
  },
  moreText: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: '#fff',
  },
});

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import SatelliteShot, { thumbUrl } from '../SatelliteShot';
import ScrollChips from '../ScrollChips';
import type { GeoFeature } from '../../lib/api';
import {
  OutfallNearbyBeach,
  OutfallNewsItem,
  OutfallNewsResponse,
  fetchOutfallNearbyBeaches,
  fetchOutfallNews,
} from '../../lib/api';
import {
  beachBaseName,
  displayBeachName,
  fmtDate,
  fmtDistance,
  newsSourceLabel,
} from '../../lib/format';
import { outfallRisk, RISK_COLORS } from '../../lib/outfallRisk';
import { beachStatusKey } from '../../lib/beachStatus';
import {
  OUTFALL_STATUS_LABELS,
  CONDITION_COLORS,
  conduitSegs,
  kpiSegs,
  zoneText,
  originLabel,
  protectedAreaName,
  protectedAreaNote,
  natureParts,
  smartTitle,
  operationShort,
  operationDetail,
  nearbyUniqueBeaches,
  OUTFALL_NEWS_TITLE,
  OUTFALL_NEWS_NAMED,
  OUTFALL_NEWS_ZONE,
  outfallNewsMeta,
  flattenNewsGroups,
  newsChipLabel,
  clusterNewsCoverage,
  clusterSpan,
  clusterHeadline,
  singleNewsBeach,
  newsCoverageSynthesis,
  denunciaLead,
  FlatNewsItem,
  NewsCluster as NewsClusterT,
} from '../../lib/outfallSheet';
import { colors, fonts } from '../../lib/theme';

type OutfallSheetProps = {
  feature: GeoFeature;
  // Emisarios y playas cargados en la app: se superponen a la foto
  // satélite y dan destino a las filas de "Playas cercanas"
  outfalls?: GeoFeature[];
  beaches?: GeoFeature[];
  // Tap en la foto satélite → ver el punto en el mapa
  onViewOnMap?: () => void;
  // Tap en "Playa más cercana" de la ficha de emisario → verla en el mapa
  onSelectBeach?: (feature: GeoFeature) => void;
};

// Fila de hemeroteca en dos líneas: meta arriba (fecha·fuente·playa,
// gris) y hecho/titular debajo (navy) — jerarquía dentro de la fila.
// `hideBeach`: la playa ya va en la cabecera del grupo (mono-playa);
// `titleOnly`: dentro de un grupo de cobertura el hecho ya lo dice
// la cabecera — la fila enseña el titular propio de cada medio
const NewsSrc = ({
  item,
  hideBeach,
  titleOnly,
  bare,
}: {
  item: FlatNewsItem;
  hideBeach?: boolean;
  titleOnly?: boolean;
  // `bare`: fila hija dentro de una card de cobertura — sin caja
  // propia ni icono (la familia ya la dice la cabecera del grupo)
  bare?: boolean;
}) => {
  const meta = outfallNewsMeta(item, true, !hideBeach, true);
  const icon = FAMILY_ICONS[item.family];
  return (
    <Pressable
      onPress={() => Linking.openURL(item.url)}
      accessibilityRole="link"
      accessibilityLabel={`${item.title}, abrir noticia`}
      style={({ pressed }) => [
        bare ? styles.newsChildRow : styles.newsCard,
        pressed && styles.pressFx,
      ]}
    >
      {!bare && icon ? (
        <Image source={icon} style={styles.newsCardIcon} />
      ) : null}
      <View style={styles.newsRowBody}>
        <Text style={styles.newsRowMain} numberOfLines={bare ? 3 : 2}>
          {titleOnly || bare
            ? item.title
            : TITLE_FIRST_FAMILIES.has(item.family)
              ? (denunciaLead(item) ?? item.title)
              : (item.fact ?? item.title)}
        </Text>
        {meta ? (
          <Text style={styles.newsRowMeta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      <Text style={styles.newsRowChev}>›</Text>
    </Pressable>
  );
};

// En Denuncias la noticia que cuenta es la acción — quién
// investiga, sanciona o denuncia — y esa vive en el titular; el
// fact físico ("vertido de cloruro férrico") la disimula de
// vertido. En el resto de familias el fact ES la noticia
const TITLE_FIRST_FAMILIES = new Set(['Denuncias e investigaciones']);

// Grupo de cobertura relacionada (nivel medio): varias noticias, misma
// playa y mismo hecho a ≤30 días — la cabecera dice el hecho una vez
// ("4 publicaciones · sep–oct 2026") y el despliegue muestra el
// titular propio de cada medio
const NewsCluster = ({
  items,
  hideBeach,
  open,
  onToggle,
}: {
  items: FlatNewsItem[];
  hideBeach?: boolean;
  open: boolean;
  onToggle: () => void;
}) => {
  const head = items[0];
  const icon = FAMILY_ICONS[head.family];
  const span = clusterSpan(items);
  // Medios distintos que cubrieron el suceso — la corroboración
  // independiente ES el dato: "3 medios" pesa más que "5 piezas"
  const outlets = new Set(
    items.map((n) => newsSourceLabel(n.source)).filter(Boolean),
  ).size;
  const meta = [span, `${outlets} ${outlets === 1 ? 'medio' : 'medios'}`]
    .filter(Boolean)
    .join(' · ');
  // El contador ES el titular: "5 publicaciones de vertidos" dice
  // el volumen y el tema en una línea que siempre casa con todas
  // las piezas — nunca depende de que los hechos coincidan
  const headline = `${items.length} publicaciones de ${newsChipLabel(
    head.family,
  ).toLowerCase()}`;
  return (
    // Pila de recortes: dos hojas asoman bajo la card ámbar — la
    // silueta dice "hay varias piezas aquí" antes de leer nada
    <View style={[styles.newsStack, open ? styles.newsStackOpen : null]}>
      {/* La pila de hojas solo existe CERRADA: al desplegar el
          paquete se "desempaqueta" y la metáfora sobra */}
      {!open ? (
        <>
          <View style={[styles.newsStackSheet, styles.newsStackBack2]} />
          <View style={[styles.newsStackSheet, styles.newsStackBack1]} />
        </>
      ) : null}
      <View style={styles.newsClusterCard}>
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityLabel={`${items.length} noticias relacionadas: ${clusterHeadline(
            items,
          )}, ${open ? 'contraer' : 'expandir'}`}
          style={({ pressed }) => [
            styles.newsClusterBand,
            // Cerrada la banda ES la card: redondea también abajo
            !open && styles.newsClusterBandClosed,
            pressed && styles.pressFx,
          ]}
        >
          {/* La ilustración de familia vive aquí a tamaño legible —
              en la barra a 20px era un blob ilegible */}
          {icon ? <Image source={icon} style={styles.newsCardIcon} /> : null}
          <View style={styles.newsRowBody}>
            <Text style={styles.newsRowMain} numberOfLines={2}>
              {headline}
            </Text>
            <Text style={styles.newsRowMeta} numberOfLines={1}>
              {meta}
            </Text>
          </View>
          {/* Un chevron en ambos sitios — la convención móvil
              (iOS/Material): › quieto en fila = navega; › que gira
              90° en la banda = despliega. La rotación ES el toggle */}
          <Text style={[styles.newsRowChev, open && styles.newsBandChevOpen]}>
            ›
          </Text>
        </Pressable>
      </View>
    </View>
  );
};

// Grupo de prensa: chips-filtro por familia ("Todas · Vertidos ·
// Otras…") + lista plana "dd/mm · fuente · «titular»". Un chip
// hace dos trabajos — resumen y filtro; "Otras" pliega las
// familias con 1-2 ítems para que la fila de chips no desborde
const NEWS_SHOWN = 4;
const CHIPS_SHOWN = 3;
const OTRAS = '__otras__';

// Glifo por familia en la barra segmentada — "Todas" y "Otras"
// (fold de varias familias) no llevan icono para no mentir
const FAMILY_ICONS: Record<string, number> = {
  'Roturas y reparaciones': require('../../assets/icons/fam-rotura.png'),
  'Roturas y averías': require('../../assets/icons/fam-rotura.png'),
  Vertidos: require('../../assets/icons/fam-vertido.png'),
  'Denuncias e investigaciones': require('../../assets/icons/fam-denuncia.png'),
  Obstrucciones: require('../../assets/icons/fam-obstruccion.png'),
  'Otros sucesos': require('../../assets/icons/fam-otros.png'),
};

// Lista de hemeroteca como riel temporal: las entradas (grupos de
// cobertura + noticias sueltas) cuelgan de anclas de año con un
// filete a la izquierda — "desde 2024" se ve sin leer una sola
// noticia. "Ver N más" cuenta entradas (grupos + sueltas)
const NewsList = ({
  items,
  hideBeach,
}: {
  items: FlatNewsItem[];
  hideBeach?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const [openIds, setOpenIds] = useState<ReadonlySet<number>>(new Set());
  const toggleCluster = (id: number) =>
    setOpenIds((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  const clusters = clusterNewsCoverage(items);
  const shown = open ? clusters : clusters.slice(0, NEWS_SHOWN);
  const extra = clusters.length - NEWS_SHOWN;
  // Anclas de año: tramos consecutivos del mismo año (la lista ya
  // viene ordenada de reciente a antigua)
  const yearGroups: { year: string | null; entries: NewsClusterT[] }[] = [];
  for (const c of shown) {
    const y = c.items[0].published_at?.slice(0, 4) ?? null;
    const last = yearGroups[yearGroups.length - 1];
    if (last && last.year === y) last.entries.push(c);
    else yearGroups.push({ year: y, entries: [c] });
  }
  if (!clusters.length)
    return <Text style={styles.newsEmpty}>Sin noticias con este filtro</Text>;
  return (
    <View>
      {yearGroups.map((g, gi) => (
        <View key={`y${g.year ?? 'sf'}${gi}`}>
          {g.year ? (
            <View style={styles.newsYearRow}>
              <Text style={styles.newsYearText}>{g.year}</Text>
              <View style={styles.newsYearLine} />
            </View>
          ) : null}
          <View>
            {g.entries.map((c, i) => {
              const isCluster = c.items.length > 1;
              const isOpen = openIds.has(c.items[0].id);
              const lastEntry =
                gi === yearGroups.length - 1 && i === g.entries.length - 1;
              // La cabecera solo es "última" si la pila está cerrada;
              // abierta, la última fila del riel es su última hija
              const headIsLast = lastEntry && !isOpen;
              return (
                <View key={`e${c.items[0].id}`}>
                  <View style={styles.newsTlItem}>
                    {/* Riel tipo timeline: dot por fila + línea que
                        enlaza con la siguiente + tick hasta la card.
                        Cabecera de pila = dot ámbar; suelta o hija =
                        dot gris — jerarquía antes de leer */}
                    <View style={styles.newsTlRail}>
                      {/* Línea arriba + línea abajo en flex:1 → el dot
                          queda centrado en su fila sea cual sea la
                          altura de la card */}
                      {gi === 0 && i === 0 ? (
                        <View style={styles.newsTlGap} />
                      ) : (
                        <View style={styles.newsTlLine} />
                      )}
                      <View
                        style={[
                          styles.newsTlDot,
                          isCluster && styles.newsTlDotCluster,
                        ]}
                      />
                      {!headIsLast ? (
                        <View style={styles.newsTlLine} />
                      ) : (
                        <View style={styles.newsTlGap} />
                      )}
                      <View style={styles.newsTlTick} />
                    </View>
                    <View style={styles.newsTlCard}>
                      {isCluster ? (
                        <NewsCluster
                          items={c.items}
                          hideBeach={hideBeach}
                          open={isOpen}
                          onToggle={() => toggleCluster(c.items[0].id)}
                        />
                      ) : (
                        <NewsSrc item={c.items[0]} hideBeach={hideBeach} />
                      )}
                    </View>
                  </View>
                  {isCluster && isOpen ? (
                    <View style={styles.newsChildBlock}>
                      {c.items.map((n, ci) => {
                        const childIsLast =
                          lastEntry && ci === c.items.length - 1;
                        return (
                          <View key={`c${n.id}`} style={styles.newsTlItem}>
                            <View style={styles.newsTlRail}>
                              <View style={styles.newsTlLine} />
                              <View style={styles.newsTlDot} />
                              {!childIsLast ? (
                                <View style={styles.newsTlLine} />
                              ) : (
                                <View style={styles.newsTlGap} />
                              )}
                              <View
                                style={[
                                  styles.newsTlTick,
                                  styles.newsTlTickLong,
                                ]}
                              />
                            </View>
                            <View
                              style={[
                                styles.newsTlCard,
                                styles.newsTlCardIndent,
                              ]}
                            >
                              <NewsSrc
                                item={n}
                                hideBeach={hideBeach}
                                titleOnly
                                bare
                              />
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      ))}
      {extra > 0 ? (
        <Pressable
          onPress={() => setOpen(!open)}
          accessibilityRole="button"
          accessibilityLabel={open ? 'Ver menos' : `Ver ${extra} más`}
        >
          <Text style={styles.newsMore}>
            {open ? 'Ver menos' : `Ver ${extra} más`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};

// Tablero de prensa: UN juego de filtros (familia + año) para los
// dos ámbitos — "En la zona" hereda el filtro del grupo principal
// en vez de duplicar todo el chrome
const PressBoard = ({
  namedItems,
  zoneItems,
  namedBeach,
  zoneBeach,
}: {
  namedItems: FlatNewsItem[];
  zoneItems: FlatNewsItem[];
  namedBeach: string | null;
  zoneBeach: string | null;
}) => {
  // Los chips agregan los dos ámbitos: el filtro gobierna toda la
  // sección, así que los contadores cuentan toda la sección
  const base = [...namedItems, ...zoneItems];
  // Segunda faceta: años presentes, recientes primero — fila aparte
  // y más discreta (familias = qué, años = cuándo)
  const years = [
    ...new Set(
      base
        .map((n) => n.published_at?.slice(0, 4))
        .filter((y): y is string => !!y),
    ),
  ].sort((a, b) => b.localeCompare(a));
  const [sel, setSel] = useState<string | null>(null);
  // El año más reciente viene filtrado por defecto — la hemeroteca
  // se lee "qué ha pasado últimamente" y el resto es un toque más
  const [selYear, setSelYear] = useState<string | null>(() =>
    years.length > 1 ? years[0] : null,
  );
  const inYear = (list: FlatNewsItem[]) =>
    selYear === null
      ? list
      : list.filter((n) => n.published_at?.startsWith(selYear));
  // Los contadores responden al año elegido: se agregan sobre los
  // ítems del año seleccionado, no sobre toda la hemeroteca
  const yearItems = inYear(base);
  const yearFam = new Map<string, number>();
  for (const n of yearItems)
    yearFam.set(n.family, (yearFam.get(n.family) ?? 0) + 1);
  const yearChips = [...yearFam.entries()]
    .map(([family, count]) => ({ family, count }))
    .sort((a, b) => b.count - a.count);
  // Con más de CHIPS_SHOWN familias, la cola se pliega en "Otras" —
  // el fold atrapa cualquier familia fuera del top, en ambos ámbitos
  const top =
    yearChips.length > CHIPS_SHOWN + 1
      ? yearChips.slice(0, CHIPS_SHOWN)
      : yearChips;
  const rest = yearChips.slice(top.length);
  const topFams = new Set(top.map((c) => c.family));
  const restNames = new Set(
    [...namedItems, ...zoneItems]
      .map((n) => n.family)
      .filter((f) => !topFams.has(f)),
  );
  const restCount = rest.reduce((s, c) => s + c.count, 0);
  const applyFilter = (list: FlatNewsItem[]) =>
    inYear(list).filter(
      (n) =>
        sel === null ||
        (sel === OTRAS ? restNames.has(n.family) : n.family === sel),
    );
  const pick = (f: string | null) => setSel(sel === f ? null : f);
  // Barra segmentada en vez de píldoras: las píldoras suman ~16px
  // de padding por chip y no caben en una línea — los segmentos de
  // texto con separador fino sí, y el activo lleva subrayado
  const allChips: { key: string | null; label: string; full: string }[] = [
    {
      key: null,
      label: `Todas (${yearItems.length})`,
      full: `Todas, ${yearItems.length} noticias`,
    },
    ...top.map((c) => ({
      key: c.family as string | null,
      label: `${newsChipLabel(c.family)} (${c.count})`,
      full: `${c.family}, ${c.count} noticias`,
    })),
    ...(rest.length
      ? [
          {
            key: OTRAS as string | null,
            label: `Otras (${restCount})`,
            full: `Otras, ${restCount} noticias`,
          },
        ]
      : []),
  ];
  return (
    <View>
      {/* La barra hace scroll horizontal en vez de romper a una
          segunda línea coja cuando las familias no caben — el fade
          y la flecha › de ScrollChips anuncian que hay más */}
      <ScrollChips
        a11yLabel="familias de noticias"
        contentContainerStyle={styles.newsSegs}
        arrowColor="rgba(7,82,118,0.55)"
        arrowSize={20}
      >
        {allChips.map((c, i) => (
          <View key={c.key ?? '__all__'} style={styles.newsSegItem}>
            {i > 0 ? <View style={styles.newsSegDiv} /> : null}
            <Pressable
              onPress={() => pick(c.key)}
              accessibilityRole="button"
              accessibilityLabel={c.full}
              style={({ pressed }) => [
                styles.newsSeg,
                sel === c.key && styles.newsSegOn,
                pressed && styles.pressFx,
              ]}
            >
              <Text
                style={[
                  styles.newsSegText,
                  sel === c.key && styles.newsSegTextOn,
                ]}
              >
                {c.label}
              </Text>
            </Pressable>
          </View>
        ))}
      </ScrollChips>
      {/* Fila de años: faceta secundaria — chips con borde, sin
          relleno, para no competir con las familias */}
      {years.length > 1 ? (
        <View style={styles.newsChips}>
          {years.map((y) => (
            <Pressable
              key={y}
              onPress={() => {
                // Cambiar de año resetea la familia: si no, el filtro
                // activo podría no tener chip visible en el nuevo año
                setSelYear(selYear === y ? null : y);
                setSel(null);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Año ${y}`}
              style={({ pressed }) => [
                styles.newsChip,
                styles.newsChipYear,
                selYear === y && styles.newsChipYearOn,
                pressed && styles.pressFx,
              ]}
            >
              <Text
                style={[
                  styles.newsChipText,
                  styles.newsChipYearText,
                  selYear === y && styles.newsChipYearTextOn,
                ]}
              >
                {y}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {namedItems.length ? (
        <View>
          <Text style={styles.newsGroup}>{OUTFALL_NEWS_NAMED}</Text>
          {/* Síntesis: volumen + episodios + playa si el grupo es
              mono-playa — "16 noticias · 5 episodios desde 2024 ·
              Playa Jardín" cuenta el abandono sin leer ni una */}
          <Text style={styles.newsGroupSub}>
            {newsCoverageSynthesis(namedItems, namedBeach)}
          </Text>
          {/* La key remonta la lista al cambiar de filtro → el
              "Ver más" desplegado vuelve a su estado plegado */}
          <NewsList
            key={`n-${sel ?? '_'}-${selYear ?? '_'}`}
            items={applyFilter(namedItems)}
            hideBeach={!!namedBeach}
          />
        </View>
      ) : null}
      {zoneItems.length ? (
        <View>
          <Text style={styles.newsGroup}>{OUTFALL_NEWS_ZONE}</Text>
          <Text style={styles.newsGroupSub}>
            {newsCoverageSynthesis(zoneItems, zoneBeach)}
          </Text>
          <NewsList
            key={`z-${sel ?? '_'}-${selYear ?? '_'}`}
            items={applyFilter(zoneItems)}
            hideBeach={!!zoneBeach}
          />
        </View>
      ) : null}
    </View>
  );
};

// Pin de ubicación desnudo (gota con agujero) dibujado con Views —
// el asset más cercano llevaba sombrilla y quedaba frito a 22 px
const LocPin = ({ color }: { color: string }) => (
  <View style={styles.locPinWrap}>
    <View style={[styles.locPinDrop, { borderColor: color }]}>
      <View style={[styles.locPinHole, { backgroundColor: color }]} />
    </View>
  </View>
);

// Dot con pulso real para el riesgo: el halo crece y se desvanece
// en bucle — el "pin pulsado" del mapa trasladado al triaje
// Ritmo del pulso por nivel: riesgo bajo late relajado, el alto
// va a latido rápido — micro-storytelling sin ruido
const PULSE_MS: Record<string, number> = {
  bajo: 2600,
  medio: 1500,
  alto: 900,
};

const PulseDot = ({ color, level }: { color: string; level: string }) => {
  const pulse = useRef(new Animated.Value(0)).current;
  const duration = PULSE_MS[level] ?? 1500;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration,
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [pulse, duration]);
  return (
    <View style={styles.triagePulse}>
      <Animated.View
        style={[
          styles.triagePulseHalo,
          {
            backgroundColor: color,
            transform: [
              {
                scale: pulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.4, 1],
                }),
              },
            ],
            opacity: pulse.interpolate({
              inputRange: [0, 0.6, 1],
              outputRange: [0.55, 0.25, 0],
            }),
          },
        ]}
      />
      <View style={[styles.triagePulseCore, { backgroundColor: color }]} />
    </View>
  );
};

// Cuerpo de la ficha de EMISARIO: vista satélite, legalidad,
// funcionamiento, espacio protegido, qué se vierte, dónde y cómo,
// playas cercanas y enlace al censo oficial
export default function OutfallSheet({
  feature,
  outfalls,
  beaches,
  onViewOnMap,
  onSelectBeach,
}: OutfallSheetProps) {
  const p = feature.properties;
  const statusKey = p.status ?? 'unknown';
  const legColor = colors.outfall[statusKey] ?? colors.status.unknown;
  const functioning = operationShort(p.is_active, p.continuity);
  // La frase de funcionamiento solo va a la caja cuando añade algo
  // que la celda del triaje no dice (desbordes, parada, solo régimen)
  const opDetail = operationDetail(p.is_active, p.continuity);
  const risk = outfallRisk(p);
  const parts = p.nature
    ? natureParts(p.nature, p.origin, p.outfall_depth, p.zone_desc)
    : [];
  // Tiles = la frase de vertido repartida en tres líneas: el verbo
  // arriba, la cifra en medio, la medida abajo — "vierte a / 498 m
  // / de la orilla · y a / 24 m / de profundidad · mide / 649 m /
  // de longitud". Sin lead suelto: el contexto va en cada tile
  const kpi = kpiSegs(p.kind, p.shore_m, p.outfall_depth);
  const tiles: { lead: string; v: string; l: string }[] = (
    kpi?.tiles ?? []
  ).map((t) => ({
    lead: 'vierte a',
    v: t.v,
    l: t.l,
  }));
  // Longitud como tercer tile con su propio verbo: es dato de la
  // tubería, no del punto de vertido
  if (p.length_m != null)
    tiles.push({
      lead: 'mide',
      v:
        p.length_m >= 1000
          ? `${(p.length_m / 1000).toFixed(1)} km`
          : `${Math.round(p.length_m)} m`,
      l: 'de longitud',
    });
  // Con tiles la frase de conducción se reduce al tipo ("Emisario
  // submarino" en su fila); sin ningún número la frase conserva
  // el matiz que los tiles no pueden contar
  const conduit = tiles.length
    ? null
    : conduitSegs(p.kind, p.shore_m, p.length_m, p.outfall_depth);
  const conduitRow = conduit
    ? conduit
        .map((s) => s.t)
        .join('')
        .replace(/\.$/, '')
    : p.kind
      ? p.kind[0].toUpperCase() + p.kind.slice(1)
      : null;

  // La descripción del censo queda como lead narrativo en gris —
  // es prosa (no un dato atómico) y disfrazarla de fila solo la
  // hacía más larga. Las filas son datos escaneables: ubicación,
  // conducción, responsable — etiqueta extrabold, sin iconos
  const zoneLine = p.zone_desc ? zoneText(p.zone_desc) : null;
  const whereExtra = [p.location, p.settlement, p.municipality]
    .filter((v): v is string => !!v)
    .filter(
      (v) => !zoneLine || !zoneLine.toLowerCase().includes(v.toLowerCase()),
    )
    .filter((v, i, a) => a.indexOf(v) === i);
  const whereRows: {
    label: string;
    value: string;
    icon: React.ReactNode;
    color?: string;
  }[] = [
    ...(whereExtra.length
      ? [
          {
            label: 'Ubicación',
            value: whereExtra.join(', '),
            icon: <LocPin color={colors.primaryDark} />,
          },
        ]
      : []),
    ...(conduitRow
      ? [
          {
            label: 'Conducción',
            value: conduitRow,
            icon: (
              <Image
                source={require('../../assets/icons/icon-waves2.png')}
                style={[styles.whereRowImg, { tintColor: colors.primaryDark }]}
              />
            ),
          },
        ]
      : []),
    // Estado físico pegado a su fila madre: Conducción y su
    // condición describen el mismo objeto y se leen en bloque —
    // si es "malo" el ⚠️ avisa sin necesidad de otra alerta
    ...(p.condition
      ? [
          {
            label: 'Estado de la conducción',
            value:
              p.condition[0].toUpperCase() + p.condition.slice(1).toLowerCase(),
            // Icono dibujado, no emoji: el triángulo/check se
            // posiciona al pixel con la línea base del texto
            icon: (
              <Image
                source={
                  p.condition === 'Bueno'
                    ? require('../../assets/icons/icon-ok.png')
                    : require('../../assets/icons/icon-warn.png')
                }
                style={styles.whereRowImg}
              />
            ),
            color: CONDITION_COLORS[p.condition] ?? colors.text,
          },
        ]
      : []),
    // El responsable se mueve aquí desde "Qué se vierte": con la
    // gramática de filas es un dato administrativo más de la
    // instalación — qué+quién cede el sitio a instalación+quién
    ...(p.entity || p.manager
      ? [
          {
            label: 'Responsable',
            value: smartTitle(p.entity ?? p.manager ?? ''),
            // El townhall ya se dibujo en navy: sin tintColor se
            // conservan las columnas (tintarlo lo aplana a bloque)
            icon: (
              <Image
                source={require('../../assets/icons/icon-townhall.png')}
                style={styles.whereRowImgBig}
              />
            ),
          },
        ]
      : []),
  ];

  // Playas en un radio de 1.5 km del vertido (proximidad geométrica,
  // no implica vínculo oficial con ningún cierre)
  const [nearby, setNearby] = useState<OutfallNearbyBeach[]>([]);
  const [news, setNews] = useState<OutfallNewsResponse | null>(null);
  const [prevFeatureId, setPrevFeatureId] = useState(feature.id);
  if (prevFeatureId !== feature.id) {
    setPrevFeatureId(feature.id);
    setNearby([]);
    setNews(null);
  }
  useEffect(() => {
    let cancelled = false;
    fetchOutfallNearbyBeaches(feature.id)
      .then((list) => !cancelled && setNearby(nearbyUniqueBeaches(list)))
      .catch(() => !cancelled && setNearby([]));
    // Sin noticias de infra la sección no se renderiza: un fetch
    // fallido equivale a "sin sección", nunca a caja vacía
    fetchOutfallNews(feature.id)
      .then((res) => !cancelled && setNews(res))
      .catch(() => !cancelled && setNews(null));
    return () => {
      cancelled = true;
    };
  }, [feature.id]);

  // Listas planas por ámbito para la síntesis de cabecera (volumen,
  // episodios, playa si el grupo es mono-playa)
  const namedItems = useMemo(
    () => (news ? flattenNewsGroups(news.named_groups) : []),
    [news],
  );
  const zoneItems = useMemo(
    () => (news ? flattenNewsGroups(news.zone_groups) : []),
    [news],
  );
  const namedBeach = singleNewsBeach(namedItems);
  const zoneBeach = singleNewsBeach(zoneItems);

  // Marcadores de la foto satélite del emisario: otros vertidos y las
  // playas del entorno proyectados al encuadre (el propio emisario es
  // el dot central)
  const shotMarkers = useMemo(() => {
    const others = (outfalls ?? [])
      .filter((o) => o.id !== feature.id)
      .map((o) => {
        const s = o.properties.status ?? 'unknown';
        return {
          id: `o${o.id}`,
          coords: o.geometry.coordinates as [number, number],
          color:
            colors.outfall[s as keyof typeof colors.outfall] ??
            colors.status.unknown,
          icon: require('../../assets/icons/icon-faucet-sil.png'),
        };
      });
    const beachMarks = (beaches ?? []).map((b) => {
      const k = beachStatusKey(b);
      return {
        id: `b${b.id}`,
        coords: b.geometry.coordinates as [number, number],
        color: colors.status[k],
        icon: require('../../assets/icons/beach_sil.png'),
      };
    });
    return [...beachMarks, ...others];
  }, [outfalls, beaches, feature.id]);

  return (
    <View>
      {/* Vista satélite del entorno: el emisario en el centro,
          otros vertidos y playas alrededor. Clicable → mapa */}
      <SatelliteShot
        center={feature.geometry.coordinates as [number, number]}
        centerColor={colors.outfall[statusKey] ?? colors.status.unknown}
        centerIcon={require('../../assets/icons/icon-faucet-sil.png')}
        markers={shotMarkers}
        line={
          p.start_lon != null && p.start_lat != null
            ? {
                from: [p.start_lon, p.start_lat],
                color: colors.primary,
              }
            : undefined
        }
        onPress={onViewOnMap}
        startLevel={1}
        biasTo={
          p.start_lon != null && p.start_lat != null
            ? [p.start_lon, p.start_lat]
            : undefined
        }
        bias={0.25}
      />
      {/* Triaje de una mirada: las tres preguntas del bañista
          (¿es legal? ¿vierte? ¿me importa?) en tres celdas. La
          prosa queda para la caja de debajo, que explica el riesgo */}
      {/* La fila entera es el veredicto: borde + fondo suave del
          color de legalidad (verde/ámbar/rojo del mapa) */}
      <View
        style={[
          styles.triageRow,
          {
            borderColor: `${legColor}66`,
            backgroundColor: `${legColor}0d`,
          },
        ]}
      >
        <View style={styles.triageCell}>
          {/* No autorizado → el sello "ILEGAL" ES el valor (decir
              además "No autorizado" duplicaba). Los demás estados
              van con badge ✓/? + texto */}
          <Text style={styles.triageLabel}>Estado legal</Text>
          {statusKey === 'illegal' ? (
            <>
              {/* Signo de prohibido dibujado: grifo oscuro dentro
                  del anillo rojo con barra diagonal — "vertido sin
                  permiso" en una sola pieza */}
              <View style={styles.triageProhibit}>
                <Image
                  source={require('../../assets/icons/icon-faucet.png')}
                  style={[
                    styles.triageProhibitTap,
                    { tintColor: colors.primaryDark },
                  ]}
                />
                <View
                  style={[
                    styles.triageProhibitRing,
                    { borderColor: colors.outfall.illegal },
                  ]}
                />
                <View
                  style={[
                    styles.triageProhibitSlash,
                    { backgroundColor: colors.outfall.illegal },
                  ]}
                />
              </View>
              <View style={styles.triageStamp}>
                <Text style={styles.triageStampText}>ILEGAL</Text>
              </View>
            </>
          ) : (
            <>
              {statusKey === 'legal' ? (
                <View
                  style={[styles.triageBadge, { backgroundColor: legColor }]}
                >
                  <Text style={styles.triageBadgeGlyph}>✓</Text>
                </View>
              ) : (
                /* En trámite → icono propio (reloj de arena +
                   expediente): la máscara circular recorta las
                   esquinas grises del PNG */
                <View style={styles.triageIconClip}>
                  <Image
                    source={require('../../assets/icons/icon-tramite.png')}
                    style={styles.triageIconClipImg}
                    resizeMode="cover"
                  />
                </View>
              )}
              <Text style={[styles.triageValue, { color: legColor }]}>
                {OUTFALL_STATUS_LABELS[statusKey] ?? 'Sin datos'}
              </Text>
            </>
          )}
        </View>
        <View style={styles.triageDivider} />
        {/* La celda del medio lleva los textos más largos
            ("FUNCIONAMIENTO", "Vierte a diario"): flex mayor para
            que los divisores no la ahoguen */}
        <View style={[styles.triageCell, { flex: 1.35 }]}>
          <Text style={styles.triageLabel}>Funcionamiento</Text>
          {/* Olas: el mismo glifo que la fila Conducción — el agua
              cayendo al mar, no el grifo (ese ya es "qué se vierte") */}
          <Image
            source={require('../../assets/icons/icon-waves2.png')}
            style={[styles.triageIcon, { tintColor: colors.primaryDark }]}
          />
          <Text
            style={[
              styles.triageValue,
              functioning === 'Sin datos' && { color: colors.textFaint },
            ]}
          >
            {functioning}
          </Text>
        </View>
        <View style={styles.triageDivider} />
        <View style={styles.triageCell}>
          <Text style={styles.triageLabel}>Riesgo</Text>
          <PulseDot color={RISK_COLORS[risk.level]} level={risk.level} />
          <Text
            style={[styles.triageValue, { color: RISK_COLORS[risk.level] }]}
          >
            {risk.level[0].toUpperCase() + risk.level.slice(1)}
          </Text>
        </View>
      </View>
      {/* Auditoría del veredicto: el score se calcula, así que la
          ficha dice POR QUÉ — caption muted, veredicto→evidencia */}
      {/* Matiz operativo: la única pieza que la ficha no dice en
          ningún otro sitio (paradas, desbordes, régimen sin estado).
          Frase suelta sin caja — apoya al triaje, no compite */}
      {opDetail ? <Text style={styles.opLine}>{opDetail}</Text> : null}

      {/* ZEC justo tras el funcionamiento: que vierta en zona
          protegida es contexto de máxima prioridad */}
      {p.protected_area ? (
        <View style={styles.protectedBox}>
          <Text style={styles.protectedTitle}>
            🛡 Emisario en espacio protegido
          </Text>
          <Text style={styles.protectedName}>
            Está dentro de la {protectedAreaName(p.protected_area)}, una{' '}
            <Text style={styles.protectedStrong}>
              Zona Especial de Conservación
            </Text>{' '}
            de la red Natura 2000{protectedAreaNote(p.protected_area)}.
          </Text>
        </View>
      ) : null}
      {/* El vertido: la respuesta protagonista — qué cae al mar y de
          dónde viene. Es la pregunta que abre la ficha */}
      {p.nature ? (
        <View style={styles.heroBox}>
          <View style={styles.heroText}>
            {p.nature ? (
              <>
                <View style={styles.secHead}>
                  <Image
                    source={require('../../assets/icons/icon-faucet.png')}
                    style={[styles.secIcon, { tintColor: colors.primaryDark }]}
                  />
                  <Text style={styles.secCardTitle}>Qué se vierte</Text>
                </View>
                {parts.length === 1 ? (
                  // Una sola sustancia → lead comunicativo
                  // "Depuradora: vierte agua residual urbana" —
                  // instalación y tipo de agua en negrita, sin
                  // titular gigante ni origen repetido
                  <>
                    <Text style={styles.heroLead}>
                      <Text style={styles.heroLeadStrong}>
                        {p.origin ? originLabel(p.origin) : parts[0].label}
                      </Text>
                      : vierte{' '}
                      <Text style={styles.heroLeadStrong}>
                        {p.nature.toLowerCase()}
                        {parts[0].desc ? ` (${parts[0].desc})` : ''}
                      </Text>
                    </Text>
                    {parts[0].note ? (
                      <Text style={styles.heroNote}>
                        {parts[0].note[0].toUpperCase() +
                          parts[0].note.slice(1)}
                      </Text>
                    ) : null}
                    {parts[0].verdict ? (
                      <Text
                        style={[
                          styles.heroVerdict,
                          {
                            color: parts[0].verdictBad
                              ? colors.status.closed
                              : colors.status.open,
                          },
                        ]}
                      >
                        {parts[0].verdict}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  // Varias sustancias → naturaleza + desglose por
                  // líneas con su nota de impacto
                  <>
                    <Text style={styles.heroValue}>{p.nature}</Text>
                    {p.origin ? (
                      <Text style={styles.heroSub}>
                        {originLabel(p.origin)}
                      </Text>
                    ) : null}
                    {parts.map((pt, i) => {
                      // Si la etiqueta repite el subtítulo ("Desaladora"
                      // bajo "Desaladora") no se pinta: queda solo la
                      // frase explicativa
                      const dup =
                        !!p.origin &&
                        pt.label.toLowerCase() ===
                          originLabel(p.origin).toLowerCase();
                      const desc = pt.desc
                        ? dup
                          ? pt.desc[0].toUpperCase() + pt.desc.slice(1)
                          : pt.desc
                        : null;
                      return (
                        <Text key={i} style={styles.heroNote}>
                          {dup ? null : (
                            <Text style={styles.heroRespStrong}>
                              {pt.label[0].toUpperCase() + pt.label.slice(1)}
                              {pt.colon ? ':' : ''}
                            </Text>
                          )}
                          {desc ? (
                            <Text style={styles.heroRespStrong}>
                              {dup ? desc : ` ${desc}`}
                            </Text>
                          ) : null}
                          {pt.note
                            ? dup && !desc
                              ? pt.note[0].toUpperCase() + pt.note.slice(1)
                              : pt.colon
                                ? ` ${pt.note}`
                                : ` — ${pt.note}`
                            : null}
                          {pt.verdict ? (
                            <Text
                              style={{
                                fontFamily: fonts.extrabold,
                                color: pt.verdictBad
                                  ? colors.status.closed
                                  : colors.status.open,
                              }}
                            >
                              {` ${pt.verdict}`}
                            </Text>
                          ) : null}
                        </Text>
                      );
                    })}
                  </>
                )}
              </>
            ) : null}
          </View>
        </View>
      ) : null}
      {/* Dónde + conducción como ficha técnica: lead narrativo del
          censo, filas etiqueta+dato para lo administrativo y tiles
          solo para los números — el estado cierra como fila, no
          como tile rojo que competía con el dot de riesgo */}
      {zoneLine || whereRows.length || tiles.length || p.condition ? (
        <View style={styles.secCard}>
          <View style={styles.secHead}>
            <Image
              source={require('../../assets/icons/icon-map-sil.png')}
              style={[styles.secIcon, { tintColor: colors.primaryDark }]}
            />
            <Text style={styles.secCardTitle}>Dónde y cómo</Text>
          </View>
          {zoneLine ? <Text style={styles.whereLead}>{zoneLine}</Text> : null}
          {whereRows.map((r) => (
            <View key={r.label} style={styles.whereRow}>
              <View style={styles.whereRowIcon}>{r.icon}</View>
              <Text style={styles.whereRowText}>
                <Text style={styles.whereRowLabel}>{r.label}: </Text>
                {r.color ? (
                  <Text style={{ fontFamily: fonts.extrabold, color: r.color }}>
                    {r.value}
                  </Text>
                ) : (
                  r.value
                )}
              </Text>
            </View>
          ))}
          {tiles.length ? (
            <View style={styles.kpiTiles}>
              {tiles.map((t) => (
                <View key={t.l} style={styles.kpiTile}>
                  <Text style={styles.kpiLabel}>{t.lead}</Text>
                  <Text style={styles.kpiValue}>{t.v}</Text>
                  <Text style={styles.kpiLabel}>{t.l}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      {/* Playas cercanas como card: es la respuesta a "¿dónde me
          afecta?" — las filas abren la playa en el mapa */}
      {nearby.length > 0 ? (
        <View style={styles.secCard}>
          <View style={styles.secHead}>
            {/* Pin de ubicación desnudo en el color del título —
                el mismo vocabulario que la web /o/{id} */}
            <LocPin color={colors.primaryDark} />
            <Text style={styles.secCardTitle}>Playas cercanas</Text>
          </View>
          <View style={styles.nearestList}>
            {nearby.map((n, i) => {
              const beachTarget = (beaches ?? []).find(
                (b) => b.id === n.beach_id,
              );
              return (
                <Pressable
                  key={n.beach_id}
                  style={({ pressed }) => [
                    styles.nearestBox,
                    i < nearby.length - 1 && styles.nearestBoxSep,
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
                  {/* Foto satélite de la playa: reconocer el arenal de
                    un vistazo vende mejor que el nombre — solo cuando
                    el punto está cargado (da las coords del bbox) */}
                  {beachTarget ? (
                    <Image
                      source={{
                        uri: thumbUrl(
                          beachTarget.geometry.coordinates as [number, number],
                        ),
                      }}
                      style={styles.nearestThumb}
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                  ) : null}
                  <View style={styles.nearestBody}>
                    <Text style={styles.nearestName} numberOfLines={1}>
                      {displayBeachName(beachBaseName(n.beach_name))}
                    </Text>
                    {n.municipality ? (
                      <Text style={styles.nearestMeta} numberOfLines={1}>
                        {n.municipality}
                      </Text>
                    ) : null}
                  </View>
                  {/* Distancia en píldora de contorno, tinta neutra.
                    Solo <500 m se enciende (relleno rojo suave +
                    número rojo): en campo cercano la dilución aún
                    no ha hecho su trabajo — "pegada" es un umbral
                    honesto, no un semáforo de precisión inventada */}
                  <View
                    style={[
                      styles.nearestPill,
                      n.distance_m < 500 && {
                        borderColor: 'transparent',
                        backgroundColor: `${colors.outfall.illegal}1f`,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.nearestPillText,
                        n.distance_m < 500 && {
                          color: colors.outfall.illegal,
                        },
                      ]}
                    >
                      {fmtDistance(n.distance_m)}
                    </Text>
                  </View>
                  {beachTarget && onSelectBeach && (
                    <Text style={styles.nearestChevron}>›</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Prensa de infraestructura de vertido (Hito 11.2): roturas,
          vertidos y reparaciones del punto y de su zona — "según
          prensa", la proximidad nunca implica causalidad */}
      {news?.named_groups.length || news?.zone_groups.length ? (
        <View style={styles.secCard}>
          <View style={styles.secHead}>
            <Image
              source={require('../../assets/icons/icon-episodes.png')}
              style={[styles.secIcon, { tintColor: colors.primaryDark }]}
            />
            <Text style={styles.secCardTitle}>{OUTFALL_NEWS_TITLE}</Text>
          </View>
          <PressBoard
            namedItems={namedItems}
            zoneItems={zoneItems}
            namedBeach={namedBeach}
            zoneBeach={zoneBeach}
          />
        </View>
      ) : null}

      {/* (La card de episodios del entorno se retiró: era un espejo
          del contador de cada playa y su total invitaba a leer
          causalidad. El endpoint sigue sirviendo el dato en
          `episodes` para quien lo quiera.) */}

      {/* Fuente oficial como pie discreto — la tabla cruda se fue:
          cada dato relevante ya está narrado en las cards y el resto
          no le dice nada al bañista. Queda el enlace por
          transparencia + la nota epistémica del riesgo */}
      <View style={styles.censusSrcWrap}>
        {p.source_url ? (
          <Pressable
            onPress={() => p.source_url && Linking.openURL(p.source_url)}
            accessibilityRole="link"
            accessibilityLabel="Abrir el censo oficial de vertidos"
            style={({ pressed }) => pressed && styles.pressFx}
          >
            <Text style={styles.censusSrc}>
              Fuente: Censo Vertidos Tierra-Mar 2025 ↗
            </Text>
          </Pressable>
        ) : null}
        <Text style={styles.censusFoot}>
          Según prensa: la proximidad no implica causalidad · El riesgo es una
          estimación del censo
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Feedback táctil común: leve fundido al presionar
  pressFx: {
    opacity: 0.6,
  },
  // Strip de triaje: tres celdas (legalidad, funcionamiento,
  // riesgo) separadas por filetes — el resumen antes de la prosa
  triageRow: {
    marginTop: 8,
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingVertical: 8,
  },
  triageCell: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  // Slot de icono unificado a 26 px en las tres celdas — si no,
  // el valor de debajo arranca a distinta altura por celda
  triageIcon: {
    width: 26,
    height: 26,
    resizeMode: 'contain',
    marginTop: 5,
  },
  // Badge de estado legal: círculo del color del censo con glifo
  // blanco (✓ autorizado, ? en trámite). El "no autorizado" no usa
  // badge: el sello estampado YA dice el estado
  triageBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 5,
  },
  triageBadgeGlyph: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: '#fff',
    lineHeight: 16,
  },
  // Icono del "en trámite": el PNG circular se muestra ~117%
  // dentro de una máscara de 26 px — el borde rojo del icono
  // queda en el filo y las esquinas grises se recortan solas
  triageIconClip: {
    width: 26,
    height: 26,
    borderRadius: 13,
    overflow: 'hidden',
    marginTop: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  triageIconClipImg: {
    width: '117%',
    height: '117%',
  },
  // Signo de prohibido para el "no autorizado": anillo + barra
  // diagonal rojos sobre el grifo — dibujado, sin asset nuevo
  triageProhibit: {
    width: 24,
    height: 24,
    marginTop: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  triageProhibitTap: {
    width: 14,
    height: 14,
    resizeMode: 'contain',
  },
  triageProhibitRing: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2.5,
  },
  triageProhibitSlash: {
    position: 'absolute',
    width: 25,
    height: 2.5,
    borderRadius: 2,
    transform: [{ rotate: '-45deg' }],
  },
  // Sello "ILEGAL" como valor protagonista: caja con borde, look
  // de estampado administrativo. Su texto arranca ~3.5px dentro
  // de la caja (borde + padding): los valores de las otras celdas
  // bajan a su línea (ver triageValue), no al revés
  triageStamp: {
    borderWidth: 1.5,
    borderColor: colors.outfall.illegal,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 8,
  },
  triageStampText: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: colors.outfall.illegal,
    letterSpacing: 0.8,
  },
  // "Pin pulsado" para el riesgo: halo animado + núcleo sólido
  triagePulse: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 5,
  },
  triagePulseHalo: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  triagePulseCore: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  triageLabel: {
    fontSize: 9,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  // marginTop amplio: alinea el texto con el interior del sello
  // ILEGAL (3 de margen + ~3.5 de borde/padding) — el aire bajo
  // el icono es el mismo en las tres celdas
  triageValue: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.text,
    marginTop: 7,
    textAlign: 'center',
  },
  triageDivider: {
    width: 1,
    backgroundColor: colors.border,
    marginVertical: 2,
  },
  // Matiz operativo bajo el triaje: frase apagada sin caja — el dato
  // ("no opera ahora mismo") apoya, no necesita contenedor
  opLine: {
    fontSize: 12.5,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 17,
    marginTop: 8,
    marginBottom: 4,
  },
  // "Dónde y cómo": la descripción del censo como lead narrativo
  // en gris (contexto, no dato), y debajo filas etiqueta+dato —
  // ficha técnica sobria, sin iconos de pegatina
  whereLead: {
    fontSize: 13.5,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    lineHeight: 19,
    marginTop: 4,
  },
  whereRow: {
    flexDirection: 'row',
    marginTop: 6,
    gap: 7,
  },
  // Columna fija de icono (22 px, la caja del LocPin): todos los
  // textos arrancan en el mismo punto aunque una fila no tenga
  // icono todavía (conducción pendiente de su tubería)
  whereRowIcon: {
    width: 22,
    alignItems: 'center',
    marginTop: -1,
  },
  whereRowImg: {
    width: 16,
    height: 16,
    marginTop: 2,
  },
  whereRowImgBig: {
    width: 18,
    height: 18,
    marginTop: 1,
  },
  whereRowText: {
    flex: 1,
    fontSize: 13.5,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 19,
  },
  whereRowLabel: {
    fontFamily: fonts.extrabold,
  },
  // Tiles numéricos del punto de vertido (orilla/profundidad/
  // longitud) — solo cifras; los adjetivos son filas
  kpiTiles: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  kpiTile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  kpiValue: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.primaryDark,
    textAlign: 'center',
  },
  kpiLabel: {
    fontSize: 10,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginTop: 1,
    textAlign: 'center',
  },
  // Respuesta protagonista del emisario: "qué se vierte" con icono —
  // no una fila más, es la pregunta que abre la ficha. Card plana:
  // el acento de color se reserva para lo semántico (riesgo, ZEC,
  // enlaces) — misma regla que la landing
  heroBox: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  heroText: {
    flex: 1,
  },
  // Lead comunicativo de una sola sustancia: "Depuradora: vierte
  // agua residual urbana" — instalación y agua en negrita dentro
  // de una frase, no como título gigante
  heroLead: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 19,
    marginTop: 2,
  },
  heroLeadStrong: {
    fontFamily: fonts.extrabold,
  },
  heroValue: {
    fontSize: 15,
    fontFamily: fonts.extrabold,
    color: colors.text,
    marginTop: 1,
    textAlign: 'center',
  },
  heroSub: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  heroNote: {
    fontSize: 13.5,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    lineHeight: 19,
    marginTop: 4,
  },
  // El veredicto del vertido en línea propia — la conclusión del
  // hero ("el agua sale sin depurar") en extrabold coloreada
  heroVerdict: {
    fontSize: 13.5,
    fontFamily: fonts.extrabold,
    lineHeight: 19,
    marginTop: 4,
  },
  heroRespStrong: {
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  // Sección como mini-card plana (hairline + fondo suave) con
  // icono + título: el borde de color se reserva para lo semántico
  // — riesgo (opBox), ZEC, fuentes enlazables y playas por
  // exposición
  secCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  secHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginBottom: 2,
  },
  // Icono de cabecera de card — mismo tamaño que el grifo del hero
  secIcon: {
    width: 22,
    height: 22,
  },
  // Gota de ubicación: cuadrado con tres esquinas redondas girado
  // 45° — la esquina viva cae abajo y dibuja la punta del pin
  locPinWrap: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locPinDrop: {
    width: 13,
    height: 13,
    borderWidth: 2.2,
    borderRadius: 7,
    borderBottomRightRadius: 1.5,
    transform: [{ rotate: '45deg' }],
    alignItems: 'center',
    justifyContent: 'center',
  },
  locPinHole: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  // Título de card único: "Qué se vierte", "Dónde y cómo" y
  // "Playas cercanas" comparten tamaño, peso y color
  secCardTitle: {
    fontSize: 16.5,
    fontFamily: fonts.extrabold,
    color: colors.primaryDark,
  },
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
    fontSize: 12.5,
    fontFamily: fonts.bold,
    color: colors.status.warning,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  protectedName: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: colors.text,
    marginTop: 2,
    lineHeight: 19,
  },
  protectedStrong: {
    fontFamily: fonts.extrabold,
  },
  // Respiro entre el título de la card y la primera fila — los
  // rows pegados al header se leían como una sola pieza
  nearestList: {
    marginTop: 12,
  },
  nearestBox: {
    marginBottom: 6,
    paddingLeft: 4,
    paddingVertical: 4,
    backgroundColor: colors.background,
    borderRadius: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Separador entre filas (nunca bajo la última): 1px con gris
  // un punto más fuerte que border — el hairline se diluía en
  // pantallas de alta densidad
  nearestBoxSep: {
    borderBottomWidth: 1,
    borderBottomColor: `${colors.textFaint}66`,
    paddingBottom: 8,
    marginBottom: 8,
  },
  // Miniatura Esri del arenal: cuadrada, tamaño de fila de lista —
  // vende la playa mejor que el nombre y ya la pide la web /o/{id}
  nearestThumb: {
    width: 52,
    height: 52,
    borderRadius: 8,
    marginRight: 10,
    backgroundColor: colors.border,
  },
  nearestChevron: {
    fontSize: 16,
    fontFamily: fonts.semibold,
    color: colors.primaryDark,
    paddingRight: 8,
    marginLeft: 6,
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
  // Distancia en píldora de contorno: borde fino del color de
  // título, número en tinta — el semáforo vive en el filete
  nearestPill: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primaryDark,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 4,
    alignSelf: 'center',
  },
  nearestPillText: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  // Prensa del emisario: subtítulo de grupo ("De este emisario"/"En la
  // zona") y fila de titular enlazable — el titular es el enlace
  newsGroup: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 1,
  },
  // Síntesis bajo el rótulo del grupo: "16 noticias · 5 episodios
  // desde 2024 · Playa Jardín" — el patrón de abandono en una línea
  newsGroupSub: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginBottom: 2,
  },

  // Barra segmentada de familias: texto + separador fino en una
  // sola línea (las píldoras no cabían) — el activo va subrayado
  newsSegs: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 2,
  },
  newsSegItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  newsSegDiv: {
    width: 1,
    height: 12,
    backgroundColor: colors.border,
    marginHorizontal: 7,
  },
  newsSeg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 2,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  newsSegOn: {
    borderBottomColor: colors.primary,
  },
  newsSegText: {
    fontSize: 13.5,
    fontFamily: fonts.bold,
    color: colors.textMuted,
  },
  newsSegTextOn: {
    color: colors.primary,
  },
  // Chips de año: faceta secundaria — píldora con borde para no
  // competir con la barra de familias (familia = qué, año = cuándo)
  newsChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
    marginBottom: 2,
  },
  newsChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  newsChipText: {
    fontSize: 11,
    fontFamily: fonts.bold,
  },
  newsChipYear: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  newsChipYearOn: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  newsChipYearText: {
    color: colors.textMuted,
  },
  newsChipYearTextOn: {
    color: colors.surface,
  },
  // Ancla de año del riel temporal: "2026" + hairline que marca
  // dónde empieza cada tramo — la recurrencia en el tiempo se lee
  // de un vistazo antes que ninguna noticia
  newsYearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  newsYearText: {
    fontSize: 12,
    fontFamily: fonts.extrabold,
    color: colors.primaryDark,
  },
  newsYearLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  // Riel temporal por entrada (vocabulario del timeline de
  // Municipios): columna con dot + línea descendente + tick hasta
  // la card. El cluster lleva dot ámbar grande y la card pegada
  // al riel; la suelta lleva dot gris pequeño, tick más largo y
  // la card indentada — la jerarquía se lee en la geometría
  newsTlItem: {
    flexDirection: 'row',
  },
  newsTlRail: {
    width: 16,
    alignItems: 'center',
  },
  newsTlDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.textFaint,
  },
  // Dot de cobertura: más grande y en el ámbar "según prensa" de
  // la banda — el nodo gordo del timeline
  newsTlDotCluster: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.status.lab,
  },
  newsTlLine: {
    flex: 1,
    width: 1.5,
    backgroundColor: colors.border,
  },
  // Tramo de riel sin línea (primera/última fila): ocupa su flex
  // como la línea para que el dot siga centrado igual
  newsTlGap: {
    flex: 1,
  },
  // Puente dot→card: a la altura del centro del dot, que el flex
  // de las líneas centra en la fila sea cual sea su altura
  newsTlTick: {
    position: 'absolute',
    top: '50%',
    marginTop: -0.75,
    left: 16,
    width: 6,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: colors.border,
  },
  newsTlTickLong: {
    width: 16,
  },
  newsTlCard: {
    flex: 1,
    marginLeft: 6,
  },
  newsTlCardIndent: {
    marginLeft: 16,
  },
  // Hija de pila desplegada: cuelga del riel AL RAS de la banda —
  // la pila se abre como acordeón y los recortes comparten su
  // línea izquierda; la pertenencia la da la geometría + el
  // filete ámbar, no una indentación extra
  // Bloque de hijas: aire extra al final para que la siguiente
  // entrada del riel no pegue con el último recorte del paquete
  newsChildBlock: {
    position: 'relative',
    marginBottom: 10,
  },
  // Mini-card de noticia: caja blanca sobre el fondo crema de la
  // sección — cada noticia existe como pieza, no como línea suelta
  newsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    padding: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  // Icono de familia a tamaño legible — la ilustración identifica
  // de un vistazo de qué va cada noticia
  newsCardIcon: {
    width: 28,
    height: 28,
  },
  newsRowBody: {
    flex: 1,
  },
  // Cobertura relacionada como pila de recortes: dos hojas blancas
  // asoman bajo la card ámbar — la silueta dice "varios medios
  // cubrieron esto" antes de leer una sola palabra
  newsStack: {
    marginTop: 6,
    marginBottom: 17,
  },
  // Abierta no hay hojas que reservar: la banda abraza a sus hijas
  newsStackOpen: {
    marginBottom: 2,
  },
  newsStackSheet: {
    position: 'absolute',
    top: 0,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  newsStackBack1: {
    left: 6,
    right: 6,
    bottom: -5,
  },
  newsStackBack2: {
    left: 12,
    right: 12,
    bottom: -10,
  },
  // El ámbar "según prensa" vive solo en la banda-cabecera: cerrada
  // la banda ES la card (pila ámbar); abierta las hijas cuelgan en
  // blanco — el color marca el paquete, no lo baña todo
  newsClusterCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  newsClusterBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 9,
    borderTopLeftRadius: 9,
    borderTopRightRadius: 9,
    backgroundColor: colors.tintPress,
  },
  newsClusterBandClosed: {
    borderBottomLeftRadius: 9,
    borderBottomRightRadius: 9,
  },
  // Fila hija de una pila desplegada: card blanca sobria (sin
  // icono ni filete — la pertenencia la da la indent + la banda)
  newsChildRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 5,
    padding: 8,
    paddingLeft: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  newsEmpty: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 6,
  },
  newsRowMain: {
    fontSize: 14,
    fontFamily: fonts.semibold,
    color: colors.text,
    lineHeight: 18,
  },
  // La meta va en textMuted, no textFaint: #8fa3ad da ~2.6:1 sobre
  // blanco (suspende WCAG); #5c7a89 da ~4.6:1 — secundaria pero
  // legible, que es justo el nivel que debe tener
  newsRowMeta: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 2,
  },
  newsRowChev: {
    fontSize: 17,
    fontFamily: fonts.bold,
    color: colors.textFaint,
  },
  // Banda abierta: el mismo chevron girado 90° apunta al contenido
  newsBandChevOpen: {
    transform: [{ rotate: '90deg' }],
  },
  // "Ver N más": centrado cierra la lista (como el "Ver más
  // noticias" del diseño), despliega las réplicas ocultas
  newsMore: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.primary,
    marginTop: 4,
    alignSelf: 'center',
  },
  nearestName: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  // Pie: solo el enlace a la fuente oficial, discreto
  censusSrcWrap: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
    paddingBottom: 4,
  },
  censusSrc: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: colors.primary,
    textAlign: 'center',
  },
  // Nota epistémica del pie: el riesgo es cálculo propio sobre el
  // censo, no dato oficial — se declara, no se oculta
  censusFoot: {
    fontSize: 10.5,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    textAlign: 'center',
    marginTop: 4,
  },
});

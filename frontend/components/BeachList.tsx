import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  ImageBackground,
  Keyboard,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import BeachDetail from './BeachDetail';
import ScrollChips from './ScrollChips';
import { thumbUrl } from './SatelliteShot';
import {
  BeachStats,
  GeoFeature,
  MunicipalityIncident,
  fetchBeachStats,
  fetchEpisodes,
} from '../lib/api';
import { pointLongLabel, displayBeachName, beachBaseName } from '../lib/format';
import { colors, fonts } from '../lib/theme';
import {
  STATUS_ORDER,
  BeachGroup,
  SortMode,
  buildGroups,
  evalShort,
  groupKeyOf,
  isImpecableGroup,
  statusOf,
  worstEvalOf,
  worstStatusOf,
} from '../lib/beachGroups';
import { PM_SUFFIX } from '../lib/pm';
import { BEACH_STATE_LABEL } from '../lib/structural';

const STATUS_LABELS = BEACH_STATE_LABEL;

// Versión corta para la cara de la pestaña (≈100 px + contador):
// "Cerrada · estructural" → "Estructural". El resto conserva el
// label completo y se trunca donde haga falta — el contador va
// aparte y siempre sobrevive
const STATUS_TAB_LABELS: Record<string, string> = {
  ...STATUS_LABELS,
  structural: 'Estructural',
};

const STATUS_COLORS = colors.status;

const displayName = (name: string) =>
  displayBeachName(name.replace(PM_SUFFIX, ''));

const SORT_LABELS: Record<SortMode, string> = {
  // 'estado' se nombra por su efecto visible (como sus hermanos):
  // las cerradas encabezan la lista, luego avisos, aptas y sin
  // monitorizar — es el orden con el que abre la app
  estado: 'Cerradas primero',
  aptas: 'Aptas primero',
  cierres: 'Más cierres',
  calidad: 'Peor calidad del agua',
};
// Evaluación oficial de la última muestra, resumida para la sub-fila
const evalLabel = (evaluation: string | null) => {
  if (!evaluation) return null;
  if (/prohib/i.test(evaluation)) return 'Prohibido';
  if (/pendiente|valoraci/i.test(evaluation)) return 'Pendiente';
  if (/calificar/i.test(evaluation)) return 'Sin calificar';
  if (/apta/i.test(evaluation)) return 'Apta';
  if (/recomend/i.test(evaluation)) return 'Recomendación';
  // Nunca mostrar el texto administrativo crudo de Náyade
  return null;
};

const fmtShort = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};

export default function BeachList({
  beaches,
  outfalls,
  visible,
  onSelect,
  onClose,
  initialMunicipality,
  onSelectOutfall,
}: {
  beaches: GeoFeature[];
  // Emisarios cargados en la app: BeachDetail los superpone a la foto
  outfalls?: GeoFeature[];
  visible: boolean;
  onSelect: (feature: GeoFeature) => void;
  onClose: () => void;
  // undefined = sin filtro (Todos); null = "Sin municipio"
  initialMunicipality?: string | null;
  // Tap en un emisario cercano dentro de la ficha → verlo en el mapa;
  // el segundo argumento es la playa a restaurar al volver
  onSelectOutfall?: (feature: GeoFeature, restore: GeoFeature | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [municipality, setMunicipality] = useState<string | null | undefined>(
    initialMunicipality,
  );
  const [sortMode, setSortMode] = useState<SortMode>('estado');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(
    undefined,
  );
  const [stats, setStats] = useState<Map<number, BeachStats>>(new Map());
  const [episodes, setEpisodes] = useState<MunicipalityIncident[]>([]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<GeoFeature | null>(null);
  // Barra de filtros en modo acordeón: tres botones (Municipio /
  // Estado / Orden) muestran la selección actual; solo se despliega
  // la fila de chips de la categoría abierta
  const [openFilter, setOpenFilter] = useState<
    'muni' | 'estado' | 'orden' | null
  >(null);
  // Scroll del detalle: BeachDetail baja a "Ver titulares" al expandir
  const detailScrollRef = useRef<ScrollView>(null);
  // "Ver más" del detalle: visible mientras quede contenido bajo el
  // viewport — misma mecánica que la card del mapa
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

  // Abrir ficha: el teclado del buscador podía quedar sobre el overlay
  const openDetail = (f: GeoFeature) => {
    Keyboard.dismiss();
    scrollMetrics.current = { y: 0, vh: 0, ch: 0 };
    setShowMore(false);
    // Si la ficha es de un PM de grupo, al volver debe verse la lista
    // de PMs expandida — solo si el grupo tiene más de un miembro,
    // si no queda un "punto 1" suelto colgando de la fila
    const key = groupKeyOf(f);
    const n = beaches.filter((b) => groupKeyOf(b) === key).length;
    if (n > 1) setExpandedKey(key);
    setDetail(f);
  };
  const closeDetail = () => {
    if (detail) {
      const key = groupKeyOf(detail);
      const n = beaches.filter((b) => groupKeyOf(b) === key).length;
      if (n > 1) setExpandedKey(key);
    }
    setDetail(null);
  };

  // El componente queda montado (Modal visible): búsqueda, filtro,
  // expansión y orden se conservan entre aperturas. Ajustes de estado
  // durante el render (patrón oficial de React — se procesan antes de
  // pintar, sin cascada):
  //  - el municipio solo se impone cuando llega uno nuevo del ranking
  //  - al cerrarse el modal el detalle se descarta: reabrir debe
  //    mostrar la lista, no la ficha anterior
  const [prevMuni, setPrevMuni] = useState(initialMunicipality);
  const [prevVisible, setPrevVisible] = useState(visible);
  if (prevMuni !== initialMunicipality) {
    setPrevMuni(initialMunicipality);
    if (initialMunicipality !== undefined) setMunicipality(initialMunicipality);
  }
  if (prevVisible !== visible) {
    setPrevVisible(visible);
    if (!visible) setDetail(null);
  }

  // Stats frescas cada vez que se abre
  useEffect(() => {
    if (!visible) return;
    fetchBeachStats()
      .then((rows) => setStats(new Map(rows.map((s) => [s.beach_id, s]))))
      .catch(() => {});
    fetchEpisodes()
      .then(setEpisodes)
      .catch(() => {});
  }, [visible]);

  // Totales de la cabecera por playa física (grupo): un conjunto de
  // PMs vigilados cuenta UNA playa monitorizada, no N
  const totals = useMemo(() => {
    const seen = new Map<string, boolean>();
    for (const f of beaches) {
      const k = groupKeyOf(f);
      seen.set(k, (seen.get(k) ?? false) || f.properties.monitored !== false);
    }
    let mon = 0;
    let un = 0;
    for (const v of seen.values()) {
      if (v) mon++;
      else un++;
    }
    return { mon, un };
  }, [beaches]);

  // Correlación isla: cuántas playas con episodios por contaminación
  // tienen un emisario catalogado a <500 m. Coincidencia espacial —
  // nunca causalidad afirmada
  const correlation = useMemo(() => {
    if (!episodes.length || !outfalls?.length) return null;
    const hav = (a: [number, number], b: [number, number]) => {
      const rad = Math.PI / 180;
      const dLa = (b[1] - a[1]) * rad;
      const dLo = (b[0] - a[0]) * rad;
      const s =
        Math.sin(dLa / 2) ** 2 +
        Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLo / 2) ** 2;
      return 2 * 6371000 * Math.asin(Math.sqrt(s));
    };
    const byId = new Map(beaches.map((f) => [f.id, f]));
    const polluted = new Set<string>();
    const near = new Set<string>();
    for (const ep of episodes) {
      if (ep.kind !== 'closure' || ep.cause !== 'Contaminación') continue;
      const f = byId.get(ep.beach_id);
      if (!f) continue;
      const key = groupKeyOf(f);
      polluted.add(key);
      if (
        outfalls.some(
          (o) => hav(f.geometry.coordinates, o.geometry.coordinates) <= 500,
        )
      ) {
        near.add(key);
      }
    }
    return polluted.size ? { total: polluted.size, near: near.size } : null;
  }, [episodes, beaches, outfalls]);

  const municipalities = useMemo(
    () =>
      [
        ...new Set(
          beaches.map((f) => f.properties.municipality).filter(Boolean),
        ),
      ].sort() as string[],
    [beaches],
  );

  // Estados presentes en los datos, en orden de severidad: solo se
  // muestran chips de filtro para lo que realmente hay en la lista
  // (STATUS_ORDER ya deja "Sin datos" el último)
  const presentStatuses = useMemo(
    () =>
      [...new Set(beaches.map(statusOf))].sort(
        (a, b) => (STATUS_ORDER[a] ?? 9) - (STATUS_ORDER[b] ?? 9),
      ),
    [beaches],
  );

  const statSum = (
    g: BeachGroup,
    k:
      | 'closures'
      | 'warnings'
      | 'closures_last_year'
      | 'bad_samples'
      | 'reconstructed',
  ) => g.members.reduce((s, m) => s + (stats.get(m.id)?.[k] ?? 0), 0);

  const groups = useMemo(
    () =>
      buildGroups(beaches, {
        query,
        municipality,
        sortMode,
        statusFilter,
        stats,
      }),
    [beaches, query, municipality, sortMode, statusFilter, stats],
  );

  // Conteos por opción para los paneles del acordeón: cada chip
  // muestra cuántas playas daría elegirlo — el número se calcula
  // SIN su propio filtro pero CON el resto aplicado (municipio
  // respeta búsqueda+estado; estado respeta búsqueda+municipio)
  const noStatus = useMemo(
    () => buildGroups(beaches, { query, municipality, sortMode, stats }),
    [beaches, query, municipality, sortMode, stats],
  );
  const statusCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of noStatus) {
      const s = worstStatusOf(g);
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return m;
  }, [noStatus]);
  const impecablesCount = useMemo(
    () => noStatus.filter((g) => isImpecableGroup(g, stats)).length,
    [noStatus, stats],
  );
  const noMuni = useMemo(
    () => buildGroups(beaches, { query, sortMode, statusFilter, stats }),
    [beaches, query, sortMode, statusFilter, stats],
  );
  const muniCounts = useMemo(() => {
    const m = new Map<string | null, number>();
    for (const g of noMuni) {
      m.set(g.municipality, (m.get(g.municipality) ?? 0) + 1);
    }
    return m;
  }, [noMuni]);

  // PMs del complejo de la ficha abierta (los hermanos de `detail`)
  const detailMembers = useMemo(
    () =>
      detail ? beaches.filter((b) => groupKeyOf(b) === groupKeyOf(detail)) : [],
    [detail, beaches],
  );

  return (
    <Modal
      animationType="slide"
      visible={visible}
      onRequestClose={detail ? closeDetail : onClose}
    >
      <View style={styles.container}>
        <>
          <ImageBackground
            source={require('../assets/gradient-sea.png')}
            style={styles.header}
            resizeMode="cover"
          >
            {/* Fila 1: título + acciones. Los datos isla van a ancho
              completo debajo — antes apretaban el botón "Por
              municipio" */}
            <View style={styles.headerTop}>
              <Text style={[styles.title, { flex: 1, textAlign: 'center' }]}>
                Playas
              </Text>
              <View style={styles.headerRight}>
                <Pressable
                  onPress={onClose}
                  hitSlop={12}
                  style={({ pressed }) => [
                    styles.closeBtn,
                    pressed && styles.pressFx,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Cerrar lista de playas"
                >
                  <Text style={styles.close}>✕</Text>
                </Pressable>
              </View>
            </View>
            <Text style={[styles.headerSub, { marginTop: 23 }]}>
              {totals.mon} monitorizadas · {totals.un} sin monitorizar
            </Text>
            {correlation && (
              <Text style={styles.headerSub}>
                De las {correlation.total} playas que han tenido cierres por
                contaminación, {correlation.near} tienen un emisario a menos de
                500 m
              </Text>
            )}
          </ImageBackground>

          <View style={styles.searchWrap}>
            <Image
              source={require('../assets/icons/icon-search.png')}
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.search}
              placeholder="Busca tu playa…"
              placeholderTextColor={colors.textFaint}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              clearButtonMode="while-editing"
              accessibilityLabel="Buscar playa por nombre"
            />
          </View>

          <ImageBackground
            source={require('../assets/gradient-filter.png')}
            style={styles.filterBar}
            imageStyle={styles.filterBarImg}
          >
            {/* Tres desplegables (una fila en vez de tres): cada
                botón enseña su categoría + selección actual y abre
                su propia fila de chips — acordeón, una a la vez */}
            <View style={styles.filterTabs}>
              {(
                [
                  {
                    key: 'muni' as const,
                    label: 'Municipio',
                    value:
                      municipality === undefined
                        ? 'Todos'
                        : (municipality ?? 'Sin municipio'),
                    count: municipality === undefined ? null : groups.length,
                  },
                  {
                    key: 'estado' as const,
                    label: 'Estado',
                    value:
                      statusFilter === undefined
                        ? 'Todos'
                        : statusFilter === 'impecables'
                          ? 'Agua siempre apta'
                          : STATUS_TAB_LABELS[statusFilter],
                    count: statusFilter === undefined ? null : groups.length,
                  },
                  {
                    key: 'orden' as const,
                    label: 'Ordenar',
                    // En la cara va el rol («Por defecto» cabe sin
                    // truncar); el chip dentro dice el criterio real
                    // («Cerradas primero»)
                    value:
                      sortMode === 'estado'
                        ? 'Por defecto'
                        : SORT_LABELS[sortMode],
                    count: null,
                  },
                ] as const
              ).map((t) => {
                const open = openFilter === t.key;
                return (
                  <Pressable
                    key={t.key}
                    style={({ pressed }) => [
                      styles.filterTab,
                      open && styles.filterTabOpen,
                      pressed && styles.pressFx,
                    ]}
                    onPress={() => setOpenFilter(open ? null : t.key)}
                    accessibilityRole="button"
                    accessibilityLabel={`${t.label}: ${t.value}${
                      t.count != null ? ` (${t.count})` : ''
                    }`}
                    accessibilityState={{ expanded: open }}
                  >
                    <View style={styles.filterTabText}>
                      <Text style={styles.filterTabLabel}>{t.label}</Text>
                      <View style={styles.filterTabValueRow}>
                        {t.key === 'estado' &&
                          statusFilter !== undefined &&
                          statusFilter !== 'impecables' && (
                            <View
                              style={[
                                styles.filterTabDot,
                                {
                                  backgroundColor: STATUS_COLORS[statusFilter],
                                },
                              ]}
                            />
                          )}
                        <Text style={styles.filterTabValue} numberOfLines={1}>
                          {t.value}
                        </Text>
                        {t.count != null && (
                          <Text style={styles.filterTabCount}>
                            {` (${t.count})`}
                          </Text>
                        )}
                      </View>
                    </View>
                    <Text
                      style={[
                        styles.filterTabChevron,
                        open && styles.filterTabChevronOpen,
                      ]}
                    >
                      ›
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {openFilter !== null && <View style={styles.filterBarDivider} />}
            {openFilter === 'muni' && (
              <ScrollChips
                style={styles.chips}
                contentContainerStyle={styles.chipsContent}
                fadeRgbLeft="140,216,230"
                fadeRgbRight="242,251,253"
                a11yLabel="municipios"
              >
                <Pressable
                  style={({ pressed }) => [
                    styles.chip,
                    municipality === undefined && styles.chipActive,
                    pressed && styles.pressFx,
                  ]}
                  onPress={() => setMunicipality(undefined)}
                  accessibilityRole="button"
                  accessibilityLabel="Mostrar todas las playas"
                  accessibilityState={{ selected: municipality === undefined }}
                >
                  <Text
                    style={[
                      styles.chipText,
                      municipality === undefined && styles.chipTextActive,
                    ]}
                  >
                    {`Todos (${noMuni.length})`}
                  </Text>
                </Pressable>
                {municipalities.map((m) => (
                  <Pressable
                    key={m}
                    style={({ pressed }) => [
                      styles.chip,
                      municipality === m && styles.chipActive,
                      pressed && styles.pressFx,
                    ]}
                    onPress={() =>
                      setMunicipality(municipality === m ? undefined : m)
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Filtrar por municipio ${m}`}
                    accessibilityState={{ selected: municipality === m }}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        municipality === m && styles.chipTextActive,
                      ]}
                    >
                      {`${m} (${muniCounts.get(m) ?? 0})`}
                    </Text>
                  </Pressable>
                ))}
                {beaches.some((f) => f.properties.municipality == null) && (
                  <Pressable
                    style={({ pressed }) => [
                      styles.chip,
                      municipality === null && styles.chipActive,
                      pressed && styles.pressFx,
                    ]}
                    onPress={() =>
                      setMunicipality(municipality === null ? undefined : null)
                    }
                    accessibilityRole="button"
                    accessibilityLabel="Filtrar por playas sin municipio"
                    accessibilityState={{ selected: municipality === null }}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        municipality === null && styles.chipTextActive,
                      ]}
                    >
                      {`Sin municipio (${muniCounts.get(null) ?? 0})`}
                    </Text>
                  </Pressable>
                )}
              </ScrollChips>
            )}
            {openFilter === 'estado' && (
              <ScrollChips
                style={styles.chips}
                contentContainerStyle={styles.chipsContent}
                fadeRgbLeft="140,216,230"
                fadeRgbRight="242,251,253"
                a11yLabel="filtros de estado"
              >
                {presentStatuses.map((s) => (
                  <Pressable
                    key={s}
                    style={({ pressed }) => [
                      styles.chip,
                      styles.chipStatus,
                      statusFilter === s && styles.chipActive,
                      pressed && styles.pressFx,
                    ]}
                    onPress={() =>
                      setStatusFilter(statusFilter === s ? undefined : s)
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Filtrar por estado ${STATUS_LABELS[s]}`}
                    accessibilityState={{ selected: statusFilter === s }}
                  >
                    <View
                      style={[
                        styles.chipDot,
                        { backgroundColor: STATUS_COLORS[s] },
                      ]}
                    />
                    <Text
                      style={[
                        styles.chipText,
                        statusFilter === s && styles.chipTextActive,
                      ]}
                    >
                      {`${STATUS_LABELS[s]} (${statusCounts.get(s) ?? 0})`}
                    </Text>
                  </Pressable>
                ))}
                {/* «Agua siempre apta» es un filtro de estado (récord
                  limpio), no un orden: vive en este panel aunque su
                  activación también fije el orden interno a Estado */}
                <Pressable
                  style={({ pressed }) => [
                    styles.chip,
                    statusFilter === 'impecables' && styles.chipActive,
                    pressed && styles.pressFx,
                  ]}
                  onPress={() => {
                    if (statusFilter === 'impecables') return;
                    setStatusFilter('impecables');
                    setSortMode('estado');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Filtrar por playas que nunca tuvieron un problema de agua"
                  accessibilityState={{
                    selected: statusFilter === 'impecables',
                  }}
                >
                  <Text
                    style={[
                      styles.chipText,
                      statusFilter === 'impecables' && styles.chipTextActive,
                    ]}
                  >
                    {`Agua siempre apta (${impecablesCount})`}
                  </Text>
                </Pressable>
              </ScrollChips>
            )}
            {openFilter === 'orden' && (
              /* Ordenar (radio puro): el orden siempre es uno. Con «Agua
            siempre apta» activo el orden interno es Estado pero el
            chip no se marca — solo un chip activo a la vez */
              <ScrollChips
                style={styles.chips}
                contentContainerStyle={styles.chipsContent}
                fadeRgbLeft="140,216,230"
                fadeRgbRight="242,251,253"
                a11yLabel="ordenar"
              >
                {(['estado', 'aptas', 'cierres', 'calidad'] as const).map(
                  (item) => (
                    <Pressable
                      key={item}
                      style={({ pressed }) => [
                        styles.chip,
                        sortMode === item &&
                          statusFilter !== 'impecables' &&
                          styles.chipActive,
                        pressed && styles.pressFx,
                      ]}
                      onPress={() => {
                        setSortMode(item);
                        // Elegir un orden sale del modo "Agua siempre apta"
                        if (statusFilter === 'impecables')
                          setStatusFilter(undefined);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Ordenar: ${SORT_LABELS[item]}`}
                      accessibilityState={{
                        selected:
                          sortMode === item && statusFilter !== 'impecables',
                      }}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          sortMode === item &&
                            statusFilter !== 'impecables' &&
                            styles.chipTextActive,
                        ]}
                      >
                        {SORT_LABELS[item]}
                      </Text>
                    </Pressable>
                  ),
                )}
              </ScrollChips>
            )}
          </ImageBackground>

          {statusFilter === 'impecables' && (
            <Text style={styles.impecablesNote}>
              Solo playas monitorizadas por Sanidad: cero muestras no aptas y
              cero episodios de contaminación
            </Text>
          )}

          <FlatList
            data={groups}
            keyExtractor={(g) => g.key}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            // 'handled': el tap llega a la fila con el teclado abierto
            // (no se lo come el dismiss); 'on-drag': scrollear ya
            // retira el teclado sin esperar a un tap
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            renderItem={({ item: g }) => {
              const status = worstStatusOf(g);
              const expanded = expandedKey === g.key;
              // Cabecera del grupo: totales DEDUPLICADOS por playa
              // física — un cierre de prensa replicado en los 3 PMs
              // cuenta una vez (Jardín: 5 eventos reales, no 11)
              const closures =
                statSum(g, 'closures') + statSum(g, 'reconstructed');
              const warnings = statSum(g, 'warnings');
              const badSamples = statSum(g, 'bad_samples');
              return (
                <View style={styles.row}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.rowMain,
                      pressed && styles.pressFx,
                    ]}
                    onPress={() =>
                      g.members.length === 1
                        ? openDetail(g.members[0])
                        : setExpandedKey(expanded ? null : g.key)
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`${displayName(g.name)}, ${
                      g.municipality ?? 'sin municipio'
                    }, ${STATUS_LABELS[status]}${
                      g.members.length > 1
                        ? `, ${g.members.length} puntos de muestreo`
                        : ''
                    }`}
                    accessibilityHint={
                      g.members.length > 1
                        ? 'Toca para ver los puntos de muestreo'
                        : 'Toca para abrir la ficha'
                    }
                    accessibilityState={
                      g.members.length > 1 ? { expanded } : undefined
                    }
                  >
                    {/* Miniatura satélite del arenal: reconocer la
                        playa de un vistazo en la lista — la misma
                        foto Esri que la ficha (máximo zoom legible).
                        En grupos multipunto se usa el primer PM */}
                    <Image
                      source={{
                        uri: thumbUrl(
                          g.members[0].geometry.coordinates as [number, number],
                          160,
                          0.5,
                        ),
                      }}
                      style={styles.rowThumb}
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                    <View style={styles.rowText}>
                      <Text style={styles.rowName}>{displayName(g.name)}</Text>
                      <Text style={styles.rowSub}>
                        {g.municipality ?? 'Sin municipio'}
                        {g.members.length > 1
                          ? ` · ${g.members.length} zonas`
                          : ''}
                        {[
                          closures > 0
                            ? `${closures} ${
                                closures === 1 ? 'cierre' : 'cierres'
                              }`
                            : null,
                          warnings > 0
                            ? `${warnings} ${
                                warnings === 1 ? 'aviso' : 'avisos'
                              }`
                            : null,
                        ]
                          .filter(Boolean)
                          .map((s) => ` · ${s}`)}
                        {sortMode === 'calidad' && worstEvalOf(g, stats) != null
                          ? ` · última: ${evalShort(worstEvalOf(g, stats))}`
                          : ''}
                        {badSamples > 0
                          ? ` · ${badSamples} muestras no aptas`
                          : ''}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.badge,
                        { backgroundColor: STATUS_COLORS[status] },
                      ]}
                    >
                      <Text style={styles.badgeText}>
                        {STATUS_LABELS[status]}
                      </Text>
                    </View>
                  </Pressable>
                  {expanded &&
                    g.members.map((f) => {
                      const fStatus = statusOf(f);
                      const st = stats.get(f.id);
                      const ev = evalLabel(st?.latest_evaluation ?? null);
                      const pmSub = [
                        st?.latest_sampled_at
                          ? fmtShort(st.latest_sampled_at)
                          : null,
                        ev,
                        // Conteo propio del PM — cuadra con su ficha
                        // (agua no apta va aparte: nunca es cierre)
                        st &&
                        (st.own_closures ?? 0) +
                          (st.own_warnings ?? 0) +
                          (st.own_lab ?? 0) >
                          0
                          ? [
                              (st.own_closures ?? 0) > 0
                                ? `${st.own_closures} ${
                                    st.own_closures === 1 ? 'cierre' : 'cierres'
                                  }`
                                : null,
                              (st.own_warnings ?? 0) > 0
                                ? `${st.own_warnings} ${
                                    st.own_warnings === 1 ? 'aviso' : 'avisos'
                                  }`
                                : null,
                              (st.own_lab ?? 0) > 0
                                ? `${st.own_lab} muestra${
                                    st.own_lab === 1 ? ' no apta' : 's no aptas'
                                  }`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ');
                      return (
                        <Pressable
                          key={f.id}
                          style={({ pressed }) => [
                            styles.pmRow,
                            pressed && styles.pressFx,
                          ]}
                          onPress={() => openDetail(f)}
                          accessibilityRole="button"
                          accessibilityLabel={`${
                            pointLongLabel(f.properties.name) ??
                            displayName(f.properties.name)
                          }, ${STATUS_LABELS[fStatus]}`}
                          accessibilityHint="Abrir ficha del punto de muestreo"
                        >
                          {/* Miniatura del punto concreto: cada PM
                              tiene su coordenada — en zonas separadas
                              (Jardín) se ve que NO son la misma cala */}
                          <Image
                            source={{
                              uri: thumbUrl(
                                f.geometry.coordinates as [number, number],
                                80,
                                0.5,
                              ),
                            }}
                            style={styles.pmThumb}
                            accessibilityElementsHidden
                            importantForAccessibility="no"
                          />
                          <View style={styles.pmText}>
                            <Text style={styles.pmName}>
                              {pointLongLabel(f.properties.name) ??
                                displayName(f.properties.name)}
                            </Text>
                            {pmSub ? (
                              <Text style={styles.pmSub}>{pmSub}</Text>
                            ) : null}
                          </View>
                          <View
                            style={[
                              styles.badge,
                              { backgroundColor: STATUS_COLORS[fStatus] },
                            ]}
                          >
                            <Text style={styles.badgeText}>
                              {STATUS_LABELS[fStatus]}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                </View>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.empty}>Sin resultados</Text>
            }
          />
        </>

        {/* Ficha del PM como overlay: la lista queda montada debajo y
            conserva scroll + expansión al volver atrás */}
        {detail && (
          <View style={styles.detailOverlay}>
            <ImageBackground
              source={require('../assets/gradient-sea.png')}
              style={styles.header}
              resizeMode="cover"
            >
              <View style={styles.detailHeaderRow}>
                <Pressable
                  onPress={closeDetail}
                  hitSlop={12}
                  style={({ pressed }) => [
                    styles.backBtn,
                    pressed && styles.pressFx,
                  ]}
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
                      detailMembers.length > 1
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
                  members={detailMembers}
                  onViewOnMap={() => onSelect(detail)}
                  onSelectOutfall={
                    onSelectOutfall
                      ? (f) => onSelectOutfall(f, detail)
                      : undefined
                  }
                />
              </View>
            </ScrollView>
            {/* "Ver más": insinúa que hay contenido debajo; autoscroll
                hasta el final y se oculta al llegar abajo. Mismo
                tratamiento que la card del mapa: scrim nativo que
                funde el contenido + píldora con arte de mar */}
            {showMore && (
              <>
                <LinearGradient
                  colors={['rgba(242,247,248,0)', 'rgba(242,247,248,0.97)']}
                  locations={[0, 0.8]}
                  style={styles.moreFade}
                  pointerEvents="none"
                />
                <Pressable
                  style={({ pressed }) => [
                    styles.moreBtn,
                    pressed && styles.pressFx,
                  ]}
                  onPress={() => {
                    detailScrollRef.current?.scrollToEnd({
                      animated: true,
                    });
                    setTimeout(() => {
                      const m = scrollMetrics.current;
                      if (m.ch > 0 && m.y + m.vh >= m.ch - 120)
                        setShowMore(false);
                    }, 1200);
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
              </>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Feedback táctil común: leve fundido al presionar
  pressFx: {
    opacity: 0.6,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop:
      (Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 24) + 10,
    paddingBottom: 12,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
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
  headerSub: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 2,
  },
  close: {
    fontSize: 20,
    fontFamily: fonts.extrabold,
    color: 'rgba(255,255,255,0.9)',
  },
  // Botón ✕ contenido: cuadrado de esquinas suaves translúcido —
  // affordance visible sin pesar sobre el header degradado
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    margin: 12,
    marginBottom: 8,
    borderRadius: 10,
    paddingHorizontal: 14,
    elevation: 2,
  },
  searchIcon: {
    width: 16,
    height: 16,
    tintColor: colors.textFaint,
  },
  search: {
    flex: 1,
    paddingVertical: 10,
    paddingLeft: 8,
    fontSize: 15,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  // Barra única que contiene las dos filas de filtros sobre una
  // aguada del degradado mar (40%: misma familia que la cabecera
  // pero sin competir con ella); la divisoria separa "dónde"
  // (municipios) de "cómo/cuál" (orden + estado)
  filterBar: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    marginHorizontal: 12,
    marginBottom: 4,
    overflow: 'hidden',
    elevation: 2,
  },
  filterBarImg: {
    borderRadius: 10,
  },
  filterBarDivider: {
    height: 1,
    backgroundColor: 'rgba(8,107,150,0.18)',
    marginHorizontal: 10,
  },
  // Pestañas desplegables: una sola fila resume las 3 categorías —
  // cada una muestra qué hay seleccionado sin ocupar filas de chips
  filterTabs: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  filterTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(8,107,150,0.14)',
  },
  filterTabOpen: {
    backgroundColor: colors.accent,
    borderColor: 'transparent',
  },
  filterTabText: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  filterTabLabel: {
    fontSize: 10,
    fontFamily: fonts.semibold,
    color: colors.text, // navy como el valor: jerarquía por tamaño, no por gris lavado
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  filterTabValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  // Dot del color de estado en la pestaña cerrada: el lenguaje
  // visual de los chips sobrevive al acordeón
  filterTabDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  filterTabValue: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: colors.text,
    textAlign: 'center',
    flexShrink: 1,
  },
  // Contador aparte del valor: nunca se corta — el nombre largo se
  // trunca ("Buenavista del N…") pero "(9)" sobrevive
  filterTabCount: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: colors.text,
    flexShrink: 0,
  },
  filterTabChevron: {
    fontSize: 15,
    fontFamily: fonts.semibold,
    color: colors.primaryDark,
    transform: [{ rotate: '90deg' }],
    marginLeft: 3,
  },
  filterTabChevronOpen: {
    transform: [{ rotate: '-90deg' }],
    color: colors.text,
  },
  chips: {
    flexGrow: 0,
  },
  chipsContent: {
    paddingHorizontal: 8,
    gap: 4,
    paddingVertical: 6,
  },
  // Nota aclaratoria del filtro "Agua siempre apta": solo cuenta
  // playas vigiladas (las OSM sin vigilancia no tienen muestras)
  impecablesNote: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  // Segmentos de la barra: transparentes (no son botones sueltos) —
  // la presencia la da el texto navy, no un relleno
  chip: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipActive: {
    backgroundColor: colors.accent,
  },
  chipText: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: colors.text, // navy: presencia sin relleno de boton
  },
  chipTextActive: {
    color: colors.text, // navy: mas contraste que blanco sobre turquesa
    fontFamily: fonts.extrabold,
  },
  chipStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  list: {
    flex: 1,
    marginTop: 8,
  },
  listContent: {
    paddingBottom: Platform.OS === 'android' ? 34 : 8, // barra de gestos
  },
  row: {
    backgroundColor: colors.surface,
    marginHorizontal: 12,
    marginBottom: 6,
    borderRadius: 10,
    elevation: 1,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  pmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingLeft: 24,
    paddingRight: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  pmText: {
    flex: 1,
  },
  pmName: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
  },
  pmSub: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 1,
  },
  // Miniatura Esri del arenal: cuadrada, tamaño de fila — vende la
  // playa mejor que el nombre (misma fuente que la ficha)
  rowThumb: {
    width: 52,
    height: 52,
    borderRadius: 8,
    marginRight: 10,
    backgroundColor: colors.border,
  },
  // Versión reducida para las sub-filas de PM (jerarquía: el grupo
  // pesa más que sus puntos)
  pmThumb: {
    width: 40,
    height: 40,
    borderRadius: 7,
    marginRight: 10,
    backgroundColor: colors.border,
  },
  rowText: {
    flex: 1,
  },
  rowName: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  rowSub: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 2,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 8,
  },
  badgeText: {
    color: colors.onColor,
    fontSize: 11,
    fontFamily: fonts.bold,
  },
  empty: {
    textAlign: 'center',
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 40,
  },
});

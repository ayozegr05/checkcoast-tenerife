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

import BeachDetail from './BeachDetail';
import ScrollChips from './ScrollChips';
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
  statusOf,
  worstEvalOf,
  worstStatusOf,
} from '../lib/beachGroups';

const STATUS_LABELS: Record<string, string> = {
  closed: 'Cerrada',
  warning: 'Aviso',
  unknown: 'Sin datos',
  open: 'Apta',
  unmonitored: 'No monitorizada',
};

const STATUS_COLORS = colors.status;

const displayName = (name: string) =>
  displayBeachName(name.replace(/\s+PM\d+$/, ''));

const SORT_LABELS: Record<SortMode, string> = {
  estado: 'Estado',
  cierres: 'Más cierres',
  calidad: 'Peor calidad',
};
// Evaluación oficial de la última muestra, resumida para la sub-fila
const evalLabel = (evaluation: string | null) => {
  if (!evaluation) return null;
  if (/prohib/i.test(evaluation)) return 'Prohibido';
  if (/calificar/i.test(evaluation)) return 'Sin calificar';
  if (/apta/i.test(evaluation)) return 'Apta';
  if (/recomend/i.test(evaluation)) return 'Recomendación';
  return evaluation;
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
    setDetail(f);
  };

  // El componente queda montado (Modal visible): búsqueda, filtro,
  // expansión y orden se conservan entre aperturas. El municipio solo se
  // impone cuando llega uno nuevo desde el ranking de municipios
  useEffect(() => {
    if (initialMunicipality !== undefined) setMunicipality(initialMunicipality);
  }, [initialMunicipality]);

  // Al cerrarse el modal el detalle se descarta: reabrir la lista (p. ej.
  // desde el ranking de municipios) debe mostrar la lista, no la ficha
  // anterior
  useEffect(() => {
    if (!visible) setDetail(null);
  }, [visible]);

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
    for (const v of seen.values()) v ? mon++ : un++;
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

  return (
    <Modal
      animationType="slide"
      visible={visible}
      onRequestClose={detail ? () => setDetail(null) : onClose}
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
              {totals.mon} vigiladas · {totals.un} sin vigilar
            </Text>
            {correlation && (
              <Text style={styles.headerSub}>
                De las {correlation.total} playas con cierres por contaminación,{' '}
                {correlation.near} tienen un emisario a menos de 500 m
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
                  Todos
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
                    {m}
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
                    Sin municipio
                  </Text>
                </Pressable>
              )}
            </ScrollChips>
            <View style={styles.filterBarDivider} />
            {/* Filtros de estado (toggles independientes) */}
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
                    {STATUS_LABELS[s]}
                    {statusFilter === s ? ` (${groups.length})` : ''}
                  </Text>
                </Pressable>
              ))}
            </ScrollChips>
            <View style={styles.filterBarDivider} />
            {/* Orden (radio): el orden siempre es uno. "Agua siempre apta"
            es un modo de este grupo — al activarlo fija el orden a
            "Estado", y elegir otro chip lo desactiva (no es un toggle
            aparte) */}
            <ScrollChips
              style={styles.chips}
              contentContainerStyle={styles.chipsContent}
              fadeRgbLeft="140,216,230"
              fadeRgbRight="242,251,253"
              a11yLabel="orden"
            >
              {(['estado', 'agua', 'cierres', 'calidad'] as const).map(
                (item) =>
                  item === 'agua' ? (
                    <Pressable
                      key="agua"
                      style={({ pressed }) => [
                        styles.chip,
                        styles.chipStatus,
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
                          statusFilter === 'impecables' &&
                            styles.chipTextActive,
                        ]}
                      >
                        Agua siempre apta
                        {statusFilter === 'impecables'
                          ? ` (${groups.length})`
                          : ''}
                      </Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      key={item}
                      style={({ pressed }) => [
                        styles.chip,
                        // Radio puro: con "Agua siempre apta" activo el
                        // orden interno es Estado pero el chip no se
                        // marca — solo un chip activo a la vez
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
                      accessibilityLabel={`Ordenar por ${SORT_LABELS[item]}`}
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
          </ImageBackground>

          {statusFilter === 'impecables' && (
            <Text style={styles.impecablesNote}>
              Solo playas vigiladas por Sanidad: cero muestras no aptas y cero
              episodios de contaminación
            </Text>
          )}

          <FlatList
            data={groups}
            keyExtractor={(g) => g.key}
            style={styles.list}
            contentContainerStyle={styles.listContent}
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
                    <View style={styles.rowText}>
                      <Text style={styles.rowName}>{displayName(g.name)}</Text>
                      <Text style={styles.rowSub}>
                        {g.municipality ?? 'Sin municipio'}
                        {g.members.length > 1
                          ? ` · ${g.members.length} PMs`
                          : ''}
                        {closures + warnings > 0
                          ? ` · ${closures} ${
                              closures === 1 ? 'cierre' : 'cierres'
                            } · ${warnings} ${
                              warnings === 1 ? 'aviso' : 'avisos'
                            }`
                          : ''}
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
                        st &&
                        (st.own_closures ?? 0) + (st.own_warnings ?? 0) > 0
                          ? `${st.own_closures} ${
                              st.own_closures === 1 ? 'cierre' : 'cierres'
                            } · ${st.own_warnings} ${
                              st.own_warnings === 1 ? 'aviso' : 'avisos'
                            }`
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
                <Text
                  style={[styles.title, { flex: 1, textAlign: 'center' }]}
                  numberOfLines={2}
                >
                  {displayBeachName(
                    beaches.filter((b) => groupKeyOf(b) === groupKeyOf(detail))
                      .length > 1
                      ? detail.properties.name
                      : beachBaseName(detail.properties.name),
                  )}
                  {detail.properties.municipality
                    ? ` · ${detail.properties.municipality}`
                    : ''}
                </Text>
              </View>
            </ImageBackground>
            <ScrollView
              ref={detailScrollRef}
              style={styles.detailScroll}
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
                hasta el final y se oculta al llegar abajo */}
            {showMore && (
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
                <Text style={styles.moreText}>Ver más ⌄</Text>
              </Pressable>
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
    color: '#fff',
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
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'android' ? 44 : 24,
  },
  moreBtn: {
    position: 'absolute',
    // Por encima de la barra de gestos/botones nativos de Android,
    // igual que la card del mapa (CARD_BOTTOM ≈ 44)
    bottom: Platform.OS === 'android' ? 49 : 12,
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: colors.primary,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  moreText: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: '#fff',
  },
  title: {
    fontSize: 18,
    fontFamily: fonts.extrabold,
    color: '#fff',
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
    color: '#fff',
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

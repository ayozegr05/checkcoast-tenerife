import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  ImageBackground,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  BeachStats,
  EpisodeFocus,
  GeoFeature,
  MunicipalityIncident,
  fetchBeachStats,
} from '../lib/api';
import {
  causeFamily,
  causeFamilyCounts,
  episodeYears,
  latestEpisodeYear,
  seasonEpisodes,
  seasonYear,
  summerEpisodes,
  yearEpisodes,
} from '../lib/episodes';
import { searchNorm } from '../lib/format';
import {
  MAX_YEAR_CHIPS,
  MuniStats,
  buildMuniRows,
  muniCauseCounts,
  scoreOf,
  yearMuniCounts,
  yearScoreOf,
} from '../lib/muniStats';
import { colors } from '../lib/theme';
import {
  CauseChips,
  SeasonFilter,
  SeasonFilterChips,
  YearChips,
} from './stats/Chips';
import EpisodeRow from './stats/EpisodeRow';
import ScrollChips from './ScrollChips';
import MuniDetail from './stats/MuniDetail';
import MuniRow from './stats/MuniRow';
import { styles } from './stats/statsStyles';

export default function MunicipalityStats({
  visible,
  beaches,
  episodes = [],
  initialView = 'ranking',
  initialCause = null,
  session = 0,
  onSelect,
  onSelectBeach,
  onClose,
}: {
  visible: boolean;
  beaches: GeoFeature[];
  // Sesión de apertura: App la incrementa solo en aperturas nuevas.
  // Reabrir tras una ficha conserva la sesión → la firma coincide
  // con la última y no se resetea el estado del panel
  session?: number;
  // Episodios insulares (/episodes): cabecera anual + vista Temporada
  episodes?: MunicipalityIncident[];
  // "verano"/"año" abren el panel directo en la cronología con esa
  // ventana (enlace del banner de alertas / drill-down por causa)
  initialView?: 'ranking' | 'verano' | 'año';
  // Causa preseleccionada en la cronología (toque en el paréntesis
  // del banner: "7 mar agitado" → abre filtrado)
  initialCause?: string | null;
  onSelect: (municipality: string | null) => void;
  // Tocar un incidente de la línea temporal abre la ficha de su
  // playa; el episodio acompaña para que la ficha baje directo a
  // Episodios con su fila marcada
  onSelectBeach?: (beachId: number, episode?: EpisodeFocus) => void;
  onClose: () => void;
}) {
  const [stats, setStats] = useState<Map<number, BeachStats>>(new Map());
  const [detail, setDetail] = useState<MuniStats | null>(null);
  // Tres formas de mirar el registro: 'ranking' agrega por municipio;
  // 'verano' y 'año' son la misma cronología insular con distinta
  // ventana (jun-sep vs año natural). La temporada es ciudadano de
  // primera clase — es lo que más consulta el bañista
  const [view, setView] = useState<'ranking' | 'verano' | 'año'>(initialView);
  // Año seleccionado en la cronología (y modo-año del ranking) —
  // por defecto el vigente; las chips de año lo cambian
  const [selYear, setSelYear] = useState(seasonYear());
  // 'Histórico' (todo el registro) vs año concreto — en ranking decide
  // el ámbito del ranking; en cronología el de la lista de episodios.
  // Abre en el año vigente — lo que interesa es el ahora
  const [histMode, setHistMode] = useState(false);
  // Buscador de municipio en el ranking (filtro por nombre)
  const [muniQuery, setMuniQuery] = useState('');
  // Municipio seleccionado en la faceta (índice alfabético para
  // saltar a uno sin saber escribir su nombre)
  const [selMuni, setSelMuni] = useState<string | null>(null);
  // Filtro de tipo de la cronología: cierres | avisos | activas ahora
  const [tipoFilter, setTipoFilter] = useState<SeasonFilter>('all');
  // Filtro de causa compartido (familias: contaminación, riesgo
  // estructural…) — mismo eje en ranking y en cronología
  const [cause, setCause] = useState<string>(initialCause ?? 'all');
  // Chips de año plegadas tras "Más años ›" cuando hay más de
  // MAX_YEAR_CHIPS — los antiguos no compiten con el ahora
  const [showAllYears, setShowAllYears] = useState(false);
  // Acordeón de facetas contextuales (misma mecánica que Emisarios):
  // cada pestaña abre su fila de chips; solo una abierta a la vez y
  // la selección única cierra el panel al elegir
  const [openFilter, setOpenFilter] = useState<
    'municipio' | 'año' | 'tipo' | 'causa' | null
  >(null);

  // El modal vive montado (conserva scroll/estado): al abrirlo manda
  // la vista pedida, no la última visitada. Reset durante render —
  // corre antes de pintar, sin render extra. La firma incluye sesión
  // + props de apertura: una reapertura de la MISMA sesión (vuelta
  // de ficha o de la lista de playas) firma igual y no resetea;
  // una apertura nueva firma distinto y sincroniza
  const openSig = visible
    ? `${session}|${initialView}${initialCause ?? ''}`
    : '';
  const [lastSig, setLastSig] = useState('');
  if (openSig && openSig !== lastSig) {
    setLastSig(openSig);
    setView(initialView);
    setCause(initialCause ?? 'all');
    // Abre en el año vigente si hay datos; si aún no tiene episodios
    // cae al último año con datos, y sin años al histórico completo
    const latest = latestEpisodeYear(episodes);
    setSelYear(latest ?? seasonYear());
    setHistMode(latest === null);
    setSelMuni(null);
    setOpenFilter(null);
    // Sesión nueva = ranking: el detalle abierto también se resetea
    // (cerrar con ✕ y reabrir caía dentro del municipio anterior con
    // los filtros ya reseteados — ni resumía ni empezaba de cero)
    setDetail(null);
  }

  // Episodios del año natural seleccionado (solape) — base del
  // ranking anual y de la cronología con ventana "Todo el año"
  const yearAll = useMemo(
    () => yearEpisodes(episodes, selYear),
    [episodes, selYear],
  );

  // Cronología — la ventana la decide la pestaña y se compone con el
  // año/histórico: en «Verano» el histórico son TODOS los veranos
  // registrados; en «Año» todo el registro
  const veranoRows = useMemo(
    () =>
      histMode ? summerEpisodes(episodes) : seasonEpisodes(episodes, selYear),
    [histMode, episodes, selYear],
  );
  const winRows = useMemo(
    () => (view === 'verano' ? veranoRows : histMode ? episodes : yearAll),
    [view, veranoRows, histMode, episodes, yearAll],
  );
  // Chips de Tipo: cuentan la ventana sin tocar Tipo/Causa (la cara
  // de cada faceta ya lleva el conteo del resultado filtrado)
  const tipoCounts = useMemo(
    () => ({
      closures: winRows.filter((e) => e.kind === 'closure').length,
      warnings: winRows.filter((e) => e.kind !== 'closure').length,
      active: winRows.filter((e) => e.closed_at === null).length,
    }),
    [winRows],
  );
  // Familias de causa de la ventana — alimentan las chips de Causa
  // en cronología (en ranking el ámbito lo marca causaScope)
  const scopeCauses = useMemo(
    () => causeFamilyCounts(winRows.filter((e) => e.kind === 'closure')),
    [winRows],
  );
  // Lista final de la cronología: ventana × tipo × causa. Las que
  // siguen abiertas van primero — una playa cerrada hoy importa más
  // que su fecha de inicio (Benijo: abierta desde 2024)
  const episodeRows = useMemo(
    () =>
      winRows
        .filter((e) =>
          tipoFilter === 'all'
            ? true
            : tipoFilter === 'active'
              ? e.closed_at === null
              : e.kind === tipoFilter,
        )
        .filter((e) =>
          cause === 'all'
            ? true
            : e.kind === 'closure' &&
              (cause === 'sin causa'
                ? !e.cause
                : causeFamily(e.cause) === cause),
        )
        .sort(
          (a, b) =>
            (a.closed_at === null ? 0 : 1) - (b.closed_at === null ? 0 : 1) ||
            b.opened_at.localeCompare(a.opened_at),
        ),
    [winRows, tipoFilter, cause],
  );

  // Ámbito de la causa en el ranking: Histórico = todo el registro,
  // modo-año = ese año
  const causeScope = view === 'ranking' && histMode ? episodes : yearAll;
  const yearCauses = useMemo(
    () => causeFamilyCounts(causeScope.filter((e) => e.kind === 'closure')),
    [causeScope],
  );
  const muniCauseCount = useMemo(
    () => muniCauseCounts(causeScope, cause),
    [causeScope, cause],
  );

  // Años con datos para el selector (compartido por las tres vistas:
  // en ranking decide a qué año se aplica el filtro de causa — y con
  // un año pasado el ranking entero pasa a modo-año)
  const years = useMemo(() => episodeYears(episodes), [episodes]);
  // Si la lista de años crece más allá de MAX_YEAR_CHIPS solo quedan
  // visibles los recientes y el resto se pliega tras "Más años ›" —
  // Histórico va fijo al final y nunca se traga el scroll. Si el año
  // seleccionado está oculto se despliega solo (sin botón muerto)
  const visibleYears = useMemo(() => {
    const recent = years.slice(0, MAX_YEAR_CHIPS);
    const canCollapse =
      years.length > MAX_YEAR_CHIPS && recent.includes(selYear);
    return canCollapse && !showAllYears ? recent : years;
  }, [years, showAllYears, selYear]);
  const canCollapseYears =
    years.length > MAX_YEAR_CHIPS &&
    years.slice(0, MAX_YEAR_CHIPS).includes(selYear);
  // Conteo de episodios por chip de año: en la pestaña «Verano»
  // cuenta los de jun-sep; en el resto los del año natural
  const chipCounts = useMemo(() => {
    const m = new globalThis.Map<number, number>();
    for (const y of years)
      m.set(
        y,
        (view === 'verano' ? seasonEpisodes : yearEpisodes)(episodes, y).length,
      );
    return m;
  }, [episodes, years, view]);
  const curYear = new Date().getFullYear();
  // El detalle se acota al año salvo en histórico (muestra todo). Las
  // FILAS del ranking narran siempre episodios del ámbito activo —
  // el histórico agrega el registro completo, no el estado vivo
  const isYearMode = view === 'ranking' && !histMode;
  const epRowMode = view === 'ranking';
  const epScope = histMode ? episodes : yearAll;
  const yearMuni = useMemo(() => yearMuniCounts(epScope), [epScope]);

  useEffect(() => {
    let cancelled = false;
    fetchBeachStats()
      .then(
        (rows) =>
          !cancelled && setStats(new Map(rows.map((s) => [s.beach_id, s]))),
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(
    // Con una causa activa solo quedan los municipios que sufrieron
    // cierres de ese tipo en el año seleccionado
    () =>
      buildMuniRows(beaches, stats).filter(
        (m) => cause === 'all' || muniCauseCount.has(m.municipality),
      ),
    [beaches, stats, cause, muniCauseCount],
  );

  // Ranking: las filas muestran los episodios del ámbito activo
  // (año seleccionado o histórico completo), no el estado vivo —
  // solo municipios que sufrieron algo, por severidad del periodo
  const displayRows = useMemo(() => {
    if (!epRowMode) return rows;
    return rows
      .map((m) => {
        const y = yearMuni.get(m.municipality);
        return {
          ...m,
          yearClosures: y?.closures ?? 0,
          yearWarnings: y?.warnings ?? 0,
          yearActive: y?.active ?? 0,
          yearBeaches: [...(y?.beaches ?? [])].sort(),
        };
      })
      .filter((m) => (m.yearClosures ?? 0) + (m.yearWarnings ?? 0) > 0)
      .sort(
        (a, b) =>
          yearScoreOf(b) - yearScoreOf(a) || a.name.localeCompare(b.name),
      );
  }, [rows, yearMuni, epRowMode]);

  // Índice de municipios para la faceta — del ámbito activo
  // (histórico o año), alfabético para saltar sin escribir
  const muniNames = useMemo(
    () => displayRows.map((m) => m.name).sort((a, b) => a.localeCompare(b)),
    [displayRows],
  );

  // Buscador: filtra la vista activa (Histórico o año) por nombre;
  // la faceta Municipio acota a uno concreto si hay selección
  const muniQ = searchNorm(muniQuery);
  const filteredRows = useMemo(
    () =>
      displayRows
        .filter((m) => selMuni === null || m.name === selMuni)
        .filter((m) => !muniQ || searchNorm(m.name).includes(muniQ)),
    [displayRows, muniQ, selMuni],
  );

  const maxScore = Math.max(
    1,
    ...displayRows.map((m) => (epRowMode ? yearScoreOf(m) : scoreOf(m))),
  );

  // Coordenadas por beach_id para la miniatura satélite de cada
  // episodio de la cronología (misma foto Esri que BeachList)
  const coordsById = useMemo(() => {
    const m = new Map<number, [number, number]>();
    for (const f of beaches) {
      m.set(f.id, f.geometry.coordinates);
    }
    return m;
  }, [beaches]);

  // Facetas del acordeón — contextuales a la vista activa (el
  // conmutador va primero y decide qué filtros existen, no al revés):
  // ranking → Año (con Histórico dentro) + Causa;
  // verano/año → Año + Tipo + Causa
  const causeList = view === 'ranking' ? yearCauses : scopeCauses;
  const causeRows =
    view === 'ranking' ? filteredRows.length : episodeRows.length;
  type FacetTab = {
    key: 'año' | 'tipo' | 'causa';
    label: string;
    value: string;
    count: number | null;
  };
  const facetTabs = (
    [
      view === 'ranking' &&
        muniNames.length > 1 && {
          key: 'municipio',
          label: 'Municipio',
          value: selMuni ?? 'Todos',
          count: null,
        },
      years.length > 1 && {
        key: 'año',
        label: 'Año',
        value: histMode ? 'Histórico' : `${selYear}`,
        count: histMode
          ? view === 'ranking'
            ? episodes.length
            : winRows.length
          : (chipCounts.get(selYear) ?? 0),
      },
      view !== 'ranking' &&
        winRows.length > 0 && {
          key: 'tipo',
          label: 'Tipo',
          value:
            tipoFilter === 'all'
              ? 'Todos'
              : (
                  {
                    closure: 'Cierres',
                    warning: 'Avisos',
                    active: 'Activas',
                  } as const
                )[tipoFilter],
          count: tipoFilter === 'all' ? null : episodeRows.length,
        },
      causeList.length > 0 && {
        key: 'causa',
        label: 'Causa',
        value: cause === 'all' ? 'Todos' : cause,
        count: cause === 'all' ? null : causeRows,
      },
    ] as (FacetTab | false)[]
  ).filter((t): t is FacetTab => Boolean(t));

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={detail ? () => setDetail(null) : onClose}
    >
      <View style={styles.container}>
        {detail ? (
          <MuniDetail
            detail={detail}
            beaches={beaches}
            isYearMode={isYearMode}
            selYear={selYear}
            yearCause={cause}
            onSelect={onSelect}
            onSelectBeach={onSelectBeach}
            onBack={() => setDetail(null)}
          />
        ) : (
          <>
            <ImageBackground
              source={require('../assets/gradient-sea.png')}
              style={styles.headerBlock}
              resizeMode="cover"
            >
              <View style={styles.header}>
                <Text style={[styles.title, { flex: 1, textAlign: 'center' }]}>
                  Incidencias de baño
                </Text>
                <Pressable
                  onPress={onClose}
                  hitSlop={12}
                  style={({ pressed }) => [
                    styles.closeBtn,
                    pressed && styles.pressFx,
                  ]}
                >
                  <Text style={styles.close}>✕</Text>
                </Pressable>
              </View>
              <Text style={styles.subtitle}>
                Cierres y avisos de baño en Tenerife
              </Text>
            </ImageBackground>

            {/* El conmutador decide qué estás mirando — va primero, y
                debajo solo las facetas que aplican a esa vista */}
            <View style={styles.viewToggle}>
              {(['ranking', 'verano', 'año'] as const).map((v) => (
                <Pressable
                  key={v}
                  style={({ pressed }) => [
                    styles.viewTab,
                    view === v && styles.viewTabOn,
                    pressed && styles.pressFx,
                  ]}
                  onPress={() => {
                    setView(v);
                    setOpenFilter(null);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    v === 'ranking'
                      ? 'Ver por municipio'
                      : v === 'verano'
                        ? 'Ver episodios de verano'
                        : 'Ver episodios del año'
                  }
                >
                  <Text
                    style={[styles.viewTabText, view === v && styles.viewTabOn]}
                  >
                    {v === 'ranking'
                      ? 'Por municipio'
                      : v === 'verano'
                        ? 'Verano'
                        : 'Año'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {facetTabs.length > 0 && (
              <View style={styles.filterTabs}>
                {facetTabs.map((t) => {
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
            )}
            {openFilter !== null && <View style={styles.filterBarDivider} />}
            {openFilter === 'municipio' && view === 'ranking' && (
              <ScrollChips
                style={styles.seasonChipsWrap}
                contentContainerStyle={styles.seasonChips}
                a11yLabel="municipios"
              >
                <Pressable
                  style={({ pressed }) => [
                    styles.seasonChip,
                    selMuni === null && styles.seasonChipOn,
                    pressed && styles.pressFx,
                  ]}
                  onPress={() => {
                    setSelMuni(null);
                    setOpenFilter(null);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Ver todos los municipios"
                >
                  <Text
                    style={[
                      styles.seasonChipText,
                      selMuni === null && styles.seasonChipTextOn,
                    ]}
                  >
                    Todos
                  </Text>
                </Pressable>
                {muniNames.map((name) => (
                  <Pressable
                    key={name}
                    style={({ pressed }) => [
                      styles.seasonChip,
                      selMuni === name && styles.seasonChipOn,
                      pressed && styles.pressFx,
                    ]}
                    onPress={() => {
                      setSelMuni(name);
                      setOpenFilter(null);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Ver solo ${name}`}
                  >
                    <Text
                      style={[
                        styles.seasonChipText,
                        selMuni === name && styles.seasonChipTextOn,
                      ]}
                    >
                      {name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollChips>
            )}
            {openFilter === 'año' && (
              <YearChips
                summer={view === 'verano'}
                visibleYears={visibleYears}
                selYear={selYear}
                histMode={histMode}
                chipCounts={chipCounts}
                totalEpisodes={
                  view === 'verano' ? veranoRows.length : episodes.length
                }
                showAllYears={showAllYears}
                canCollapse={canCollapseYears}
                onPickYear={(y) => {
                  setSelYear(y);
                  setHistMode(false);
                  setOpenFilter(null);
                }}
                onToggleAll={() => setShowAllYears((v) => !v)}
                onHistoric={() => {
                  setHistMode(true);
                  setOpenFilter(null);
                }}
              />
            )}
            {openFilter === 'tipo' && view !== 'ranking' && (
              <SeasonFilterChips
                counts={tipoCounts}
                filter={tipoFilter}
                onChange={(f) => {
                  setTipoFilter(f);
                  setOpenFilter(null);
                }}
              />
            )}
            {openFilter === 'causa' && (
              <CauseChips
                causes={causeList}
                active={cause}
                onChange={(c) => {
                  setCause(c);
                  setOpenFilter(null);
                }}
              />
            )}

            {view === 'ranking' && (
              <View style={styles.searchWrap}>
                <Image
                  source={require('../assets/icons/icon-search.png')}
                  style={styles.searchIcon}
                />
                <TextInput
                  style={styles.search}
                  placeholder="Busca un municipio…"
                  placeholderTextColor={colors.textFaint}
                  value={muniQuery}
                  onChangeText={setMuniQuery}
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                  accessibilityLabel="Buscar municipio por nombre"
                />
              </View>
            )}

            {view !== 'ranking' ? (
              <FlatList
                data={episodeRows}
                keyExtractor={(ep) => `s${ep.id}-${ep.beach_id}`}
                style={styles.list}
                contentContainerStyle={styles.listContent}
                renderItem={({ item: ep }) => (
                  <EpisodeRow
                    ep={ep}
                    coords={coordsById.get(ep.beach_id) ?? null}
                    onPress={() =>
                      onSelectBeach?.(ep.beach_id, {
                        beach_id: ep.beach_id,
                        id: ep.id,
                        opened_at: ep.opened_at,
                      })
                    }
                  />
                )}
                ListEmptyComponent={
                  !histMode &&
                  view === 'verano' &&
                  selYear === curYear &&
                  new Date().getMonth() < 5 ? (
                    // La temporada jun-sep aún no ha empezado: la lista
                    // vacía sería ambigua — ofrecer la última completada
                    <View style={styles.emptyWrap}>
                      <Text style={styles.emptyNote}>
                        El verano {selYear} aún no ha comenzado
                      </Text>
                      <Pressable
                        style={({ pressed }) => [
                          styles.emptyCta,
                          pressed && styles.pressFx,
                        ]}
                        onPress={() => setSelYear(selYear - 1)}
                        accessibilityRole="button"
                        accessibilityLabel={`Ver Verano ${selYear - 1}`}
                      >
                        <Text style={styles.emptyCtaText}>
                          Ver Verano {selYear - 1}
                        </Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Text style={styles.empty}>
                      {histMode
                        ? 'Sin episodios registrados'
                        : view === 'verano'
                          ? 'Sin episodios este verano'
                          : `Sin episodios en ${selYear}`}
                    </Text>
                  )
                }
              />
            ) : (
              <FlatList
                data={filteredRows}
                keyExtractor={(m) => m.name}
                ListEmptyComponent={
                  <Text style={styles.empty}>
                    {muniQ
                      ? `Sin municipios que coincidan con “${muniQuery.trim()}”`
                      : histMode
                        ? 'Sin episodios registrados'
                        : `Sin episodios en ${selYear}`}
                  </Text>
                }
                style={styles.list}
                contentContainerStyle={styles.listContent}
                renderItem={({ item, index }) => (
                  <MuniRow
                    m={item}
                    index={index}
                    total={filteredRows.length}
                    isYearMode={epRowMode}
                    histMode={histMode}
                    selYear={selYear}
                    yearCause={cause}
                    causeCount={muniCauseCount.get(item.municipality) ?? 0}
                    maxScore={maxScore}
                    onPress={() => setDetail(item)}
                  />
                )}
              />
            )}
          </>
        )}
      </View>
    </Modal>
  );
}

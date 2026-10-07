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
  yearLineText,
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
import MuniDetail from './stats/MuniDetail';
import MuniRow from './stats/MuniRow';
import { styles } from './stats/statsStyles';

export default function MunicipalityStats({
  visible,
  beaches,
  episodes = [],
  initialView = 'ranking',
  initialCause = null,
  onSelect,
  onSelectBeach,
  onClose,
}: {
  visible: boolean;
  beaches: GeoFeature[];
  // Episodios insulares (/episodes): cabecera anual + vista Temporada
  episodes?: MunicipalityIncident[];
  // "temporada"/"year" abren el panel directo en la vista cronológica
  // (enlace del banner de alertas / drill-down del desglose por causa)
  initialView?: 'ranking' | 'temporada' | 'year';
  // Causa preseleccionada en la vista "Este año" (toque en el
  // paréntesis del banner: "7 mar agitado" → abre filtrado)
  initialCause?: string | null;
  onSelect: (municipality: string | null) => void;
  // Tocar un incidente de la línea temporal abre la ficha de su playa
  onSelectBeach?: (beachId: number) => void;
  onClose: () => void;
}) {
  const [stats, setStats] = useState<Map<number, BeachStats>>(new Map());
  const [detail, setDetail] = useState<MuniStats | null>(null);
  const [view, setView] = useState<'ranking' | 'temporada' | 'year'>(
    initialView,
  );
  // Año seleccionado en las vistas cronológicas (verano/año) —
  // por defecto el vigente; las chips de año lo cambian
  const [selYear, setSelYear] = useState(seasonYear());
  // Ranking: 'Histórico' (vivo + histórico total) vs modo-año al elegir
  // un año en las chips. Abre en el año vigente — lo que interesa es
  // el ahora; el histórico completo queda como último chip
  const [histMode, setHistMode] = useState(false);
  // Buscador de municipio en el ranking (filtro por nombre)
  const [muniQuery, setMuniQuery] = useState('');
  // Filtro de chips de la vista Temporada: cierres | avisos | activas
  const [seasonFilter, setSeasonFilter] = useState<SeasonFilter>('all');
  // Filtro de causa de la vista Temporada (familias: contaminación,
  // riesgo estructural…) — segundo nivel tras cierres/avisos/activas
  const [seasonCause, setSeasonCause] = useState<string>('all');
  // Filtro de chips de la vista "Este año": por causa ('all' = todas)
  const [yearCause, setYearCause] = useState<string>(initialCause ?? 'all');
  // Chips de año plegadas tras "Más años ›" cuando hay más de
  // MAX_YEAR_CHIPS — los antiguos no compiten con el ahora
  const [showAllYears, setShowAllYears] = useState(false);

  // El modal vive montado (conserva scroll/estado): al abrirlo manda
  // la vista pedida, no la última visitada
  useEffect(() => {
    if (!visible) return;
    setView(initialView);
    setYearCause(initialCause ?? 'all');
    setSeasonCause('all');
    // Ranking abre en "Este año" si hay datos; si el año vigente aún
    // no tiene episodios cae al último año con datos, y sin años al
    // histórico completo
    const latest = latestEpisodeYear(episodes);
    setSelYear(latest ?? seasonYear());
    setHistMode(latest === null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialView, initialCause]);

  const seasonRows = useMemo(
    () =>
      seasonEpisodes(episodes, selYear).sort((a, b) =>
        b.opened_at.localeCompare(a.opened_at),
      ),
    [episodes, selYear],
  );
  // Familias de causa presentes en los cierres de la temporada —
  // alimentan las chips que dividen cierres en contaminación vs
  // estructural (misma taxonomía que las chips de "Este año")
  const seasonCauses = useMemo(
    () => causeFamilyCounts(seasonRows.filter((e) => e.kind === 'closure')),
    [seasonRows],
  );
  // Las que siguen abiertas van primero — una playa cerrada hoy
  // importa más que su fecha de inicio (Benijo: abierta desde 2024)
  const seasonRowsFiltered = useMemo(
    () =>
      seasonRows
        .filter((e) =>
          seasonFilter === 'all'
            ? true
            : seasonFilter === 'active'
              ? e.closed_at === null
              : e.kind === seasonFilter,
        )
        .filter((e) =>
          seasonCause === 'all'
            ? true
            : e.kind === 'closure' &&
              (seasonCause === 'sin causa'
                ? !e.cause
                : causeFamily(e.cause) === seasonCause),
        )
        .sort(
          (a, b) =>
            (a.closed_at === null ? 0 : 1) - (b.closed_at === null ? 0 : 1) ||
            b.opened_at.localeCompare(a.opened_at),
        ),
    [seasonRows, seasonFilter, seasonCause],
  );
  const seasonCounts = useMemo(
    () => ({
      closures: seasonRows.filter((e) => e.kind === 'closure').length,
      warnings: seasonRows.filter((e) => e.kind !== 'closure').length,
      active: seasonRows.filter((e) => e.closed_at === null).length,
    }),
    [seasonRows],
  );

  // Vista "Este año": todos los episodios del año natural (solape),
  // filtrables por causa con chips. Activas primero, igual que Verano
  const yearAll = useMemo(
    () => yearEpisodes(episodes, selYear),
    [episodes, selYear],
  );
  // Ámbito de las chips de causa y su filtro: en ranking siguen a la
  // vista activa (Histórico = todo el registro, modo-año = ese año);
  // en la vista "Este año" siempre el año seleccionado
  const causeScope = view === 'ranking' && histMode ? episodes : yearAll;
  const yearCauses = useMemo(
    () => causeFamilyCounts(causeScope.filter((e) => e.kind === 'closure')),
    [causeScope],
  );
  const yearRows = useMemo(
    () =>
      yearAll
        .filter((e) =>
          yearCause === 'all'
            ? true
            : e.kind === 'closure' &&
              (yearCause === 'sin causa'
                ? !e.cause
                : causeFamily(e.cause) === yearCause),
        )
        .sort(
          (a, b) =>
            (a.closed_at === null ? 0 : 1) - (b.closed_at === null ? 0 : 1) ||
            b.opened_at.localeCompare(a.opened_at),
        ),
    [yearAll, yearCause],
  );
  const muniCauseCount = useMemo(
    () => muniCauseCounts(causeScope, yearCause),
    [causeScope, yearCause],
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
  // Conteo de episodios por chip de año: en Temporada cuenta los del
  // verano (jun-sep); en ranking/"Este año" los del año natural
  const chipCounts = useMemo(() => {
    const m = new globalThis.Map<number, number>();
    for (const y of years)
      m.set(
        y,
        (view === 'temporada' ? seasonEpisodes : yearEpisodes)(episodes, y)
          .length,
      );
    return m;
  }, [episodes, years, view]);
  const curYear = new Date().getFullYear();
  const isYearMode = view === 'ranking' && !histMode;
  const yearMuni = useMemo(() => yearMuniCounts(yearAll), [yearAll]);
  const yearLine = useMemo(
    () => yearLineText(episodes, beaches, selYear, isYearMode, years),
    [episodes, beaches, selYear, isYearMode, years],
  );

  useEffect(() => {
    fetchBeachStats()
      .then((rows) => setStats(new Map(rows.map((s) => [s.beach_id, s]))))
      .catch(() => {});
  }, []);

  const rows = useMemo(
    // Con una causa activa solo quedan los municipios que sufrieron
    // cierres de ese tipo en el año seleccionado
    () =>
      buildMuniRows(beaches, stats).filter(
        (m) => yearCause === 'all' || muniCauseCount.has(m.municipality),
      ),
    [beaches, stats, yearCause, muniCauseCount],
  );

  // Ranking con un año pasado seleccionado: las filas muestran los
  // episodios DE ESE AÑO, no el estado vivo ni el histórico — solo
  // municipios que sufrieron algo ese año, por severidad anual
  const displayRows = useMemo(() => {
    if (!isYearMode) return rows;
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
  }, [rows, yearMuni, isYearMode]);

  // Buscador: filtra la vista activa (Histórico o año) por nombre
  const muniQ = searchNorm(muniQuery);
  const filteredRows = useMemo(
    () =>
      muniQ
        ? displayRows.filter((m) => searchNorm(m.name).includes(muniQ))
        : displayRows,
    [displayRows, muniQ],
  );

  const maxScore = Math.max(
    1,
    ...displayRows.map((m) => (isYearMode ? yearScoreOf(m) : scoreOf(m))),
  );

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
            yearCause={yearCause}
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
                  Incidencias por municipio
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
                {view === 'ranking'
                  ? isYearMode
                    ? `Ranking de ${selYear} · episodios del año por municipio`
                    : 'Ranking por afectación actual e histórica'
                  : view === 'temporada'
                    ? selYear === seasonYear()
                      ? 'Este verano'
                      : `Verano ${selYear}`
                    : selYear === new Date().getFullYear()
                      ? 'Este año'
                      : `Año ${selYear}`}
              </Text>
              {view === 'ranking' && yearLine && (
                <Text style={styles.yearLine}>{yearLine}</Text>
              )}
            </ImageBackground>

            {years.length > 1 && (
              <YearChips
                view={view}
                visibleYears={visibleYears}
                selYear={selYear}
                histMode={histMode}
                chipCounts={chipCounts}
                totalEpisodes={episodes.length}
                showAllYears={showAllYears}
                canCollapse={canCollapseYears}
                onPickYear={(y) => {
                  setSelYear(y);
                  if (view === 'ranking') setHistMode(false);
                }}
                onToggleAll={() => setShowAllYears((v) => !v)}
                onHistoric={() => setHistMode(true)}
              />
            )}
            {view === 'temporada' && seasonRows.length > 0 && (
              <SeasonFilterChips
                counts={seasonCounts}
                filter={seasonFilter}
                onChange={setSeasonFilter}
              />
            )}
            {view === 'temporada' && seasonCauses.length > 0 && (
              <CauseChips
                causes={seasonCauses}
                active={seasonCause}
                onChange={setSeasonCause}
              />
            )}
            {view !== 'temporada' && yearCauses.length > 0 && (
              <CauseChips
                causes={yearCauses}
                active={yearCause}
                onChange={setYearCause}
              />
            )}
            <View style={styles.viewToggle}>
              {(['ranking', 'temporada', 'year'] as const).map((v) => (
                <Pressable
                  key={v}
                  style={({ pressed }) => [
                    styles.viewTab,
                    view === v && styles.viewTabOn,
                    pressed && styles.pressFx,
                  ]}
                  onPress={() => setView(v)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    v === 'ranking'
                      ? 'Ver por municipio'
                      : v === 'temporada'
                        ? 'Ver temporada'
                        : 'Ver episodios del año'
                  }
                >
                  <Text
                    style={[
                      styles.viewTabText,
                      view === v && styles.viewTabTextOn,
                    ]}
                  >
                    {v === 'ranking'
                      ? 'Por municipio'
                      : v === 'temporada'
                        ? 'Este verano'
                        : 'Este año'}
                  </Text>
                </Pressable>
              ))}
            </View>

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
                data={view === 'temporada' ? seasonRowsFiltered : yearRows}
                keyExtractor={(ep) => `s${ep.id}-${ep.beach_id}`}
                style={styles.list}
                contentContainerStyle={styles.listContent}
                renderItem={({ item: ep }) => (
                  <EpisodeRow
                    ep={ep}
                    onPress={() => onSelectBeach?.(ep.beach_id)}
                  />
                )}
                ListEmptyComponent={
                  view === 'temporada' &&
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
                      {view === 'temporada'
                        ? 'Sin episodios este verano'
                        : 'Sin episodios este año'}
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
                      : isYearMode
                        ? `Sin episodios en ${selYear}`
                        : 'Sin datos de municipios'}
                  </Text>
                }
                style={styles.list}
                contentContainerStyle={styles.listContent}
                renderItem={({ item, index }) => (
                  <MuniRow
                    m={item}
                    index={index}
                    total={filteredRows.length}
                    isYearMode={isYearMode}
                    selYear={selYear}
                    yearCause={yearCause}
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

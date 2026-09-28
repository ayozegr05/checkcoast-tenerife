import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  ImageBackground,
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  BeachStats,
  GeoFeature,
  MunicipalityIncident,
  fetchBeachStats,
  fetchMunicipalityIncidents,
} from '../lib/api';
import {
  causeCounts,
  closuresThisYear,
  episodeDays,
  episodeYears,
  seasonEpisodes,
  seasonYear,
  yearEpisodes,
} from '../lib/episodes';
import { displayBeachName, searchNorm } from '../lib/format';
import { colors, fonts } from '../lib/theme';
import Skeleton from './Skeleton';
import ScrollChips from './ScrollChips';

type MuniStats = {
  municipality: string | null;
  name: string;
  beaches: number; // playas distintas (nombre base sin "PMx")
  points: number; // puntos de muestreo monitorizados
  closedNow: number;
  warningNow: number;
  incidents: number; // cierres + avisos históricos
  closuresLastYear: number;
  badSamples: number;
  // Modo-año (ranking con un año pasado seleccionado): episodios del
  // municipio en selYear — deduplicados por playa base en /episodes,
  // misma fuente que la vista "Este año"
  yearClosures?: number;
  yearWarnings?: number;
  yearActive?: number;
  yearBeaches?: string[]; // playas afectadas ese año
};

// Una playa extensa tiene varios puntos de muestreo (PM1, PM2...):
// para el conteo de playas agrupamos por nombre base
const baseName = (name: string) => name.replace(/\s+PM\d+$/, '');

type MuniAcc = Omit<MuniStats, 'beaches'> & { beachNames: Set<string> };

// Severidad: mandan las afectaciones activas (cierre pesa más que aviso);
// el histórico de incidentes y muestras no aptas desempata
const scoreOf = (m: MuniStats) =>
  m.closedNow * 100 + m.warningNow * 20 + m.incidents + m.badSamples;

const barColorOf = (m: MuniStats) =>
  m.closedNow > 0
    ? colors.status.closed
    : m.warningNow > 0
      ? colors.status.warning
      : colors.status.open;

// Círculo de posición: el podio usa el color de severidad del municipio
// (rojo = cierres ahora, naranja = avisos, azul = solo histórico) — el
// top 3 marca "los que peor están", no un premio. Neutro del 4º en adelante
const rankColorOf = (m: MuniStats, index: number) =>
  index < 3 ? barColorOf(m) : '#8fa3ad';

// Modo-año: un cierre pesa el triple que un aviso; la barra roja si
// hubo cierres, naranja si solo avisos
const yearScoreOf = (m: MuniStats) =>
  (m.yearClosures ?? 0) * 3 + (m.yearWarnings ?? 0);

const yearBarColorOf = (m: MuniStats) =>
  (m.yearClosures ?? 0) > 0
    ? colors.status.closed
    : colors.status.warning;

const fmtDate = (iso: string) => iso.split('-').reverse().join('/');

// Chips de año visibles antes de plegar el resto tras "Más años ›"
const MAX_YEAR_CHIPS = 4;

// Duración en días naturales incluyendo el día de apertura
const durationDays = (inc: MunicipalityIncident) => {
  const end = inc.closed_at ? new Date(inc.closed_at) : new Date();
  return Math.max(
    1,
    Math.round(
      (end.getTime() - new Date(inc.opened_at).getTime()) / 86400000,
    ) + 1,
  );
};

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
  const [incidents, setIncidents] = useState<MunicipalityIncident[] | null>(
    null,
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
  const [seasonFilter, setSeasonFilter] = useState<
    'all' | 'closure' | 'warning' | 'active'
  >('all');
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
    // Ranking abre en "Este año" si hay datos; si el año vigente aún
    // no tiene episodios cae al último año con datos, y sin años al
    // histórico completo
    const ys = episodeYears(episodes);
    const cy = new Date().getFullYear();
    setSelYear(ys.includes(cy) ? cy : (ys[0] ?? seasonYear()));
    setHistMode(ys.length === 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialView, initialCause]);

  const seasonRows = useMemo(
    () =>
      seasonEpisodes(episodes, selYear).sort((a, b) =>
        b.opened_at.localeCompare(a.opened_at),
      ),
    [episodes, selYear],
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
        .sort(
          (a, b) =>
            (a.closed_at === null ? 0 : 1) -
              (b.closed_at === null ? 0 : 1) ||
            b.opened_at.localeCompare(a.opened_at),
        ),
    [seasonRows, seasonFilter],
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
  const causeScope =
    view === 'ranking' && histMode ? episodes : yearAll;
  // Las chips de causa cuentan solo CIERRES — igual que el desglose
  // del banner ("14 cierres (7 mar agitado · ...)")
  const yearCauses = useMemo(
    () => causeCounts(causeScope.filter((e) => e.kind === 'closure')),
    [causeScope],
  );
  const yearRows = useMemo(
    () =>
      yearAll
        .filter((e) =>
          yearCause === 'all'
            ? true
            : e.kind === 'closure' &&
              (yearCause === 'sin causa' ? !e.cause : e.cause === yearCause),
        )
        .sort(
          (a, b) =>
            (a.closed_at === null ? 0 : 1) -
              (b.closed_at === null ? 0 : 1) ||
            b.opened_at.localeCompare(a.opened_at),
        ),
    [yearAll, yearCause],
  );
  // Municipios con cierres de la causa activa en el año seleccionado:
  // en "Por municipio" las chips también filtran el ranking — solo
  // quedan los municipios que sufrieron ese tipo de episodio
  const muniCauseCount = useMemo(() => {
    const m = new Map<string | null, number>();
    if (yearCause === 'all') return m;
    for (const e of causeScope) {
      if (e.kind !== 'closure') continue;
      const hit =
        yearCause === 'sin causa' ? !e.cause : e.cause === yearCause;
      if (!hit) continue;
      m.set(e.municipality, (m.get(e.municipality) ?? 0) + 1);
    }
    return m;
  }, [causeScope, yearCause]);

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
        (view === 'temporada' ? seasonEpisodes : yearEpisodes)(
          episodes,
          y,
        ).length,
      );
    return m;
  }, [episodes, years, view]);
  const curYear = new Date().getFullYear();
  const isYearMode = view === 'ranking' && !histMode;
  // Episodios del año seleccionado por municipio: /episodes ya viene
  // deduplicado por playa base (un cluster por playa física, no por
  // PM — el megacierre de Jardín en PM1/PM4/PM5 cuenta una vez)
  const yearMuni = useMemo(() => {
    const m = new Map<
      string | null,
      {
        closures: number;
        warnings: number;
        active: number;
        beaches: Set<string>;
      }
    >();
    for (const e of yearAll) {
      const c = m.get(e.municipality) ?? {
        closures: 0,
        warnings: 0,
        active: 0,
        beaches: new Set<string>(),
      };
      if (e.kind === 'closure') c.closures += 1;
      else c.warnings += 1;
      if (e.closed_at === null) c.active += 1;
      c.beaches.add(displayBeachName(e.beach_name));
      m.set(e.municipality, c);
    }
    return m;
  }, [yearAll]);
  const yearLine = useMemo(() => {
    // "Activas" = alertas VIVAS (estado efectivo), no episodios sin
    // cerrar: un cierre estructural sin prensa fresca sigue vivo aunque
    // su episodio tenga fin estimado (Benijo, Gaviotas, Garachico)
    const live = beaches.filter(
      (f) =>
        f.properties.status === 'closed' ||
        f.properties.status === 'warning',
    ).length;
    if (!isYearMode) {
      // Histórico: registro completo — totales, causas de los cierres
      // y desde qué año hay datos (mediciones Náyade desde ene-2023)
      const closures = episodes.filter((e) => e.kind === 'closure');
      const warnings = episodes.length - closures.length;
      if (closures.length === 0 && warnings === 0) return null;
      const firstYear = years[years.length - 1];
      const parts = [
        `${closures.length} ${closures.length === 1 ? 'cierre' : 'cierres'}`,
      ];
      if (warnings)
        parts.push(
          `${warnings} ${warnings === 1 ? 'aviso' : 'avisos'}`,
        );
      let line = parts.join(' · ');
      if (firstYear) line += ` desde ${firstYear}`;
      if (live)
        line += ` · ${live} ${live === 1 ? 'activa' : 'activas'} ahora`;
      return line;
    }
    const n = closuresThisYear(episodes, selYear).length;
    if (n === 0) return null;
    return `${selYear} · ${n} ${n === 1 ? 'cierre' : 'cierres'}`;
  }, [episodes, beaches, selYear, isYearMode, years]);

  // Vista Temporada: los conteos son los chips-filtro (cierres /
  // avisos / activas ahora), no una línea de texto

  useEffect(() => {
    fetchBeachStats()
      .then((rows) => setStats(new Map(rows.map((s) => [s.beach_id, s]))))
      .catch(() => {});
  }, []);

  // Línea temporal de incidentes del municipio abierto; solo las playas
  // monitorizadas tienen incidentes, así que "Sin municipio" no tiene
  useEffect(() => {
    setIncidents(null);
    // "Sin municipio" no tiene incidentes oficiales pero puede tener
    // alertas de prensa (playas OSM): lista vacía, no skeleton eterno
    if (!detail?.municipality) {
      setIncidents([]);
      return;
    }
    fetchMunicipalityIncidents(detail.municipality)
      .then(setIncidents)
      .catch(() => setIncidents([]));
  }, [detail]);

  // Línea temporal del municipio abierto: el backend ya devuelve
  // incidentes oficiales + eventos reconstruidos (analítica/prensa).
  // Solo "Sin municipio" necesita síntesis en cliente: el endpoint
  // no puede filtrar por municipio NULL
  const detailRows = useMemo<MunicipalityIncident[]>(() => {
    if (!detail) return [];
    const official = incidents ?? [];
    const pressRows: MunicipalityIncident[] = detail.municipality
      ? [] // solo "Sin municipio" sintetiza alertas de prensa en cliente
      : beaches
          .filter(
            (f) =>
              (f.properties.municipality ?? 'Sin municipio') ===
                detail.name && f.properties.alert === true,
          )
          .map((f) => ({
            id: -f.id, // id negativo: no colisiona con incidentes reales
            beach_id: f.id,
            beach_name: f.properties.name,
            municipality: detail.municipality,
            kind:
              f.properties.status === 'warning'
                ? ('warning' as const)
                : ('closure' as const),
            opened_at: (f.properties.reported_at ?? '').slice(0, 10),
            closed_at: null,
            observations:
              'Según prensa — sin incidente oficial en Náyade',
            via: 'press',
          }));
    return [...official, ...pressRows]
      .sort((a, b) =>
        (b.opened_at ?? '').localeCompare(a.opened_at ?? ''),
      )
      // Con una causa activa el detalle muestra solo esos episodios
      .filter((inc) =>
        yearCause === 'all'
          ? true
          : yearCause === 'sin causa'
            ? !inc.cause
            : inc.cause === yearCause,
      )
      // En modo-año la línea temporal solo muestra episodios que
      // tocaron ese año (mismo solape que yearEpisodes)
      .filter(
        (inc) =>
          !isYearMode ||
          ((inc.opened_at ?? '') <= `${selYear}-12-31` &&
            (inc.closed_at === null ||
              inc.closed_at >= `${selYear}-01-01`)),
      );
  }, [detail, incidents, beaches, yearCause, isYearMode, selYear]);

  // Estado vivo por playa: un incidente abierto cuyo observations no
  // dice "prohibido" se clasifica como aviso, pero si la playa está
  // cerrada ahora mismo el badge debe decir "Cierre activo"
  const liveStatus = useMemo(
    () =>
      new Map(
        beaches.map((f) => [f.id, f.properties.status ?? 'unknown']),
      ),
    [beaches],
  );

  const rows = useMemo(() => {
    const byMuni = new Map<string, MuniAcc>();
    for (const f of beaches) {
      const municipality = f.properties.municipality ?? null;
      const name = municipality ?? 'Sin municipio';
      const m =
        byMuni.get(name) ?? {
          municipality,
          name,
          beachNames: new Set<string>(),
          points: 0,
          closedNow: 0,
          warningNow: 0,
          incidents: 0,
          closuresLastYear: 0,
          badSamples: 0,
        };
      // El conteo de playas incluye todas las catalogadas;
      // solo las monitorizadas tienen estado oficial ni stats
      m.beachNames.add(baseName(f.properties.name));
      // El estado vivo cuenta para TODAS las playas: una OSM cerrada
      // según prensa (Benijo) también es una afectación real. Los
      // puntos de muestreo y el histórico sí son solo de monitorizadas
      if (f.properties.status === 'closed') m.closedNow += 1;
      else if (f.properties.status === 'warning') m.warningNow += 1;
      if (f.properties.monitored !== false) {
        m.points += 1;
        const st = stats.get(f.id);
        if (st) {
          m.incidents += st.closures + st.warnings;
          m.closuresLastYear += st.closures_last_year;
          m.badSamples += st.bad_samples;
        }
      }
      // Los episodios reconstruidos (analítica sin incidencia, cierres
      // solo en prensa) cuentan como incidentes reales también en las
      // playas no monitorizadas — Benijo cerró de verdad
      const st = stats.get(f.id);
      if (st?.reconstructed) m.incidents += st.reconstructed;
      byMuni.set(name, m);
    }
    return [...byMuni.values()]
      .map(({ beachNames, ...m }): MuniStats => ({
        ...m,
        beaches: beachNames.size,
      }))
      // Con una causa activa solo quedan los municipios que sufrieron
      // cierres de ese tipo en el año seleccionado
      .filter(
        (m) => yearCause === 'all' || muniCauseCount.has(m.municipality),
      )
      .sort(
        (a, b) => scoreOf(b) - scoreOf(a) || a.name.localeCompare(b.name),
      );
  }, [beaches, stats, yearCause, muniCauseCount]);

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
      .filter(
        (m) => (m.yearClosures ?? 0) + (m.yearWarnings ?? 0) > 0,
      )
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

  const score = (m: MuniStats) =>
    isYearMode ? yearScoreOf(m) : scoreOf(m);
  const barColor = (m: MuniStats) =>
    isYearMode ? yearBarColorOf(m) : barColorOf(m);
  const maxScore = Math.max(1, ...displayRows.map(score));

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={detail ? () => setDetail(null) : onClose}
    >
      <View style={styles.container}>
        {detail ? (
          <>
            <ImageBackground
              source={require('../assets/gradient-sea.png')}
              style={styles.headerBlock}
              resizeMode="cover"
            >
              <View style={styles.header}>
                <Pressable
                  onPress={() => setDetail(null)}
                  hitSlop={12}
                  style={({ pressed }) => [
                    styles.backBtn,
                    styles.closeBtn,
                    pressed && styles.pressFx,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Volver al ranking"
                >
                  <Text style={styles.backText}>‹</Text>
                </Pressable>
                <Text style={styles.title} numberOfLines={1}>
                  {detail.name}
                </Text>
                <Pressable
                  onPress={() => onSelect(detail.municipality)}
                  style={({ pressed }) => [
                    styles.listBtn,
                    pressed && styles.pressFx,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Ver playas del municipio"
                >
                  <Text style={styles.listBtnText}>Ver playas</Text>
                </Pressable>
              </View>
              <Text style={styles.subtitle}>
                Línea temporal de incidentes
                {isYearMode ? ` · ${selYear}` : ''} · más reciente
                primero
              </Text>
            </ImageBackground>

            <FlatList
              data={detailRows}
              keyExtractor={(inc) => String(inc.id)}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              renderItem={({ item: inc, index }) => {
                // Solo un incidente sin fecha de cierre está "activo":
                // el badge sólido se reserva a ese caso — los
                // históricos van en outline para no leerse como vivos
                const active = inc.closed_at === null;
                // "Sin Calificar" = Náyade abrió ficha por una muestra
                // pendiente de clasificar (p.ej. San Marcos por la
                // pérdida de arena): no es ni cierre ni aviso real
                const unclassified = /sin\s*calificar/i.test(
                  inc.observations ?? '',
                );
                // En incidentes vivos manda el estado actual de la
                // playa (p.ej. Gaviotas: incidencia "aviso" pero la
                // playa está cerrada por muestra no apta)
                const live = liveStatus.get(inc.beach_id);
                const kind =
                  active && (live === 'closed' || live === 'warning')
                    ? live === 'closed'
                      ? 'closure'
                      : 'warning'
                    : inc.kind;
                return (
                  <View style={styles.tlItem}>
                    <View style={styles.tlRail}>
                      <View
                        style={[
                          styles.tlDot,
                          !active && styles.tlDotEnded,
                          active && {
                            backgroundColor:
                              kind === 'closure'
                                ? colors.status.closed
                                : colors.status.warning,
                          },
                        ]}
                      />
                      {index < detailRows.length - 1 && (
                        <View style={styles.tlLine} />
                      )}
                    </View>
                    <Pressable
                      style={({ pressed }) => [
                        styles.tlBody,
                        pressed && styles.pressFx,
                      ]}
                      onPress={() => onSelectBeach?.(inc.beach_id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Ver ficha de ${displayBeachName(
                        inc.beach_name,
                      )}`}
                    >
                      <View style={styles.tlHeader}>
                        <Text style={styles.tlBeach} numberOfLines={1}>
                          {displayBeachName(inc.beach_name)}
                        </Text>
                        <Text
                          style={[
                            styles.badge,
                            active
                              ? kind === 'closure'
                                ? styles.badgeClosed
                                : styles.badgeWarning
                              : styles.badgeEnded,
                          ]}
                        >
                          {unclassified
                            ? 'Pendiente'
                            : kind === 'closure'
                              ? 'Cierre'
                              : 'Aviso'}
                          {active && !unclassified ? ' activo' : ''}
                        </Text>
                        <Text style={styles.tlGo}>›</Text>
                      </View>
                      <Text style={styles.tlDates}>
                        {inc.opened_at ? fmtDate(inc.opened_at) : '—'}
                        {' → '}
                        {inc.closed_at
                          ? `${
                              inc.end_estimated ? '~' : ''
                            }${fmtDate(inc.closed_at)}`
                          : 'activo'}
                        {inc.opened_at && !inc.end_estimated
                          ? ` · ${durationDays(inc)} ${
                              durationDays(inc) === 1 ? 'día' : 'días'
                            }`
                          : ''}
                      </Text>
                      {inc.observations ? (
                        <Text style={styles.tlObs}>
                          {inc.observations}
                        </Text>
                      ) : null}
                    </Pressable>
                  </View>
                );
              }}
              ListEmptyComponent={
                incidents === null ? (
                  <View>
                    {[0, 1, 2].map((i) => (
                      <View key={i} style={styles.tlItem}>
                        <View style={styles.tlRail}>
                          <Skeleton style={styles.tlDotSkeleton} />
                          {i < 2 && <View style={styles.tlLine} />}
                        </View>
                        <View style={styles.tlBody}>
                          <Skeleton style={styles.tlSkeletonTitle} />
                          <Skeleton style={styles.tlSkeletonLine} />
                          <Skeleton style={styles.tlSkeletonLineShort} />
                        </View>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.empty}>
                    Sin incidentes registrados
                  </Text>
                )
              }
            />
          </>
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
            <ScrollChips
              style={styles.seasonChipsWrap}
              contentContainerStyle={styles.seasonChips}
              a11yLabel="años"
            >
              {visibleYears.map((y) => (
                <Pressable
                  key={y}
                  style={({ pressed }) => [
                    styles.seasonChip,
                    (view === 'ranking'
                      ? !histMode && selYear === y
                      : selYear === y) && styles.seasonChipOn,
                    pressed && styles.pressFx,
                  ]}
                  onPress={() => {
                    setSelYear(y);
                    if (view === 'ranking') setHistMode(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Ver ${
                    view === 'temporada' ? 'verano' : 'año'
                  } ${y}`}
                >
                  <Text
                    style={[
                      styles.seasonChipText,
                      (view === 'ranking'
                        ? !histMode && selYear === y
                        : selYear === y) && styles.seasonChipTextOn,
                    ]}
                  >
                    {view === 'temporada'
                      ? y === seasonYear()
                        ? 'Este verano'
                        : `Verano ${y}`
                      : y === new Date().getFullYear()
                        ? 'Este año'
                        : `${y}`}
                    {` (${chipCounts.get(y) ?? 0})`}
                  </Text>
                </Pressable>
              ))}
              {canCollapseYears && (
                <Pressable
                  style={({ pressed }) => [
                    styles.seasonChip,
                    pressed && styles.pressFx,
                  ]}
                  onPress={() => setShowAllYears((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    showAllYears
                      ? 'Plegar la lista de años'
                      : 'Ver todos los años'
                  }
                >
                  <Text style={styles.seasonChipText}>
                    {showAllYears
                      ? 'Menos ›'
                      : view === 'temporada'
                        ? 'Más veranos ›'
                        : 'Más años ›'}
                  </Text>
                </Pressable>
              )}
              {view === 'ranking' && (
                <Pressable
                  style={({ pressed }) => [
                    styles.seasonChip,
                    histMode && styles.seasonChipOn,
                    pressed && styles.pressFx,
                  ]}
                  onPress={() => setHistMode(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Ver ranking histórico completo"
                >
                  <Text
                    style={[
                      styles.seasonChipText,
                      histMode && styles.seasonChipTextOn,
                    ]}
                  >
                    Histórico ({episodes.length})
                  </Text>
                </Pressable>
              )}
            </ScrollChips>
          )}
          {view === 'temporada' && seasonRows.length > 0 && (
            <ScrollChips
              style={styles.seasonChipsWrap}
              contentContainerStyle={styles.seasonChips}
              a11yLabel="filtros de episodios"
            >
              {(
                [
                  ['closure', seasonCounts.closures, 'cierre', 'cierres'],
                  ['warning', seasonCounts.warnings, 'aviso', 'avisos'],
                  ['active', seasonCounts.active, 'activa', 'activas'],
                ] as const
              ).map(([k, n, one, many]) =>
                n > 0 ? (
                  <Pressable
                    key={k}
                    style={({ pressed }) => [
                      styles.seasonChip,
                      seasonFilter === k && styles.seasonChipOn,
                      pressed && styles.pressFx,
                    ]}
                    onPress={() =>
                      setSeasonFilter((f) => (f === k ? 'all' : k))
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`${
                      seasonFilter === k ? 'Quitar filtro de' : 'Filtrar por'
                    } ${n === 1 ? one : many}`}
                  >
                    <Text
                      style={[
                        styles.seasonChipText,
                        seasonFilter === k && styles.seasonChipTextOn,
                      ]}
                    >
                      {`${n} ${n === 1 ? one : many}`}
                    </Text>
                  </Pressable>
                ) : null,
              )}
            </ScrollChips>
          )}
          {view !== 'temporada' && yearCauses.length > 0 && (
            <ScrollChips
              style={styles.seasonChipsWrap}
              contentContainerStyle={styles.seasonChips}
              a11yLabel="filtros por causa"
            >
              <Pressable
                style={({ pressed }) => [
                  styles.seasonChip,
                  yearCause === 'all' && styles.seasonChipOn,
                  pressed && styles.pressFx,
                ]}
                onPress={() => setYearCause('all')}
                accessibilityRole="button"
                accessibilityLabel="Ver todos los episodios del año"
              >
                <Text
                  style={[
                    styles.seasonChipText,
                    yearCause === 'all' && styles.seasonChipTextOn,
                  ]}
                >
                  Todos
                </Text>
              </Pressable>
              {yearCauses.map(([cause, n]) => (
                <Pressable
                  key={cause}
                  style={({ pressed }) => [
                    styles.seasonChip,
                    yearCause === cause && styles.seasonChipOn,
                    pressed && styles.pressFx,
                  ]}
                  onPress={() =>
                    setYearCause((c) => (c === cause ? 'all' : cause))
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Filtrar por ${cause}`}
                >
                  <Text
                    style={[
                      styles.seasonChipText,
                      yearCause === cause && styles.seasonChipTextOn,
                    ]}
                  >
                    {`${n} ${cause.charAt(0).toLowerCase()}${cause.slice(1)}`}
                  </Text>
                </Pressable>
              ))}
            </ScrollChips>
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
            renderItem={({ item: ep }) => {
              const open = ep.closed_at === null;
              return (
                <Pressable
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.pressFx,
                  ]}
                  onPress={() => onSelectBeach?.(ep.beach_id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Ver ficha de ${displayBeachName(
                    ep.beach_name,
                  )}`}
                >
                  <View style={styles.rowHeader}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {displayBeachName(ep.beach_name)}
                    </Text>
                    <Text
                      style={[
                        styles.badge,
                        open
                          ? ep.kind === 'closure'
                            ? styles.badgeClosed
                            : styles.badgeWarning
                          : styles.badgeOpen,
                      ]}
                    >
                      {open
                        ? ep.kind === 'closure'
                          ? 'Sigue cerrada'
                          : 'Aviso activo'
                        : ep.kind === 'closure'
                          ? 'Cierre resuelto'
                          : 'Aviso resuelto'}
                    </Text>
                  </View>
                  <Text style={styles.rowSub}>
                    {ep.municipality ?? 'Sin municipio'} ·{' '}
                    {open
                      ? `desde el ${fmtDate(ep.opened_at)}`
                      : `${fmtDate(ep.opened_at)} → ${fmtDate(
                          ep.closed_at as string,
                        )} · ${episodeDays(ep)} ${
                          episodeDays(ep) === 1 ? 'día' : 'días'
                        }`}
                    {ep.cause
                      ? ` · ${ep.cause.charAt(0).toLowerCase()}${ep.cause.slice(1)}`
                      : ''}
                    {ep.via === 'press' ? ' · según prensa' : ''}
                  </Text>
                </Pressable>
              );
            }}
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
            <Pressable
              style={({ pressed }) => [
                styles.row,
                pressed && styles.pressFx,
              ]}
              onPress={() => setDetail(item)}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, posición ${index + 1} de ${
                filteredRows.length
              }, ${item.beaches} playas, ${
                isYearMode
                  ? `${item.yearClosures} cierres y ${item.yearWarnings} avisos en ${selYear}`
                  : `${item.incidents} incidentes`
              }`}
              accessibilityHint="Ver línea temporal de incidentes"
            >
              <View style={styles.rowHeader}>
                <View
                  style={[
                    styles.rank,
                    index < 3 && styles.rankPodium,
                    {
                      backgroundColor: isYearMode
                        ? index < 3
                          ? yearBarColorOf(item)
                          : '#8fa3ad'
                        : rankColorOf(item, index),
                    },
                  ]}
                >
                  <Text style={styles.rankText}>{index + 1}</Text>
                </View>
                <Text style={styles.rowName}>{item.name}</Text>
                <Text style={styles.rowBeaches}>
                  {item.beaches}{' '}
                  {item.beaches === 1 ? 'playa' : 'playas'}
                  {item.points > item.beaches
                    ? ` · ${item.points} PMs`
                    : ''}
                </Text>
              </View>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${(score(item) / maxScore) * 100}%`,
                      backgroundColor: barColor(item),
                    },
                  ]}
                />
              </View>
              <View style={styles.rowStats}>
                {isYearMode ? (
                  <>
                    {(item.yearClosures ?? 0) > 0 && (
                      <Text style={[styles.badge, styles.badgeClosed]}>
                        {item.yearClosures}{' '}
                        {item.yearClosures === 1 ? 'cierre' : 'cierres'}
                      </Text>
                    )}
                    {(item.yearWarnings ?? 0) > 0 && (
                      <Text style={[styles.badge, styles.badgeWarning]}>
                        {item.yearWarnings}{' '}
                        {item.yearWarnings === 1 ? 'aviso' : 'avisos'}
                      </Text>
                    )}
                    {(item.yearActive ?? 0) > 0 && (
                      <Text style={[styles.badge, styles.badgeEnded]}>
                        {item.yearActive}{' '}
                        {item.yearActive === 1
                          ? 'sigue abierta'
                          : 'siguen abiertas'}
                      </Text>
                    )}
                  </>
                ) : (
                  <>
                    {item.closedNow > 0 && (
                      <Text style={[styles.badge, styles.badgeClosed]}>
                        {item.closedNow}{' '}
                        {item.closedNow === 1 ? 'cerrada' : 'cerradas'}{' '}
                        ahora
                      </Text>
                    )}
                    {item.warningNow > 0 && (
                      <Text style={[styles.badge, styles.badgeWarning]}>
                        {item.warningNow}{' '}
                        {item.warningNow === 1 ? 'aviso' : 'avisos'}{' '}
                        activo
                        {item.warningNow === 1 ? '' : 's'}
                      </Text>
                    )}
                  </>
                )}
                {yearCause !== 'all' && (
                  <Text style={[styles.badge, styles.badgeEnded]}>
                    {muniCauseCount.get(item.municipality) ?? 0}{' '}
                    {yearCause === 'sin causa'
                      ? 'sin causa'
                      : yearCause.toLowerCase()}
                  </Text>
                )}
              </View>
              <Text
                style={styles.rowSub}
                numberOfLines={isYearMode ? 2 : 1}
              >
                {isYearMode
                  ? `Afectadas: ${(item.yearBeaches ?? []).join(' · ')}`
                  : `${item.incidents} ${
                      item.incidents === 1 ? 'incidente' : 'incidentes'
                    } (${item.closuresLastYear} últ. año) · ${
                      item.badSamples
                    } ${
                      item.badSamples === 1 ? 'muestra' : 'muestras'
                    } no apta${item.badSamples === 1 ? '' : 's'}`}
              </Text>
            </Pressable>
          )}
        />
        )}
          </>
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
  headerBlock: {
    paddingTop:
      (Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 24) + 10,
    paddingBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 18,
    fontFamily: fonts.extrabold,
    color: '#fff',
  },
  close: {
    fontSize: 20,
    fontFamily: fonts.extrabold,
    color: 'rgba(255,255,255,0.9)',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  subtitle: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: 'rgba(255,255,255,0.85)',
    paddingHorizontal: 16,
    marginTop: 23,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: 12,
    marginTop: 12,
    marginBottom: 4,
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
  list: {
    flex: 1,
    marginTop: 4,
  },
  listContent: {
    paddingBottom: Platform.OS === 'android' ? 34 : 8, // barra de gestos
  },
  row: {
    backgroundColor: colors.surface,
    marginHorizontal: 12,
    marginBottom: 6,
    borderRadius: 10,
    padding: 12,
    elevation: 1,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rank: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  rankPodium: {
    width: 26,
    height: 26,
    borderRadius: 13,
    elevation: 2,
  },
  rankText: {
    fontSize: 11,
    fontFamily: fonts.extrabold,
    color: '#fff',
  },

  rowName: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.text,
    flex: 1,
  },
  rowBeaches: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginLeft: 8,
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginTop: 8,
    overflow: 'hidden',
  },
  barFill: {
    height: 6,
    borderRadius: 3,
  },
  rowStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 11,
    fontFamily: fonts.bold,
    color: '#fff',
    overflow: 'hidden',
  },
  badgeClosed: {
    backgroundColor: colors.status.closed,
  },
  badgeWarning: {
    backgroundColor: colors.status.warning,
  },
  // Episodio resuelto en la vista Temporada: verde mar
  badgeOpen: {
    backgroundColor: colors.status.open,
  },
  yearLine: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: '#fff',
    paddingHorizontal: 16,
    marginTop: 6,
  },
  viewToggle: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 10,
    backgroundColor: colors.border,
    borderRadius: 8,
    padding: 2,
  },
  viewTab: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
  },
  viewTabOn: {
    backgroundColor: '#fff',
  },
  viewTabText: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
  },
  viewTabTextOn: {
    color: colors.primaryDark,
  },
  // Chips-filtro de la vista Temporada (cierres/avisos/activas) —
  // tocando uno se filtra la lista a ese tipo de episodio
  seasonChipsWrap: {
    marginTop: 10,
  },
  seasonChips: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
  },
  seasonChip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  seasonChipOn: {
    backgroundColor: colors.accent,
  },
  seasonChipText: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  seasonChipTextOn: {
    color: colors.text,
    fontFamily: fonts.extrabold,
  },
  // Incidente histórico (ya cerrado): outline apagado — el sólido se
  // reserva a los activos para que no se lean como vigentes
  badgeEnded: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textMuted,
  },
  tlDotEnded: {
    backgroundColor: colors.textFaint,
  },
  tlGo: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.textFaint,
    marginLeft: 6,
    marginTop: -2,
  },
  rowSub: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 6,
  },
  empty: {
    textAlign: 'center',
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 40,
  },
  emptyWrap: {
    marginTop: 40,
    alignItems: 'center',
  },
  emptyNote: {
    fontFamily: fonts.regular,
    color: colors.textFaint,
    textAlign: 'center',
  },
  emptyCta: {
    marginTop: 12,
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: colors.primary,
  },
  emptyCtaText: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: '#fff',
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
  listBtn: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginLeft: 8,
  },
  listBtnText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  tlItem: {
    flexDirection: 'row',
    marginHorizontal: 16,
  },
  tlRail: {
    width: 20,
    alignItems: 'center',
  },
  tlDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 14,
    borderWidth: 2,
    borderColor: '#fff',
    elevation: 1,
  },
  tlLine: {
    flex: 1,
    width: 2,
    backgroundColor: colors.border,
  },
  tlDotSkeleton: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 14,
  },
  tlSkeletonTitle: {
    width: '55%',
    height: 13,
  },
  tlSkeletonLine: {
    width: '85%',
    height: 10,
    marginTop: 9,
  },
  tlSkeletonLineShort: {
    width: '65%',
    height: 10,
    marginTop: 6,
  },
  tlBody: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 12,
    marginLeft: 6,
    marginBottom: 10,
    elevation: 1,
  },
  tlHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tlBeach: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.text,
    flex: 1,
    marginRight: 8,
  },
  tlDates: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
    marginTop: 4,
  },
  tlObs: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 4,
  },
});

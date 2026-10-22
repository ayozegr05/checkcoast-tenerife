import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  BeachIncident,
  BeachMeasurement,
  BeachNearbyOutfall,
  BeachNewsResponse,
  EpisodeFocus,
  GeoFeature,
  beachShareUrl,
  fetchBeachIncidents,
  fetchBeachNearbyOutfalls,
  fetchBeachNews,
  fetchBeachQuality,
} from '../lib/api';
import {
  beachPointLabel,
  displayBeachName,
  fmtDate,
  pointLongLabel,
} from '../lib/format';
import { isClosure, isMuteLab, isUnclassified } from '../lib/incidents';
import { groupNewsItems } from '../lib/news';
import { anchorIsNewClosureWave, pressSummary } from '../lib/press';
import {
  CHART_H,
  buildChartSeries,
  samplingNote,
  type QualityParam,
} from '../lib/quality';
import { colors, fonts } from '../lib/theme';
import { causeArt } from '../lib/causeArt';
import { isFaunaClosure, isStructuralClosure } from '../lib/mapData';
import { BEACH_STATE_LABEL_LONG, beachStateKey } from '../lib/structural';
import SatelliteShot from './SatelliteShot';
import Skeleton from './Skeleton';
import IncidentHistory from './beach/IncidentHistory';
import NearbyOutfalls from './beach/NearbyOutfalls';
import PressBanner from './beach/PressBanner';
import QualityCard from './beach/QualityCard';
import QualityChart from './beach/QualityChart';

// Estado de playa: usa properties.status (de /beaches + /alerts);
// etiquetas canónicas en lib/structural (BEACH_STATE_LABEL_LONG)
const STATUS_COLOR: Record<string, string> = {
  closed: colors.status.closed,
  fauna: colors.status.fauna,
  structural: colors.status.structural,
  warning: colors.status.warning,
  unknown: colors.status.unknown,
  open: colors.status.open,
};

// "Última comprobación" del estado oficial: no es cuando cambió el
// estado sino cuándo nuestro scraper consultó Náyade por última vez —
// por eso enseña hora (hoy 14:32 / ayer 14:32 / fecha)
const fmtCheck = (iso: string) => {
  const d = new Date(iso);
  const hh = `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `hoy ${hh}`;
  const yest = new Date(now.getTime() - 86400000);
  if (d.toDateString() === yest.toDateString()) return `ayer ${hh}`;
  return `${fmtDate(iso.slice(0, 10))} ${hh}`;
};

// Contenido de la ficha de playa, compartido entre la hoja sobre el mapa
// (FeatureSheet) y la vista detalle dentro de la lista (BeachList)
export default function BeachDetail({
  feature,
  hasAlert,
  outfalls,
  members,
  focusIncident,
  scrollRef,
  getScrollY,
  onFocusConsumed,
  onViewOnMap,
  onSelectOutfall,
}: {
  feature: GeoFeature;
  hasAlert: boolean;
  // Emisarios cargados en la app: se superponen a la foto satélite
  outfalls?: GeoFeature[];
  // Zonas hermanas (puntos de muestreo del mismo arenal): se pintan
  // numeradas en la foto satélite y el encuadre las cubre todas
  members?: GeoFeature[];
  // Episodio tocado desde Municipios/temporada: Episodios baja a la
  // vista con su año abierto y la fila marcada
  focusIncident?: EpisodeFocus | null;
  // ScrollView que envuelve la ficha (FeatureSheet) — para el
  // scroll-to de Episodios al venir de un deep-link de episodio
  scrollRef?: React.RefObject<ScrollView | null>;
  // Offset actual del ScrollView de la ficha — compensa la medida
  // relativa al frame en el aterrizaje del deep-link de episodio
  getScrollY?: () => number;
  // El foco se consume al aterrizar en la fila
  onFocusConsumed?: () => void;
  // Tap en la foto satélite → ver la playa en el mapa
  onViewOnMap?: () => void;
  // Tap en un emisario cercano → verlo en el mapa (pin seleccionado)
  onSelectOutfall?: (feature: GeoFeature) => void;
}) {
  const p = feature.properties;
  const unmonitored = p.monitored === false;
  const [lon, lat] = feature.geometry.coordinates;

  const [incidents, setIncidents] = useState<BeachIncident[] | null>(null);
  const [quality, setQuality] = useState<BeachMeasurement[] | null>(null);
  const [nearby, setNearby] = useState<BeachNearbyOutfall[] | null>(null);
  const [news, setNews] = useState<BeachNewsResponse | null>(null);
  const [newsOpen, setNewsOpen] = useState(false);
  // Varias filas del historial pueden estar abiertas a la vez — en
  // acordeón, abrir la fila 2 cerraba la 1, el contenido se encogía
  // ~9 titulares por encima del dedo y el scroll saltaba al fondo
  const [openIncs, setOpenIncs] = useState<ReadonlySet<number>>(new Set());
  const toggleInc = (id: number) =>
    setOpenIncs((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [chartParam, setChartParam] = useState<QualityParam>('ecoli');
  const [chartW, setChartW] = useState(0);

  // Reset al cambiar de playa/PM: se ajusta DURANTE el render (patrón
  // oficial de React — setState aquí se procesa antes de pintar, sin
  // cascada), no dentro del efecto
  const [prevFeatureId, setPrevFeatureId] = useState(feature.id);
  if (prevFeatureId !== feature.id) {
    setPrevFeatureId(feature.id);
    setIncidents(null);
    setQuality(null);
    setNearby(null);
    setNews(null);
    setNewsOpen(false);
    setOpenIncs(new Set());
  }

  useEffect(() => {
    // Al cambiar de playa/PM las respuestas tardías de la ficha
    // anterior no deben machacar los datos de la actual
    let cancelled = false;
    fetchBeachNearbyOutfalls(feature.id)
      .then((v) => !cancelled && setNearby(v))
      .catch(() => !cancelled && setNearby([]));
    // La prensa también cubre playas sin monitorización oficial
    fetchBeachNews(feature.id)
      .then((v) => !cancelled && setNews(v))
      .catch(
        () =>
          !cancelled &&
          setNews({
            summary: {
              event_type: null,
              cause: null,
              items_count: 0,
              outlets_count: 0,
              since: null,
            },
            items: [],
          }),
      );
    fetchBeachIncidents(feature.id)
      .then((v) => !cancelled && setIncidents(v))
      .catch(() => !cancelled && setIncidents([]));
    if (!unmonitored) {
      fetchBeachQuality(feature.id)
        .then((v) => !cancelled && setQuality(v))
        .catch(() => !cancelled && setQuality([]));
    }
    return () => {
      cancelled = true;
    };
  }, [feature.id, unmonitored]);

  // Intervalos de incidentes [apertura, cierre]: se dibujan como
  // franja de fondo interpolada por fecha entre barras — el tramo
  // cerrado se lee de un vistazo y explica los huecos sin muestras.
  // "Sin calificar" no marca (misma regla que la landing)
  const incidentRanges = useMemo(
    () =>
      (incidents ?? [])
        .filter((i) => !isUnclassified(i))
        .map((i) => ({
          from: i.opened_at,
          to: i.closed_at ?? '9999-12-31',
          label: isClosure(i)
            ? 'cerrada'
            : isMuteLab(i)
              ? 'agua no apta'
              : 'aviso',
        })),
    [incidents],
  );

  // Serie temporal para la grafica: mas antigua primero, solo valores
  // parseables (descarta "—" y filas sin medicion del parametro)
  const chartData = useMemo(
    () => buildChartSeries(quality, chartParam),
    [quality, chartParam],
  );

  const sampleNote = useMemo(() => samplingNote(quality), [quality]);

  // Emisarios como marcadores sobre la foto satélite
  const shotMarkers = useMemo(
    () =>
      (outfalls ?? []).map((o) => {
        const s = o.properties.status ?? 'unknown';
        return {
          id: o.id,
          coords: o.geometry.coordinates as [number, number],
          color:
            colors.outfall[s as keyof typeof colors.outfall] ??
            colors.status.unknown,
          icon: require('../assets/icons/icon-faucet-sil.png'),
        };
      }),
    [outfalls],
  );

  // ¿El cierre de prensa sigue vivo? Si Sanidad registró un incidente
  // cerrado poco después del primer titular (<=15 días), es el mismo
  // episodio ya resuelto (Los Cristianos: prensa 21/08, Náyade
  // registró el cierre 24/08-26/08). Un cierre oficial mucho después
  // ya no se puede atribuir a este episodio
  const pressStillClosed = p.status === 'closed';
  // Cuando el episodio es de una zona hermana (attributed_pm), este
  // punto está 'open' aunque la hermana siga oficialmente cerrada —
  // el backend solo emite attributed_pm mientras eso sea cierto, así
  // que el banner puede decir "la zona 4 SIGUE cerrada" sin mirar
  // filas del historial propio
  const pressEpisodeOpen = !!news?.summary.attributed_pm;
  const pressEpisodeSpan = useMemo(() => {
    if (pressStillClosed || !news?.summary.since) return null;
    const since = news.summary.since.slice(0, 10);
    const lim = new Date(`${since}T00:00:00Z`);
    lim.setUTCDate(lim.getUTCDate() + 15);
    const limStr = lim.toISOString().slice(0, 10);
    // El episodio que empezó en `since` puede durar meses o años
    // (closed_since retrocede el inicio): la reapertura es el cierre
    // de un incidente que empezó junto a `since` y terminó después.
    // Una fecha de fin estimada (última mención en prensa) NO es una
    // reapertura: sin ella el banner inventaría "del X al X · 1 día".
    // Tolerancia hacia atrás: la cobertura de reapertura llega tarde
    // — el clúster puede empezar días después del cierre oficial
    // (Médano: Sanidad reabrió 24/09, la prensa lo contó el 25 — sin
    // la tolerancia el enlace fallaba y el banner inventaba su fecha)
    const sinceMs = Date.parse(`${since}T00:00:00Z`);
    const lo = new Date(sinceMs - 7 * 86_400_000).toISOString().slice(0, 10);
    // Día-frontera: un candidato que cierra JUSTO el día del ancla es
    // el episodio ANTERIOR cuando la prensa documenta un cierre nuevo
    // corroborado ese mismo día (Jardín: acta 28/09→07/10 y 4º cierre
    // de prensa 07→09/10 — sin el corte el banner narraba el episodio
    // viejo). Sin corroboración el acta sigue siendo la del ancla
    const skipBoundary = anchorIsNewClosureWave(
      news.items,
      news.summary,
      since,
    );
    const hit = (incidents ?? [])
      .filter(
        (i) =>
          i.closed_at !== null &&
          !i.end_estimated &&
          i.closed_at >= lo &&
          i.opened_at <= limStr &&
          !(skipBoundary && i.closed_at === since),
      )
      // El candidato con el cierre MÁS CERCANO al clúster: con dos
      // episodios oficiales pegados gana el del episodio que la
      // prensa cubrió, no cualquier cierre compatible
      .sort(
        (a, b) =>
          Math.abs(Date.parse(`${a.closed_at}T00:00:00Z`) - sinceMs) -
          Math.abs(Date.parse(`${b.closed_at}T00:00:00Z`) - sinceMs),
      )[0];
    if (!hit) return null;
    // El inicio REAL del episodio es el opened_at del incidente
    // oficial — la prensa suele cubrir días después de que Sanidad
    // actuara (Jardín: cerró el 05/10, titulares desde el 07/10 →
    // el banner decía "del 07 al 07" inventando 1 día)
    return { start: hit.opened_at, end: hit.closed_at! };
  }, [incidents, news, pressStillClosed]);

  // isStructuralClosure mira el flag del backend; hasAlert es prop de
  // la ficha (no properties.alert). Estructural → chip en granate,
  // fauna → añil
  const beachKey = isStructuralClosure(feature)
    ? 'structural'
    : isFaunaClosure(feature)
      ? 'fauna'
      : hasAlert && p.status === 'open'
        ? 'warning'
        : (p.status ?? 'unknown');
  // Una playa OSM sin monitorizar con alerta (p.ej. Benijo, cerrada
  // según prensa) muestra el estado de la alerta; el aviso de "sin
  // monitorización" solo aplica sin alerta vigente
  const statusText =
    unmonitored && !hasAlert
      ? BEACH_STATE_LABEL_LONG.unmonitored
      : (BEACH_STATE_LABEL_LONG[beachKey] ?? 'Sin datos oficiales');
  const statusColor =
    unmonitored && !hasAlert
      ? colors.status.unmonitored
      : (STATUS_COLOR[beachKey] ?? colors.status.unknown);

  // Mensaje listo para WhatsApp/Telegram: el link /b/{id} del backend
  // lleva Open Graph (foto satélite + estado) → tarjeta rica en el chat
  const share = () => {
    const lines = [
      `🏖️ ${displayBeachName(p.name)}${p.municipality ? ` (${p.municipality})` : ''}`,
      `Estado: ${statusText}`,
    ];
    const latest = quality?.[0];
    if (latest) {
      lines.push(
        `Último análisis (${fmtDate(latest.sampled_at)}): ` +
          `${latest.evaluation ?? 'sin evaluación'}`,
      );
    }
    lines.push(beachShareUrl(feature.id));
    Share.share({ message: lines.join('\n') }).catch(() => {});
  };

  // El banner de prensa solo narra episodios VIVOS (playa cerrada,
  // hermana con episodio abierto, reapertura ≤7 d) o cobertura
  // reciente (≤90 d). Un titular viejo de un episodio resuelto ya
  // está documentado en Episodios — en el banner solo hace ruido
  const pressLive =
    pressStillClosed ||
    pressEpisodeOpen ||
    (pressEpisodeSpan?.end
      ? new Date().getTime() - Date.parse(pressEpisodeSpan.end) <=
        7 * 86_400_000
      : false);
  const pressRecent = (news?.items ?? []).some(
    (n) =>
      n.published_at &&
      new Date().getTime() - Date.parse(n.published_at) <= 90 * 86_400_000,
  );
  const press =
    news !== null && news.items.length > 0 && (pressLive || pressRecent)
      ? pressSummary(news.summary, {
          stillClosed: pressStillClosed || pressEpisodeOpen,
          reopenedAt: pressEpisodeSpan?.end ?? null,
          episodeStart: pressEpisodeSpan?.start ?? null,
          siblingPm: news.summary.attributed_pm,
          beachName: p.name,
        })
      : null;
  const pressReopened = press?.tone === 'reopened';
  // El banner solo enseña los titulares del episodio que narra
  // (episode_items = último clúster de cobertura): una reapertura
  // reciente muestra sus noticias de reapertura; un cierre activo,
  // las de su episodio. Backend sin episode_items → saco completo
  const epItems =
    news?.episode_items && news.episode_items.length > 0
      ? news.episode_items
      : (news?.items ?? []);
  // episode_items ya es el episodio completo (cobertura de cierre +
  // reapertura): filtrar solo reaperturas dejaría el desplegable sin
  // los titulares que narran el "estuvo cerrada del X al Y"
  const bannerItems = epItems;
  const bannerGroups = groupNewsItems(bannerItems);

  return (
    // flexGrow: en la vista de detalle a pantalla completa el
    // contenedor llena el alto disponible (el separador elástico
    // empuja el pie al fondo); en la card del mapa manda el
    // contenido y crece solo lo que necesita
    <View style={{ flexGrow: 1 }}>
      {/* Vista satélite del entorno: la playa en el centro y los
          emisarios catalogados situados en su posición real dentro del
          encuadre, coloreados por estado. La foto es clicable → mapa */}
      <SatelliteShot
        // Multipunto: el encuadre se centra en el centroide del
        // arenal, no en la zona abierta — si no, las hermanas del
        // extremo quedan pegadas al borde. Al acercar con ± el centro
        // salta a la zona de la ficha (detailCenter): el centroide
        // cae en el mar y el zoom detalle enseñaba agua
        center={
          (members?.length ?? 0) > 1
            ? [
                members!.reduce((s, m) => s + m.geometry.coordinates[0], 0) /
                  members!.length,
                members!.reduce((s, m) => s + m.geometry.coordinates[1], 0) /
                  members!.length,
              ]
            : [lon, lat]
        }
        detailCenter={[lon, lat]}
        centerColor={statusColor}
        centerLabel={
          (members?.length ?? 0) > 1
            ? (beachPointLabel(p.name)?.replace(/PM(\d+)/, '$1') ?? undefined)
            : undefined
        }
        markers={[
          ...shotMarkers,
          // Todas las zonas en su posición real, con su nombre
          // común bajo el dot (la zona abierta también — el dot
          // central se oculta: el centroide no es posición real)
          ...(members ?? []).map((m) => ({
            id: `pm-${m.id}`,
            coords: m.geometry.coordinates as [number, number],
            // Estado efectivo igual que en el mapa — un dot de zona
            // estructural va en granate (status crudo la pintaba
            // roja), fauna en añil
            color: STATUS_COLOR[beachStateKey(m)] ?? colors.status.unknown,
            tag: pointLongLabel(m.properties.name) ?? '',
          })),
        ]}
        fitMarkers={(members?.length ?? 0) > 1}
        fitOver={(members ?? []).map((m) => ({
          id: m.id,
          coords: m.geometry.coordinates as [number, number],
          color: '',
        }))}
        hideCenter={(members?.length ?? 0) > 1}
        onPress={onViewOnMap}
      />

      <View style={styles.topRow}>
        <View style={[styles.chip, { backgroundColor: statusColor }]}>
          <Text style={styles.chipText}>{statusText}</Text>
          {/* Circulito de causa dentro de la píldora — mismo gesto
              que el banner de alertas y el pin del mapa */}
          {(beachKey === 'closed' ||
            beachKey === 'fauna' ||
            beachKey === 'structural') && (
            <View style={styles.causeBadge}>
              <Image
                source={causeArt(p.alert_cause, beachKey === 'structural')}
                style={styles.causeBadgeArt}
              />
            </View>
          )}
        </View>
        <Pressable
          onPress={share}
          style={({ pressed }) => [styles.shareBtn, pressed && styles.pressFx]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Compartir estado de la playa"
        >
          <Image
            source={require('../assets/icons/icon-share-outline.png')}
            style={styles.shareIcon}
          />
          <Text style={styles.shareText}>Compartir</Text>
        </Pressable>
      </View>

      {press !== null && (
        <PressBanner
          press={press}
          reopened={pressReopened}
          groups={bannerGroups}
          itemCount={bannerItems.length}
          open={newsOpen}
          onToggle={() => setNewsOpen((v) => !v)}
        />
      )}

      {incidents !== null && incidents.length > 0 && (
        <IncidentHistory
          incidents={incidents}
          openIncs={openIncs}
          onToggleIncident={toggleInc}
          beachName={p.name}
          focus={focusIncident}
          scrollRef={scrollRef}
          getScrollY={getScrollY}
          onFocusConsumed={onFocusConsumed}
        />
      )}

      {nearby !== null && nearby.length > 0 && (
        <NearbyOutfalls
          nearby={nearby}
          outfalls={outfalls}
          onSelectOutfall={onSelectOutfall}
          topBorder={press !== null || (incidents?.length ?? 0) > 0}
        />
      )}

      {/* Mientras llega el histórico, placeholder con la forma de la
          tarjeta de calidad + gráfica (las playas OSM no fetchean) */}
      {!unmonitored && quality === null && (
        <View style={styles.qualityCard}>
          <Skeleton style={{ width: 150, height: 13 }} />
          <Skeleton style={{ width: '92%', height: 10, marginTop: 10 }} />
          <Skeleton style={{ width: '78%', height: 10, marginTop: 8 }} />
          <Skeleton style={{ width: '100%', height: CHART_H, marginTop: 12 }} />
          <Skeleton style={{ width: '60%', height: 10, marginTop: 14 }} />
        </View>
      )}

      {quality !== null && quality.length > 0 && (
        <QualityCard quality={quality} beachKey={beachKey} />
      )}

      {chartData.length >= 2 && (
        <QualityChart
          chartData={chartData}
          chartParam={chartParam}
          onChangeParam={setChartParam}
          chartW={chartW}
          onChartWidth={setChartW}
          incidentRanges={incidentRanges}
          sampleNote={sampleNote}
        />
      )}

      {/* Separador elástico: en la vista de detalle a pantalla
          completa (lista de playas) el contenedor estira y este
          espacio empuja el pie al fondo; en la card del mapa el
          contenido manda y colapsa a 24 */}
      <View style={{ flex: 1, minHeight: 24 }} />

      {/* Atribución de fuentes + última comprobación: metadatos al pie,
          no contenido */}
      <Text style={styles.sourceFoot}>
        {unmonitored
          ? 'Playa sin controles sanitarios oficiales. Fuente: OpenStreetMap (© colaboradores OSM)'
          : 'Fuentes: Censo Zonas de Baño 2025 (MITECO) · Incidencias: Náyade (Min. Sanidad)'}
        {!unmonitored && p.reported_at
          ? ` · Consultado ${fmtCheck(p.reported_at)}`
          : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Feedback táctil común: leve fundido al presionar
  pressFx: {
    opacity: 0.6,
  },
  // Estado centrado como "titular" de la ficha; Compartir docked a la
  // derecha en absoluto para no robarle el centro al chip
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 4,
    minHeight: 30,
    // Pequeña reserva a la derecha: el chip queda casi centrado y
    // solo deja un margen de respiro junto al Compartir
    paddingRight: 40,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  // Circulito de causa dentro del chip — aro claro para recortarlo
  // sobre el fondo de estado; el arte rellena el círculo
  causeBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  causeBadgeArt: {
    width: '100%',
    height: '100%',
  },
  chipText: {
    color: colors.onColor,
    fontSize: 13,
    fontFamily: fonts.bold,
  },
  shareBtn: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0, // estira a toda la fila para centrar su contenido
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface, // outline: el chip de estado es el único relleno
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(26,127,150,0.45)', // teal suavizado
    paddingHorizontal: 8,
    paddingVertical: 0,
  },
  shareIcon: {
    width: 12,
    height: 12,
  },
  shareText: {
    color: colors.link,
    fontSize: 11,
    fontFamily: fonts.bold,
  },
  qualityCard: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  sourceFoot: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    textAlign: 'center',
  },
});

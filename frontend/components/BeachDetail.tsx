import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import {
  BeachIncident,
  BeachMeasurement,
  BeachNearbyOutfall,
  BeachNewsResponse,
  GeoFeature,
  beachShareUrl,
  fetchBeachIncidents,
  fetchBeachNearbyOutfalls,
  fetchBeachNews,
  fetchBeachQuality,
} from '../lib/api';
import { beachPointLabel, displayBeachName, fmtDate } from '../lib/format';
import { groupNewsItems } from '../lib/news';
import { pressSummary } from '../lib/press';
import {
  CHART_H,
  buildChartSeries,
  samplingNote,
  type QualityParam,
} from '../lib/quality';
import { colors, fonts } from '../lib/theme';
import SatelliteShot from './SatelliteShot';
import Skeleton from './Skeleton';
import IncidentHistory from './beach/IncidentHistory';
import NearbyOutfalls from './beach/NearbyOutfalls';
import PressBanner from './beach/PressBanner';
import QualityCard from './beach/QualityCard';
import QualityChart from './beach/QualityChart';

// Estado de playa: usa properties.status (de /beaches + /alerts)
const BEACH_STATUS: Record<string, { label: string; color: string }> = {
  closed: { label: 'Cierre activo', color: colors.status.closed },
  warning: { label: 'Aviso activo', color: colors.status.warning },
  unknown: { label: 'Sin datos oficiales', color: colors.status.unknown },
  open: { label: 'Sin alertas activas', color: colors.status.open },
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

  useEffect(() => {
    setIncidents(null);
    setQuality(null);
    setNearby(null);
    setNews(null);
    setNewsOpen(false);
    setOpenIncs(new Set());
    fetchBeachNearbyOutfalls(feature.id)
      .then(setNearby)
      .catch(() => setNearby([]));
    // La prensa también cubre playas sin monitorización oficial
    fetchBeachNews(feature.id)
      .then(setNews)
      .catch(() =>
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
      .then(setIncidents)
      .catch(() => setIncidents([]));
    if (unmonitored) return; // sin mediciones oficiales
    fetchBeachQuality(feature.id)
      .then(setQuality)
      .catch(() => setQuality([]));
  }, [feature.id, unmonitored]);

  // Intervalos de incidentes [apertura, cierre]: se marcan en el eje
  // temporal con un rombo rojo interpolado por fecha entre barras —
  // un cierre casi nunca coincide con un dia de muestreo
  const incidentRanges = useMemo(
    () =>
      (incidents ?? []).map((i) => ({
        from: i.opened_at,
        to: i.closed_at ?? '9999-12-31',
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
  // punto está 'open' aunque el episodio siga vivo — el tiempo verbal
  // debe mirar si el episodio tiene fin, no el estado del punto:
  // "la zona 4 SIGUE cerrada", no "estuvo"
  const pressEpisodeOpen =
    !!news?.summary.attributed_pm &&
    (incidents ?? []).some((i) => i.via === 'press' && i.closed_at === null);
  const pressReopenedAt = useMemo(() => {
    if (pressStillClosed || !news?.summary.since) return null;
    const since = news.summary.since.slice(0, 10);
    const lim = new Date(`${since}T00:00:00Z`);
    lim.setUTCDate(lim.getUTCDate() + 15);
    const limStr = lim.toISOString().slice(0, 10);
    // El episodio que empezó en `since` puede durar meses o años
    // (closed_since retrocede el inicio): la reapertura es el cierre
    // de un incidente que empezó junto a `since` y terminó después
    // Una fecha de fin estimada (última mención en prensa) NO es una
    // reapertura: sin ella el banner inventaría "del X al X · 1 día"
    const later = (incidents ?? [])
      .filter(
        (i) =>
          i.closed_at !== null &&
          !i.end_estimated &&
          i.closed_at >= since &&
          i.opened_at <= limStr,
      )
      .map((i) => i.closed_at as string)
      .sort();
    return later[later.length - 1] ?? null;
  }, [incidents, news, pressStillClosed]);

  const beachKey =
    hasAlert && p.status === 'open' ? 'warning' : (p.status ?? 'unknown');
  // Una playa OSM sin monitorizar con alerta (p.ej. Benijo, cerrada
  // según prensa) muestra el estado de la alerta; el aviso de "sin
  // monitorización" solo aplica sin alerta vigente
  const statusText =
    unmonitored && !hasAlert
      ? 'Sin monitorización oficial'
      : (BEACH_STATUS[beachKey]?.label ?? 'Sin datos oficiales');
  const statusColor =
    unmonitored && !hasAlert
      ? colors.status.unmonitored
      : (BEACH_STATUS[beachKey]?.color ?? colors.status.unknown);

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

  const press =
    news !== null && news.items.length > 0
      ? pressSummary(news.summary, {
          stillClosed: pressStillClosed || pressEpisodeOpen,
          reopenedAt: pressReopenedAt,
          siblingPm: news.summary.attributed_pm,
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
  const reopenItems = epItems.filter((n) => n.event_type === 'reopening');
  const bannerItems =
    pressReopened && reopenItems.length > 0 ? reopenItems : epItems;
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
          // Todas las zonas numeradas en su posición real — la zona
          // abierta también (el dot central se oculta: el centroide
          // no es una posición real de ninguna zona)
          ...(members ?? []).map((m) => ({
            id: `pm-${m.id}`,
            coords: m.geometry.coordinates as [number, number],
            color:
              BEACH_STATUS[
                m.properties.status && m.properties.status !== 'unknown'
                  ? (m.properties.status as string)
                  : 'unknown'
              ]?.color ?? colors.status.unknown,
            label:
              beachPointLabel(m.properties.name)?.replace(/PM(\d+)/, '$1') ??
              '',
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
        />
      )}

      {nearby !== null && nearby.length > 0 && (
        <NearbyOutfalls
          nearby={nearby}
          outfalls={outfalls}
          onSelectOutfall={onSelectOutfall}
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
        <QualityCard
          quality={quality}
          beachKey={beachKey}
          sampleNote={sampleNote}
        />
      )}

      {chartData.length >= 2 && (
        <QualityChart
          chartData={chartData}
          chartParam={chartParam}
          onChangeParam={setChartParam}
          chartW={chartW}
          onChartWidth={setChartW}
          incidentRanges={incidentRanges}
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
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  chipText: {
    color: '#fff',
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
    color: '#1a7f96',
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

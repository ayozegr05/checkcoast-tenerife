import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Linking,
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
  BeachNews,
  BeachNewsResponse,
  GeoFeature,
  fetchBeachIncidents,
  fetchBeachNearbyOutfalls,
  fetchBeachNews,
  fetchBeachQuality,
} from '../lib/api';
import { displayBeachName } from '../lib/format';
import { colors, fonts } from '../lib/theme';
import Skeleton from './Skeleton';

// Estado de playa: usa properties.status (de /beaches + /alerts)
const BEACH_STATUS: Record<string, { label: string; color: string }> = {
  closed: { label: 'Cierre activo', color: colors.status.closed },
  warning: { label: 'Aviso activo', color: colors.status.warning },
  unknown: { label: 'Sin datos oficiales', color: colors.status.unknown },
  open: { label: 'Sin alertas activas', color: colors.status.open },
};

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

// Un incidente es "cierre" si la observación prohíbe el baño
const isClosure = (inc: BeachIncident) =>
  /prohib/i.test(inc.observations ?? '');

// Náyade a veces abre una "incidencia" cuyo texto es solo la
// evaluación pendiente de una muestra (p.ej. Las Gaviotas 08/06/2026:
// playa cerrada por obras, muestra tomada y nunca clasificada). No es
// un incidente real: se muestra con etiqueta y texto propios
const isUnclassified = (inc: BeachIncident) =>
  /sin\s*calificar/i.test(inc.observations ?? '');

// Cierres cuya apertura cayó dentro de los últimos `years` años
const closuresInYears = (incidents: BeachIncident[], years: number) => {
  const cutoff = Date.now() - years * 365.25 * 24 * 3600 * 1000;
  return incidents.filter(
    (i) => isClosure(i) && Date.parse(i.opened_at) >= cutoff,
  ).length;
};

// Color de la evaluación del último análisis
const evaluationColor = (evaluation: string) => {
  if (/apta/i.test(evaluation)) return colors.status.open;
  if (/prohib/i.test(evaluation)) return colors.status.closed;
  return colors.status.warning;
};

// Umbrales RD 1341/2007 (aguas costeras), UFC/100 mL:
// [excelente, buena] — por encima de "buena" es insuficiente/mala
const QUALITY_THRESHOLDS: Record<
  'ecoli' | 'enterococci',
  { excellent: number; good: number; label: string }
> = {
  ecoli: { excellent: 250, good: 500, label: 'E. coli' },
  enterococci: { excellent: 100, good: 200, label: 'Enterococo' },
};

const classifyValue = (
  param: 'ecoli' | 'enterococci',
  raw: string | null,
) => {
  const value = parseFloat(raw ?? '');
  if (Number.isNaN(value)) return null;
  const t = QUALITY_THRESHOLDS[param];
  const cls =
    value <= t.excellent
      ? 'Excelente'
      : value <= t.good
        ? 'Buena'
        : 'Insuficiente';
  const color =
    cls === 'Excelente'
      ? colors.status.open
      : cls === 'Buena'
        ? colors.outfall.unknown
        : colors.status.closed;
  const pct = Math.round((value / t.good) * 100);
  return { value, cls, color, pct };
};

// Valores tipo "<10" o ">24000 UFC/100 mL": quitar solo el prefijo no
// numérico y parseFloat se queda con el número (no quitar dígitos de la
// unidad "100 mL" — inflaría el valor ×1000)
const numValue = (raw: string | null) => {
  const v = parseFloat((raw ?? '').replace(/^[^\d.]*/, ''));
  return Number.isNaN(v) ? null : v;
};

// Gráfica de evolución: barras log-escala (los valores van de <1 a
// >24000 UFC/100 mL) coloreadas por clase + línea del límite normativo
const CHART_H = 88;
const LOG_CAP = 100000;
const barH = (v: number) =>
  Math.max(
    3,
    Math.round((CHART_H * Math.log10(Math.max(v, 1))) / Math.log10(LOG_CAP)),
  );

const MONTHS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];
const fmtMonth = (iso: string) => {
  const [y, m] = iso.split('-');
  return `${MONTHS[parseInt(m, 10) - 1]} ${y}`;
};

const fmtDistance = (m: number) =>
  m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;

const OUTFALL_STATUS_LABELS: Record<string, string> = {
  legal: 'Autorizado',
  illegal: 'No autorizado',
  unknown: 'En trámite',
};

// Tipos de evento extraídos de prensa por el LLM (Hito 8.5)
const NEWS_EVENT_LABELS: Record<string, string> = {
  closure: 'Cierre',
  reopening: 'Reapertura',
  warning: 'Aviso',
  pollution: 'Contaminación',
  other: 'Noticia',
};

// Línea-resumen: motivo primero, fecha del primer titular, atribución
// abajo — "Cerrada por riesgo de desprendimientos · desde el 03/06"
const NEWS_EVENT_LINE: Record<string, [string, string, string]> = {
  closure: ['Cerrada', 'por', 'desde el'],
  reopening: ['Reapertura', 'tras', 'el'],
  warning: ['Aviso', 'por', 'desde el'],
  pollution: ['Contaminación', 'por', 'el'],
  other: ['Noticias', 'sobre', 'el'],
};

const pressSummary = (s: BeachNewsResponse['summary']) => {
  const [noun, prep, dmark] = NEWS_EVENT_LINE[s.event_type ?? 'other'] ?? [
    'Noticias',
    'sobre',
    'el',
  ];
  const date = s.since ? ` · ${dmark} ${fmtDate(s.since.slice(0, 10))}` : '';
  const medios =
    s.outlets_count === 1 ? '1 medio' : `${s.outlets_count} medios`;
  return {
    main: `${noun}${s.cause ? ` ${prep} ${s.cause}` : ''}${date}`,
    sub: `según prensa · ${medios}`,
  };
};

// Contenido de la ficha de playa, compartido entre la hoja sobre el mapa
// (FeatureSheet) y la vista detalle dentro de la lista (BeachList)
export default function BeachDetail({
  feature,
  hasAlert,
  scrollRef,
}: {
  feature: GeoFeature;
  hasAlert: boolean;
  // ScrollView padre: al desplegar "Ver titulares" se hace scrollToEnd
  // (la sección de prensa es la última de la ficha)
  scrollRef?: React.RefObject<ScrollView | null>;
}) {
  const p = feature.properties;
  const unmonitored = p.monitored === false;

  const [incidents, setIncidents] = useState<BeachIncident[] | null>(null);
  const [quality, setQuality] = useState<BeachMeasurement[] | null>(null);
  const [nearby, setNearby] = useState<BeachNearbyOutfall[] | null>(null);
  const [news, setNews] = useState<BeachNewsResponse | null>(null);
  const [newsOpen, setNewsOpen] = useState(false);
  const [chartParam, setChartParam] = useState<'ecoli' | 'enterococci'>(
    'ecoli',
  );
  const [chartW, setChartW] = useState(0);

  useEffect(() => {
    setIncidents(null);
    setQuality(null);
    setNearby(null);
    setNews(null);
    setNewsOpen(false);
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
    if (unmonitored) return; // sin datos oficiales
    fetchBeachIncidents(feature.id)
      .then(setIncidents)
      .catch(() => setIncidents([]));
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
  const chartData = useMemo(() => {
    if (!quality) return [];
    const rows = [...quality]
      .reverse()
      .map((m) => ({ date: m.sampled_at, value: numValue(m[chartParam]) }))
      .filter(
        (d): d is { date: string; value: number } => d.value !== null,
      );
    // Etiqueta de año bajo la primera barra de cada año
    let lastYear = '';
    return rows.map((d) => {
      const year = d.date.slice(0, 4);
      const yearLabel = year !== lastYear ? year : null;
      lastYear = year;
      return { ...d, yearLabel };
    });
  }, [quality, chartParam]);

  // Ancho de columna: repartir el ancho de la card entre las muestras;
  // mínimo 8px — si hay muchas, sigue habiendo scroll horizontal
  const colW =
    chartW > 0 && chartData.length > 0
      ? Math.max(8, chartW / chartData.length)
      : 8;

  // Titulares agrupados por evento+causa: la misma noticia cubierta
  // por varios medios queda como un solo bloque escaneable
  const newsGroups = useMemo(() => {
    const groups = new Map<string, { label: string; items: BeachNews[] }>();
    for (const n of news?.items ?? []) {
      const key = `${n.event_type ?? 'other'}|${n.cause ?? ''}`;
      const et = NEWS_EVENT_LABELS[n.event_type ?? ''] ?? 'Noticia';
      const g = groups.get(key) ?? {
        label: `${et}${n.cause ? ` · ${n.cause}` : ''}`,
        items: [],
      };
      g.items.push(n);
      groups.set(key, g);
    }
    return [...groups.values()];
  }, [news]);

  const beachKey =
    hasAlert && p.status === 'open' ? 'warning' : (p.status ?? 'unknown');
  const statusText = unmonitored
    ? 'Sin monitorización oficial'
    : (BEACH_STATUS[beachKey]?.label ?? 'Sin datos oficiales');
  const statusColor = unmonitored
    ? colors.status.unmonitored
    : (BEACH_STATUS[beachKey]?.color ?? colors.status.unknown);

  // Mensaje listo para WhatsApp/Telegram: estado + última evaluación +
  // deep-link checkcoast://beach/{id} que abre la app en esta ficha
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
    lines.push('Fuente: CheckCoast Tenerife (MITECO/Náyade/OSM)');
    lines.push(`checkcoast://beach/${feature.id}`);
    Share.share({ message: lines.join('\n') }).catch(() => {});
  };

  return (
    <View>
      <View style={styles.topRow}>
        <View style={[styles.chip, { backgroundColor: statusColor }]}>
          <Text style={styles.chipText}>{statusText}</Text>
        </View>
        <Pressable
          onPress={share}
          style={styles.shareBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Compartir estado de la playa"
        >
          <Image
            source={require('../assets/icons/icon-share.png')}
            style={styles.shareIcon}
          />
          <Text style={styles.shareText}>Compartir</Text>
        </Pressable>
      </View>

      {p.municipality ? (
        <Text style={styles.row}>Municipio: {p.municipality}</Text>
      ) : null}
      {unmonitored ? (
        <Text style={styles.row}>
          Playa sin controles sanitarios oficiales. Fuente: OpenStreetMap
          (© colaboradores OSM)
        </Text>
      ) : (
        <Text style={styles.row}>
          Fuente: Censo Zonas de Baño 2025 (MITECO) · Incidencias: Náyade
          (Min. Sanidad)
        </Text>
      )}

      {/* "¿Por qué?" según prensa, visible sin scroll; la lista de
          titulares queda en la card "En la prensa" */}
      {news !== null && news.items.length > 0 && (
        <View style={styles.pressBanner}>
          <Text style={styles.pressBannerText}>
            {pressSummary(news.summary).main}
          </Text>
          <Text style={styles.pressBannerSub}>
            {pressSummary(news.summary).sub}
          </Text>
        </View>
      )}

      {/* Mientras llega el histórico, placeholder con la forma de la
          tarjeta de calidad + gráfica (las playas OSM no fetchean) */}
      {!unmonitored && quality === null && (
        <View style={styles.qualityCard}>
          <Skeleton style={{ width: 150, height: 13 }} />
          <Skeleton style={{ width: '92%', height: 10, marginTop: 10 }} />
          <Skeleton style={{ width: '78%', height: 10, marginTop: 8 }} />
          <Skeleton
            style={{ width: '100%', height: CHART_H, marginTop: 12 }}
          />
          <Skeleton style={{ width: '60%', height: 10, marginTop: 14 }} />
        </View>
      )}

      {quality !== null && quality.length > 0 && (
        <View style={styles.qualityCard}>
          <Text style={styles.historyTitle}>
            Calidad del agua · {fmtDate(quality[0].sampled_at)}
          </Text>
          {(['ecoli', 'enterococci'] as const).map((param) => {
            const raw = quality[0][param];
            const info = classifyValue(param, raw);
            return (
              <View key={param} style={styles.paramRow}>
                <Text style={styles.paramLabel}>
                  {QUALITY_THRESHOLDS[param].label}
                </Text>
                <View style={styles.paramRight}>
                  <Text style={styles.paramValue}>{raw ?? '—'}</Text>
                  {info && (
                    <>
                      <View style={styles.barTrack}>
                        <View
                          style={[
                            styles.barFill,
                            {
                              width: `${Math.min(info.pct, 100)}%`,
                              backgroundColor: info.color,
                            },
                          ]}
                        />
                      </View>
                      <Text
                        style={[styles.paramClass, { color: info.color }]}
                      >
                        {info.cls} · {info.pct}% del límite
                      </Text>
                    </>
                  )}
                </View>
              </View>
            );
          })}
          {quality[0].evaluation ? (
            <Text
              style={[
                styles.evaluation,
                { color: evaluationColor(quality[0].evaluation) },
              ]}
            >
              {quality[0].evaluation}
            </Text>
          ) : null}
          {beachKey === 'open' &&
          /prohib|calificar/i.test(quality[0].evaluation ?? '') ? (
            <Text style={styles.staleNote}>
              El incidente oficial ya está cerrado · pendiente de nueva
              muestra
            </Text>
          ) : null}

          {chartData.length >= 2 && (
            <View
              style={styles.chartBlock}
              onLayout={(e) =>
                setChartW(e.nativeEvent.layout.width)
              }
            >
              <View style={styles.chartHead}>
                <Text style={styles.historyTitle}>Evolución</Text>
                <View style={styles.chartToggle}>
                  {(['ecoli', 'enterococci'] as const).map((param) => (
                    <Pressable
                      key={param}
                      onPress={() => setChartParam(param)}
                      style={[
                        styles.toggleChip,
                        chartParam === param && styles.toggleChipOn,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Ver evolución de ${QUALITY_THRESHOLDS[param].label}`}
                      accessibilityState={{
                        selected: chartParam === param,
                      }}
                    >
                      <Text
                        style={[
                          styles.toggleChipText,
                          chartParam === param && styles.toggleChipTextOn,
                        ]}
                      >
                        {QUALITY_THRESHOLDS[param].label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                <View>
                  <View style={styles.chartArea}>
                    <View
                      style={[
                        styles.limitLine,
                        {
                          bottom: barH(
                            QUALITY_THRESHOLDS[chartParam].good,
                          ),
                        },
                      ]}
                    />
                    {chartData.map((d, i) => {
                      const t = QUALITY_THRESHOLDS[chartParam];
                      const color =
                        d.value <= t.excellent
                          ? colors.status.open
                          : d.value <= t.good
                            ? colors.outfall.unknown
                            : colors.status.closed;
                      return (
                        <View
                          key={i}
                          style={[
                            styles.barCol,
                            { width: colW, marginRight: 0 },
                          ]}
                        >
                          <View
                            style={[
                              styles.bar,
                              {
                                height: barH(d.value),
                                width: Math.max(3, colW - 2),
                                backgroundColor: color,
                              },
                            ]}
                          />
                        </View>
                      );
                    })}
                    {(() => {
                      const first = Date.parse(chartData[0].date);
                      const last = Date.parse(
                        chartData[chartData.length - 1].date,
                      );
                      const span = Math.max(last - first, 1);
                      return incidentRanges.map((r, i) => {
                        const pos = Math.min(
                          1,
                          Math.max(0, (Date.parse(r.from) - first) / span),
                        );
                        return (
                          <View
                            key={i}
                            style={[
                              styles.incidentTick,
                              {
                                left: Math.round(
                                  pos * (chartData.length - 1) * colW,
                                ),
                              },
                            ]}
                          />
                        );
                      });
                    })()}
                  </View>
                  <View style={styles.yearRow}>
                    {chartData.map((d, i) => (
                      <View
                        key={i}
                        style={[styles.yearCol, { width: colW }]}
                      >
                        {d.yearLabel ? (
                          <Text style={styles.yearText}>
                            {d.yearLabel}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                </View>
              </ScrollView>
              <Text style={styles.chartFoot}>
                {chartData.length} muestreos · cada barra = un análisis
                oficial · línea azul = límite normativo (
                {QUALITY_THRESHOLDS[chartParam].good} UFC/100 mL)
                {incidentRanges.length > 0
                  ? ' · línea roja = cierre/aviso'
                  : ''}
              </Text>
            </View>
          )}
        </View>
      )}

      {nearby !== null && nearby.length > 0 && (
        <View style={styles.history}>
          <Text style={styles.historyTitle}>
            Emisarios cercanos ({nearby.length})
          </Text>
          {nearby.map((o) => {
            const accent =
              colors.outfall[o.status] ?? colors.status.unknown;
            return (
              <View
                key={o.outfall_id}
                style={[styles.outfallRow, { borderLeftColor: accent }]}
              >
                <View style={styles.outfallRowBody}>
                  <Text style={styles.outfallName} numberOfLines={1}>
                    {o.name}
                  </Text>
                  <Text style={styles.outfallMeta}>
                    {OUTFALL_STATUS_LABELS[o.status] ?? 'En trámite'} · a{' '}
                    {fmtDistance(o.distance_m)}
                  </Text>
                </View>
              </View>
            );
          })}
          <Text style={styles.chartFoot}>En un radio de 1 km</Text>
        </View>
      )}

      {incidents !== null && incidents.length > 0 && (
        <View style={styles.history}>
          <Text style={styles.historyTitle}>
            Historial de incidencias ({incidents.length})
          </Text>
          <Text style={styles.incidentObs}>
            {incidents.filter(isClosure).length} cierres ·{' '}
            {incidents.filter((i) => !isClosure(i) && !isUnclassified(i)).length}{' '}
            avisos
            {incidents.some(isUnclassified)
              ? ` · ${incidents.filter(isUnclassified).length} muestra${
                  incidents.filter(isUnclassified).length === 1 ? '' : 's'
                } sin calificar`
              : ''}
            {'\n'}
            Cerrada {closuresInYears(incidents, 1)} vez
            {closuresInYears(incidents, 1) === 1 ? '' : 'es'} el último año
            · {closuresInYears(incidents, 5)} en los últimos 5 años
          </Text>
          <ScrollView style={styles.historyList} nestedScrollEnabled>
            {incidents.map((inc) => {
              const closure = isClosure(inc);
              const unclassified = isUnclassified(inc);
              const accent = closure
                ? colors.status.closed
                : colors.outfall.unknown;
              return (
                <View
                  key={inc.id}
                  style={[styles.incident, { borderLeftColor: accent }]}
                >
                  <View style={styles.incidentHead}>
                    <Text style={styles.incidentDates}>
                      {fmtDate(inc.opened_at)} →{' '}
                      {inc.closed_at ? fmtDate(inc.closed_at) : 'hoy'}
                    </Text>
                    <View
                      style={[
                        styles.incidentTag,
                        { backgroundColor: accent },
                      ]}
                    >
                      <Text style={styles.incidentTagText}>
                        {inc.closed_at
                          ? closure
                            ? 'CIERRE'
                            : 'AVISO'
                          : unclassified
                            ? 'PENDIENTE'
                            : 'ACTIVA'}
                      </Text>
                    </View>
                  </View>
                  {inc.observations ? (
                    <Text style={styles.incidentObs}>
                      {unclassified
                        ? 'Muestra tomada pero nunca clasificada por Sanidad'
                        : inc.observations}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Prensa al final: es contexto, no dato oficial */}
      {news !== null && news.items.length > 0 && (
        <View style={styles.history}>
          <View style={styles.newsHead}>
            <Text style={styles.historyTitle}>En la prensa</Text>
            <View style={styles.pressTag}>
              <Text style={styles.pressTagText}>según prensa</Text>
            </View>
          </View>
          <Text style={styles.newsSummary}>
            {pressSummary(news.summary).main}
          </Text>
          <Pressable
            onPress={() => {
              setNewsOpen((v) => !v);
              if (!newsOpen) {
                // La card puede estar ya a tope: baja a la lista nueva
                setTimeout(
                  () =>
                    scrollRef?.current?.scrollToEnd({ animated: true }),
                  120,
                );
              }
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={
              newsOpen
                ? 'Ocultar titulares de prensa'
                : `Ver ${news.summary.items_count} titulares de prensa`
            }
          >
            <Text style={styles.newsToggle}>
              {newsOpen
                ? 'Ocultar titulares ▴'
                : `Ver titulares (${news.summary.items_count}) ▾`}
            </Text>
          </Pressable>
          {newsOpen &&
            newsGroups.map((g) => (
              <View key={g.label} style={styles.newsGroup}>
                <Text style={styles.newsGroupTitle}>{g.label}</Text>
                {g.items.map((n) => (
                  <Pressable
                    key={n.id}
                    style={styles.newsRow}
                    onPress={() => Linking.openURL(n.url).catch(() => {})}
                    accessibilityRole="link"
                    accessibilityLabel={`Noticia: ${n.title}`}
                  >
                    <Text style={styles.newsTitle} numberOfLines={2}>
                      {n.title}
                    </Text>
                    <Text style={styles.newsMeta} numberOfLines={1}>
                      {[
                        n.source,
                        n.published_at
                          ? fmtDate(n.published_at.slice(0, 10))
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ))}
          <Text style={styles.chartFoot}>
            Contexto de prensa: no altera el estado oficial (Náyade)
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#1a7f96', // azul océano del estilo del mapa
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#11586b',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  shareIcon: {
    width: 13,
    height: 13,
  },
  shareText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  row: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.text,
    marginTop: 4,
  },
  history: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  historyTitle: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: colors.text,
    marginBottom: 4,
  },
  historyList: {
    maxHeight: 140,
  },
  qualityCard: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  paramRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 8,
  },
  paramLabel: {
    width: 86,
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
  },
  paramRight: {
    flex: 1,
  },
  paramValue: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  barTrack: {
    height: 5,
    backgroundColor: colors.border,
    borderRadius: 3,
    marginTop: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: 5,
    borderRadius: 3,
  },
  paramClass: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    marginTop: 1,
  },
  evaluation: {
    fontSize: 12,
    fontFamily: fonts.bold,
    marginTop: 8,
  },
  staleNote: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 4,
  },
  chartBlock: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  chartHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chartToggle: {
    flexDirection: 'row',
    gap: 6,
  },
  toggleChip: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  toggleChipOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  toggleChipText: {
    fontSize: 10,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
  },
  toggleChipTextOn: {
    color: '#fff',
  },
  chartArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: CHART_H,
    marginTop: 4,
    paddingRight: 4,
  },
  limitLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.primaryDark,
    opacity: 0.85,
  },
  yearRow: {
    flexDirection: 'row',
    marginTop: 2,
  },
  yearCol: {
    width: 8,
    alignItems: 'flex-start',
  },
  yearText: {
    fontSize: 7,
    fontFamily: fonts.semibold,
    color: colors.textFaint,
  },
  barCol: {
    justifyContent: 'flex-end',
    height: CHART_H,
    marginRight: 2,
  },
  bar: {
    width: 6,
    borderRadius: 2,
  },
  incidentTick: {
    position: 'absolute',
    top: 0,
    bottom: -5,
    width: 1.5,
    backgroundColor: colors.status.closed,
    opacity: 0.75,
  },
  chartFoot: {
    fontSize: 10,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 4,
  },
  outfallRow: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 4,
    marginBottom: 6,
    backgroundColor: colors.background,
    borderRadius: 4,
  },
  outfallRowBody: {
    paddingRight: 4,
  },
  outfallName: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  outfallMeta: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 1,
  },
  incident: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 4,
    marginBottom: 8,
    backgroundColor: colors.background,
    borderRadius: 4,
  },
  incidentHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 4,
  },
  incidentTag: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  incidentTagText: {
    color: '#fff',
    fontSize: 9,
    fontFamily: fonts.extrabold,
  },
  incidentDates: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
  },
  incidentObs: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  newsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  pressTag: {
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  pressTagText: {
    color: colors.primary,
    fontSize: 9,
    fontFamily: fonts.extrabold,
  },
  pressBanner: {
    marginTop: 8,
    borderLeftWidth: 3,
    borderLeftColor: colors.status.warning,
    backgroundColor: '#fff3e0',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  pressBannerText: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: colors.status.warning,
  },
  pressBannerSub: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.status.warning,
    marginTop: 1,
  },
  newsSummary: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: colors.text,
    marginBottom: 6,
  },
  newsToggle: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.primary,
    marginBottom: 4,
  },
  newsGroup: {
    marginTop: 4,
  },
  newsGroupTitle: {
    fontSize: 11,
    fontFamily: fonts.extrabold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 4,
    marginTop: 4,
  },
  newsRow: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    paddingLeft: 10,
    paddingVertical: 4,
    marginBottom: 8,
    backgroundColor: colors.background,
    borderRadius: 4,
  },
  newsTitle: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  newsMeta: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 1,
  },
});

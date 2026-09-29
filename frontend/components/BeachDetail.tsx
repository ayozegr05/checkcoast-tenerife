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
  beachShareUrl,
  fetchBeachIncidents,
  fetchBeachNearbyOutfalls,
  fetchBeachNews,
  fetchBeachQuality,
} from '../lib/api';
import {
  MONTHS_FULL,
  displayBeachName,
  fmtDate,
  fmtPartialDate,
} from '../lib/format';
import { pressSummary } from '../lib/press';
import { colors, fonts } from '../lib/theme';
import SatelliteShot from './SatelliteShot';
import ScrollChips from './ScrollChips';
import Skeleton from './Skeleton';

// Estado de playa: usa properties.status (de /beaches + /alerts)
const BEACH_STATUS: Record<string, { label: string; color: string }> = {
  closed: { label: 'Cierre activo', color: colors.status.closed },
  warning: { label: 'Aviso activo', color: colors.status.warning },
  unknown: { label: 'Sin datos oficiales', color: colors.status.unknown },
  open: { label: 'Sin alertas activas', color: colors.status.open },
};

// Un incidente es "cierre" si la observación prohíbe el baño; los
// eventos reconstruidos (analítica/prensa) siempre son cierres
const isClosure = (inc: BeachIncident) =>
  inc.via === 'press' ||
  inc.via === 'measurement' ||
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

// Fases de un episodio en orden narrativo: se cerró, hubo avisos o
// vertidos, y finalmente se reabrió
const NEWS_GROUP_ORDER = [
  'closure',
  'warning',
  'pollution',
  'reopening',
  'other',
];

// Tema de la causa como frase fluida para el título del grupo: el
// texto crudo del LLM varía ("exceso de enterococos", "niveles
// elevados de enterococos") pero el tema es el mismo
const NEWS_TOPIC_PHRASES: [RegExp, string][] = [
  [/enterococ/i, 'niveles elevados de enterococos'],
  [/e\.?\s?coli|escherichia/i, 'niveles elevados de E. coli'],
  [
    /gasoil|hidrocarbur|diésel|diesel|fuel|petr/i,
    'vertido de hidrocarburos',
  ],
  [/fecal|residual|depuradora|aguas?\s*sucias/i, 'vertido de aguas fecales'],
  [/alga/i, 'presencia de algas'],
  [/desprend|derrumb|talud/i, 'riesgo de desprendimientos'],
  [/obra|dragado|acceso/i, 'obras'],
  [/mar\s*agitad|corriente|oleaje|temporal|ola/i, 'mar agitado'],
  [/vertido|contamin|calidad/i, 'mala calidad del agua'],
];

const newsTopicPhrase = (cause: string | null): string | null => {
  if (!cause) return null;
  for (const [re, phrase] of NEWS_TOPIC_PHRASES) {
    if (re.test(cause)) return phrase;
  }
  return cause; // causa sin tema catalogado: se muestra su texto
};

// Frase del grupo: "Cierre · niveles elevados de enterococos",
// "Reapertura · mejora la calidad del agua". En reapertura la causa
// es siempre la misma — coletilla fija si el LLM extrajo algo
const newsGroupPhrase = (type: string, cause: string | null) => {
  if (type === 'reopening') {
    return cause ? 'mejora la calidad del agua' : null;
  }
  return newsTopicPhrase(cause);
};

// Color por fase: cierre/contaminación rojo, aviso ámbar, reapertura
// verde — el borde y la flecha del titular siguen la fase
const NEWS_PHASE_COLOR: Record<string, string> = {
  closure: colors.status.closed,
  pollution: colors.status.closed,
  warning: colors.status.warning,
  reopening: colors.status.open,
  other: colors.status.warning,
};

type NewsGroup = {
  type: string;
  label: string;
  items: BeachNews[];
};

// Titulares agrupados por fase + tema de causa en un solo título
// fluido ("Cierre · vertido de aguas fecales"): la misma noticia
// cubierta por varios medios queda como un solo bloque escaneable
function groupNewsItems(items: BeachNews[]): NewsGroup[] {
  const groups = new Map<string, NewsGroup>();
  for (const n of items) {
    const type = n.event_type ?? 'other';
    const phrase = newsGroupPhrase(type, n.cause);
    const key = `${type}|${phrase ?? ''}`;
    const g = groups.get(key) ?? {
      type,
      label: `${NEWS_EVENT_LABELS[type] ?? 'Noticia'}${
        phrase ? ` · ${phrase}` : ''
      }`,
      items: [],
    };
    g.items.push(n);
    groups.set(key, g);
  }
  return [...groups.values()].sort(
    (a, b) =>
      NEWS_GROUP_ORDER.indexOf(a.type) - NEWS_GROUP_ORDER.indexOf(b.type),
  );
}

// Fila de titular enlazable: borde y flecha con el color de la fase
// (o el del banner si es de reapertura)
function NewsItemRow({ n, accent }: { n: BeachNews; accent: string }) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.newsRow,
        { borderLeftColor: accent },
        pressed && styles.pressFx,
      ]}
      onPress={() => Linking.openURL(n.url).catch(() => {})}
      accessibilityRole="link"
      accessibilityLabel={`Noticia: ${n.title}`}
    >
      <View style={styles.newsRowBody}>
        <Text style={styles.newsTitle} numberOfLines={2}>
          {n.title}
        </Text>
        <Text style={styles.newsMeta} numberOfLines={1}>
          {[
            n.source,
            n.published_at ? fmtDate(n.published_at.slice(0, 10)) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <Text style={[styles.newsChevron, { color: accent }]}>›</Text>
    </Pressable>
  );
}

// Bloque completo de grupos: compartido por el banner y la expansión
// de cada fila del historial
function NewsGroupList({
  groups,
  accentOverride,
}: {
  groups: NewsGroup[];
  accentOverride?: string;
}) {
  return (
    <>
      {groups.map((g) => {
        const accent = accentOverride ?? NEWS_PHASE_COLOR[g.type];
        return (
          <View key={g.label} style={styles.newsGroup}>
            <Text style={styles.newsGroupTitle}>{g.label}</Text>
            {g.items.map((n) => (
              <NewsItemRow key={n.id} n={n} accent={accent} />
            ))}
          </View>
        );
      })}
    </>
  );
}

// Contenido de la ficha de playa, compartido entre la hoja sobre el mapa
// (FeatureSheet) y la vista detalle dentro de la lista (BeachList)
export default function BeachDetail({
  feature,
  hasAlert,
  outfalls,
  onViewOnMap,
  onSelectOutfall,
}: {
  feature: GeoFeature;
  hasAlert: boolean;
  // Emisarios cargados en la app: se superponen a la foto satélite
  outfalls?: GeoFeature[];
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
  const [openIncs, setOpenIncs] = useState<ReadonlySet<number>>(
    new Set(),
  );
  const toggleInc = (id: number) =>
    setOpenIncs((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
    // Etiqueta de año bajo la primera barra de cada año; yearSpan =
    // barras del año para decidir si la etiqueta cabe sin solaparse
    let lastYear = '';
    return rows.map((d, i) => {
      const year = d.date.slice(0, 4);
      const yearLabel = year !== lastYear ? year : null;
      lastYear = year;
      let yearSpan = 0;
      if (yearLabel) {
        for (let j = i; j < rows.length; j++) {
          if (rows[j].date.slice(0, 4) !== year) break;
          yearSpan++;
        }
      }
      return { ...d, yearLabel, yearSpan };
    });
  }, [quality, chartParam]);

  // Ancho de columna: repartir el ancho de la card entre las muestras;
  // mínimo 8px — si hay muchas, sigue habiendo scroll horizontal
  const colW =
    chartW > 0 && chartData.length > 0
      ? Math.max(8, chartW / chartData.length)
      : 8;

  // Índice de la última etiqueta de año: siempre se muestra aunque su
  // año tenga pocas barras (no hay etiqueta siguiente con la que solape)
  const lastYearIdx = chartData.reduce(
    (acc, d, i) => (d.yearLabel ? i : acc),
    -1,
  );

  // Huecos de muestreo >45 días entre muestras consecutivas (o desde la
  // última hasta hoy). Se distinguen dos casos:
  //  - anómalo: el hueco cubre meses en los que la playa SÍ suele tener
  //    muestras (Jardín jul-24→ene-25) → aviso ámbar
  //  - parada anual: el hueco solo cubre meses que nunca se muestrean
  //    (régimen estacional o parada navideña) → nota tenue declarando
  //    el calendario real de Sanidad para esa playa
  const sampleNote = useMemo<{
    text: string;
    anomalous: boolean;
  } | null>(() => {
    if (!quality || quality.length < 2) return null;
    const dates = quality.map((m) => m.sampled_at).sort();
    const sampledMonths = new Set(
      dates.map((d) => Number(d.slice(5, 7))),
    );
    const gaps: { a: string; b: string; open: boolean }[] = [];
    for (let i = 1; i < dates.length; i++) {
      if (
        (Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86400000 >
        45
      ) {
        gaps.push({ a: dates[i - 1], b: dates[i], open: false });
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    const last = dates[dates.length - 1];
    if ((Date.parse(today) - Date.parse(last)) / 86400000 > 45) {
      gaps.push({ a: last, b: today, open: true });
    }
    if (!gaps.length) return null;
    // Meses estrictamente dentro del hueco (pueden envolver el año)
    const interiorMonths = (a: string, b: string) => {
      const res: number[] = [];
      let y = Number(a.slice(0, 4));
      let m = Number(a.slice(5, 7)) + 1;
      const by = Number(b.slice(0, 4));
      const bm = Number(b.slice(5, 7));
      if (m > 12) {
        m = 1;
        y += 1;
      }
      while (y < by || (y === by && m < bm)) {
        res.push(m);
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
      }
      return res;
    };
    const anomalous = gaps.filter((g) =>
      interiorMonths(g.a, g.b).some((m) => sampledMonths.has(m)),
    );
    if (anomalous.length) {
      // "jul 2024" (con espacio) en los huecos reales
      const my = (iso: string) =>
        fmtPartialDate(iso.slice(0, 7)).replace('-', ' ');
      const parts = anomalous.map((g) =>
        g.open
          ? `desde ${my(g.a)}`
          : `entre ${my(g.a)} y ${my(g.b)}`,
      );
      return {
        text: `Anomalía: sin muestras ${parts.join(' · ')}`,
        anomalous: true,
      };
    }
    const longest = gaps.reduce((x, y) =>
      Date.parse(y.b) - Date.parse(y.a) > Date.parse(x.b) - Date.parse(x.a)
        ? y
        : x,
    );
    return {
      text:
        `Sanidad deja de muestrearla cada año entre ` +
        `${MONTHS_FULL[Number(longest.a.slice(5, 7)) - 1]} y ` +
        MONTHS_FULL[Number(longest.b.slice(5, 7)) - 1],
      anomalous: false,
    };
  }, [quality]);



  // Emisarios como marcadores de la foto satélite: su posición real se
  // proyecta al encuadre dentro de SatelliteShot
  const shotMarkers = useMemo(
    () =>
      (outfalls ?? []).map((o) => {
        const s = o.properties.status ?? 'unknown';
        return {
          id: o.id,
          coords: o.geometry.coordinates as [number, number],
          color: colors.outfall[s as keyof typeof colors.outfall] ??
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

  // Con cierre activo el "por qué" es lo primero que importa:
  // el banner de prensa sube bajo el chip, como en la landing /b/{id}
  const alertActive = beachKey === 'closed';
  const press = news !== null && news.items.length > 0
    ? pressSummary(news.summary, {
        stillClosed: pressStillClosed,
        reopenedAt: pressReopenedAt,
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
  const pressBanner = press !== null && (
    <View
      style={[styles.pressBanner, pressReopened && styles.pressBannerReopened]}
    >
      <Text
        style={[
          styles.pressBannerText,
          pressReopened && styles.pressBannerTextReopened,
        ]}
      >
        {press.main}
      </Text>
      <Text
        style={[
          styles.pressBannerSub,
          pressReopened && styles.pressBannerSubReopened,
        ]}
      >
        {press.sub}
      </Text>
      <Pressable
        onPress={() => setNewsOpen((v) => !v)}
        hitSlop={8}
        style={({ pressed }) => pressed && styles.pressFx}
        accessibilityRole="button"
        accessibilityLabel={
          newsOpen
            ? 'Ocultar titulares de prensa'
            : `Ver ${bannerItems.length} titulares de prensa`
        }
      >
        <Text
          style={[
            styles.newsToggle,
            pressReopened && styles.newsToggleReopened,
          ]}
        >
          {newsOpen
            ? 'Ocultar titulares ▴'
            : `Ver titulares (${bannerItems.length}) ▾`}
        </Text>
      </Pressable>
      {newsOpen && (
        <>
          <NewsGroupList
            groups={bannerGroups}
            accentOverride={
              pressReopened ? colors.status.open : undefined
            }
          />
          <Text style={styles.chartFoot}>
            Contexto de prensa: no altera el estado oficial (Náyade)
          </Text>
        </>
      )}
    </View>
  );

  return (
    <View>
      {/* Vista satélite del entorno: la playa en el centro y los
          emisarios catalogados situados en su posición real dentro del
          encuadre, coloreados por estado. La foto es clicable → mapa */}
      <SatelliteShot
        center={[lon, lat]}
        centerColor={statusColor}
        markers={shotMarkers}
        onPress={onViewOnMap}
      />

      <View style={styles.topRow}>
        <View style={[styles.chip, { backgroundColor: statusColor }]}>
          <Text style={styles.chipText}>{statusText}</Text>
        </View>
        <Pressable
          onPress={share}
          style={({ pressed }) => [
            styles.shareBtn,
            pressed && styles.pressFx,
          ]}
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

      {alertActive && pressBanner}

      {nearby !== null && nearby.length > 0 && (
        <View style={styles.nearbyTop}>
          <Text style={[styles.historyTitle, { marginBottom: 10 }]}>
            Emisarios cercanos:{' '}
            <Text style={[styles.historySub, { color: colors.text }]}>
              {nearby.length} a menos de 1 km · el más próximo a{' '}
              <Text
                style={
                  nearby[0].distance_m < 500
                    ? { color: colors.status.warning }
                    : undefined
                }
              >
                {fmtDistance(nearby[0].distance_m).replace(' ', ' ')}
              </Text>
              {' · aleja el zoom si no los ves'}
            </Text>
          </Text>
          {nearby.map((o) => {
            const accent =
              colors.outfall[o.status] ?? colors.status.unknown;
            const target = (outfalls ?? []).find(
              (f) => f.id === o.outfall_id,
            );
            return (
              <Pressable
                key={o.outfall_id}
                style={({ pressed }) => [
                  styles.outfallRow,
                  { borderLeftColor: accent },
                  pressed && styles.pressFx,
                ]}
                onPress={
                  target && onSelectOutfall
                    ? () => onSelectOutfall(target)
                    : undefined
                }
                disabled={!target || !onSelectOutfall}
                accessibilityRole="button"
                accessibilityLabel={`${o.name}, ver en el mapa`}
              >
                <View style={styles.outfallRowBody}>
                  <Text style={styles.outfallName} numberOfLines={1}>
                    {o.name}
                  </Text>
                  <Text style={styles.outfallMeta}>
                    {OUTFALL_STATUS_LABELS[o.status] ?? 'En trámite'}
                  </Text>
                </View>
                {/* Distancia como badge: columna escaneable para
                    comparar emisarios de un vistazo */}
                <Text style={[styles.outfallDist, { color: accent }]}>
                  {fmtDistance(o.distance_m)}
                </Text>
                {target && onSelectOutfall && (
                  <Text style={styles.outfallChevron}>›</Text>
                )}
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Sin alerta activa la prensa queda en su sitio: contexto
          histórico bajo los datos oficiales */}
      {!alertActive && pressBanner}

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
          {/* Sin scroll interno: la sección crece con su contenido y
              scrollea la ficha entera — un cajón fijo dejaba los
              titulares expandidos en una ventana diminuta */}
          <View>
            {incidents.map((inc) => {
              const closure = isClosure(inc);
              const unclassified = isUnclassified(inc);
              // Duración del episodio: hasta closed_at o hasta hoy
              const days = Math.max(
                1,
                Math.round(
                  (Date.parse(
                    inc.closed_at ??
                      new Date().toISOString().slice(0, 10),
                  ) -
                    Date.parse(inc.opened_at)) /
                    86400000,
                ),
              );
              const accent = closure
                ? colors.status.closed
                : colors.outfall.unknown;
              // Analítica con respaldo de prensa = cierre real, mismo
              // cartel que el oficial; la procedencia va abajo en gris
              const tag =
                inc.via === 'press'
                  ? 'SEGÚN PRENSA'
                  : inc.via === 'measurement' && !inc.press_confirmed
                    ? 'SEGÚN ANALÍTICA'
                    : inc.closed_at
                      ? closure
                        ? 'CIERRE'
                        : 'AVISO'
                      : unclassified
                        ? 'PENDIENTE'
                        : 'ACTIVA';
              return (
                <View
                  key={inc.id}
                  style={[styles.incident, { borderLeftColor: accent }]}
                >
                  <View style={styles.incidentHead}>
                    <Text style={styles.incidentDates}>
                      {inc.end_estimated
                        ? // Fin estimado (última mención): no se
                          // muestra — solo el día del cierre
                          fmtDate(inc.opened_at)
                        : `${fmtDate(inc.opened_at)} → ${
                            inc.closed_at
                              ? fmtDate(inc.closed_at)
                              : 'hoy'
                          } · ${days} ${days === 1 ? 'día' : 'días'}`}
                    </Text>
                    <View
                      style={[
                        styles.incidentTag,
                        { backgroundColor: accent },
                      ]}
                    >
                      <Text style={styles.incidentTagText}>{tag}</Text>
                    </View>
                  </View>
                  {inc.observations ? (
                    <Text style={styles.incidentObs}>
                      {unclassified
                        ? 'Muestra tomada pero nunca clasificada por Sanidad'
                        : inc.observations}
                    </Text>
                  ) : null}
                  {/* Evidencia del episodio: titulares que lo
                      sustentan (prensa) o lo corroboraron (oficial) */}
                  {(inc.press_items?.length ?? 0) > 0 && (
                    <>
                      <Pressable
                        onPress={() => toggleInc(inc.id)}
                        hitSlop={8}
                        style={({ pressed }) => pressed && styles.pressFx}
                        accessibilityRole="button"
                        accessibilityLabel={
                          openIncs.has(inc.id)
                            ? 'Ocultar titulares del episodio'
                            : `Ver ${inc.press_items!.length} titulares del episodio`
                        }
                      >
                        <Text style={styles.newsToggle}>
                          {openIncs.has(inc.id)
                            ? 'Ocultar titulares ▴'
                            : `Ver titulares (${inc.press_items!.length}) ▾`}
                        </Text>
                      </Pressable>
                      {/* Agrupados por fase del episodio: las
                          noticias de cierre y las de reapertura son
                          evidencias distintas del mismo suceso */}
                      {openIncs.has(inc.id) && (
                        <NewsGroupList
                          groups={groupNewsItems(inc.press_items!)}
                        />
                      )}
                    </>
                  )}
                </View>
              );
            })}
          </View>
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
          {beachKey === 'open' &&
          /prohib|calificar/i.test(quality[0].evaluation ?? '') ? (
            <Text style={styles.staleNote}>
              El incidente oficial ya está cerrado · pendiente de nueva
              muestra
            </Text>
          ) : null}
          {sampleNote ? (
            <Text
              style={
                sampleNote.anomalous
                  ? styles.gapNoteAnomaly
                  : styles.gapNote
              }
            >
              {sampleNote.text}
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
                      style={({ pressed }) => [
                        styles.toggleChip,
                        chartParam === param && styles.toggleChipOn,
                        pressed && styles.pressFx,
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
              <ScrollChips
                fadeRgb="255, 255, 255"
                a11yLabel="la gráfica"
                anchorEnd
              >
                <View style={styles.chartInner}>
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
                        {d.yearLabel &&
                        (d.yearSpan * colW >= 30 || i === lastYearIdx) ? (
                          <Text style={styles.yearText} numberOfLines={1}>
                            {d.yearLabel}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                </View>
              </ScrollChips>
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
  history: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  // "Emisarios cercanos" arriba de la ficha: sin borde superior, es el
  // primer bloque de contenido tras la fila de estado
  nearbyTop: {
    marginTop: 10,
    paddingTop: 2,
  },
  sourceFoot: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  historyTitle: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: colors.text,
    marginBottom: 4,
  },
  historySub: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textFaint,
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
  staleNote: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 4,
  },
  // Hueco de muestreo esperado (calendario de la playa): ámbar
  gapNote: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: colors.status.warning,
    marginTop: 4,
  },
  // Hueco anómalo (Sanidad dejó de medirla en periodo normal): rojo
  gapNoteAnomaly: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: colors.danger,
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
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  toggleChipOn: {
    backgroundColor: 'rgba(23,184,206,0.18)',
    borderColor: colors.accent,
  },
  toggleChipText: {
    fontSize: 10,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
  },
  toggleChipTextOn: {
    color: colors.primaryDark,
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
  chartInner: {
    paddingLeft: 8,
  },
  yearRow: {
    flexDirection: 'row',
    marginTop: 2,
    height: 22,
    paddingRight: 34,
  },
  yearCol: {
    width: 8,
    alignItems: 'flex-start',
  },
  yearText: {
    position: 'absolute',
    left: 2,
    top: 0,
    width: 34,
    fontSize: 8,
    fontFamily: fonts.semibold,
    color: colors.textFaint,
    transform: [{ rotate: '45deg' }],
    transformOrigin: 'left top',
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
    flexDirection: 'row',
    alignItems: 'center',
  },
  outfallChevron: {
    fontSize: 16,
    fontFamily: fonts.semibold,
    color: colors.textFaint,
    paddingRight: 8,
  },
  outfallRowBody: {
    flex: 1,
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
  outfallDist: {
    fontSize: 13,
    fontFamily: fonts.bold,
    alignSelf: 'center',
    marginRight: 6,
    minWidth: 46,
    textAlign: 'right',
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
  pressBanner: {
    marginTop: 8,
    borderLeftWidth: 3,
    borderLeftColor: colors.status.warning,
    backgroundColor: '#fff3e0',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  pressBannerReopened: {
    borderLeftColor: colors.status.open,
    backgroundColor: '#e6f4f1',
  },
  pressBannerText: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: colors.status.warning,
  },
  pressBannerTextReopened: {
    color: colors.status.open,
  },
  pressBannerSub: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.status.warning,
    marginTop: 1,
  },
  pressBannerSubReopened: {
    color: colors.status.open,
  },
  newsToggle: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.status.warning,
    marginBottom: 4,
  },
  // En el banner de reapertura (verde) el enlace sigue la paleta
  newsToggleReopened: {
    color: colors.status.open,
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

  // Cada titular es una tarjeta blanca dentro de la caja ámbar "según
  // prensa": el blanco la separa del crema y el chevron naranja al
  // final anuncia que es pulsable (abre el artículo)
  newsRow: {
    borderLeftWidth: 3,
    borderLeftColor: colors.status.warning,
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 4,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderRadius: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  newsRowBody: {
    flex: 1,
  },
  newsChevron: {
    fontSize: 18,
    fontFamily: fonts.extrabold,
    color: colors.status.warning,
    marginLeft: 6,
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

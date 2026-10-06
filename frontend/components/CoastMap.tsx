import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Image,
  Keyboard,
  LayoutAnimation,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Images,
  Layer,
  Map,
  type CameraRef,
  type PressEventWithFeatures,
  type StyleSpecification,
} from '@maplibre/maplibre-react-native';

import type {
  FeatureCollection,
  GeoFeature,
  MunicipalityIncident,
} from '../lib/api';
import {
  beachBaseName,
  beachPointLabel,
  displayBeachName,
  fmtDate,
  formatDays,
  searchNorm,
} from '../lib/format';
import { foldCount, foldSummary } from '../lib/alertFold';
import { episodeDays, recentlyResolved } from '../lib/episodes';
import { groupKeyOf } from '../lib/beachGroups';
import { colors, fonts } from '../lib/theme';
import seaStyle from '../assets/mapstyle-sea.json';

// Estilo vectorial tematico (OpenFreeMap/OpenMapTiles retenido con la
// paleta oceanica por scripts/gen_mapstyle.py). Sin API key.
const SEA_STYLE = seaStyle as unknown as StyleSpecification;

// Estilo raster satélite con PNOA del IGN (ortofoto oficial española,
// WMTS público sin key): cobertura uniforme — Esri World Imagery deja
// tiles placeholder negros en Anaga/Teide a cualquier zoom. Las
// etiquetas siguen siendo la capa transparente de Esri (híbrido).
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    pnoa: {
      type: 'raster',
      tiles: [
        'https://www.ign.es/wmts/pnoa-ma?SERVICE=WMTS&REQUEST=GetTile&LAYER=OI.OrthoimageCoverage&STYLE=default&TileMatrixSet=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}&FORMAT=image/jpeg',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'IGN España · PNOA',
    },
    'esri-labels': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Esri',
    },
  },
  layers: [
    { id: 'pnoa', type: 'raster', source: 'pnoa' },
    { id: 'esri-labels', type: 'raster', source: 'esri-labels' },
  ],
};

// Vista inicial: la isla entera encuadrada con margen (fitBounds se
// adapta al tamaño de pantalla, a diferencia de un zoom fijo)
const TENERIFE_BOUNDS = {
  bounds: [-16.95, 27.98, -16.1, 28.58] as [number, number, number, number],
  padding: { top: 110, right: 24, bottom: 70, left: 24 },
};
// Centro/zom equivalente para restaurar la vista tras cerrar una card
const TENERIFE_VIEW = {
  center: [-16.6291, 28.2916] as [number, number],
  zoom: 9,
};

export type Selection =
  | { type: 'outfall'; feature: GeoFeature }
  | {
      type: 'beach';
      feature: GeoFeature;
      hasAlert: boolean;
      // Puntos de muestreo del grupo (si la playa tiene varios PMs):
      // la card muestra primero un selector para elegir cuál ver
      members?: GeoFeature[];
    };

type CoastMapProps = {
  outfalls: FeatureCollection;
  beaches: FeatureCollection; // con properties.alert ya inyectado
  // [lon, lat, zoom?, tipoCard?] a donde volar la cámara; con zoom
  // explícito y SIN tipo se centra exacto (pin sin card). Con tipo,
  // se aplica el padding de la card que se abre (beach | outfall)
  focus?: [number, number, number?, ('beach' | 'outfall')?] | null;
  selectionActive: boolean; // hay card abierta -> al cerrar restaura vista
  // id del PM representante de la playa seleccionada: su etiqueta de
  // nombre se pinta en una capa propia que gana siempre los solapes
  selectedBeachId?: number | null;
  // id del vertido seleccionado: su pin se dibuja más grande (los
  // emisarios no llevan etiqueta de nombre)
  selectedOutfallId?: number | null;
  // Puntos de muestreo de la playa seleccionada (capa temporal de
  // dots coloreados por estado mientras la card está abierta)
  pmPoints?: FeatureCollection;
  // Zona concreta abierta en la ficha multipunto (null = selector de
  // zonas): el encuadre sube un poco para que los dots respiren por
  // encima de la ficha más alta
  zoneFocus?: GeoFeature | null;
  onSelect: (selection: Selection) => void;
  // Cierra la card abierta (Ayuda/Buscar la pisaban por encima)
  onDismissSelection?: () => void;
  onOpenList?: () => void;
  onOpenMunicipalities?: () => void;
  onOpenOutfalls?: () => void;
  onOpenHelp?: () => void;
  // Episodios insulares (oficiales + reconstruidos): alimentan la
  // cabecera del banner y la sección "Resueltas recientemente"
  episodes?: MunicipalityIncident[];
  // Abre el panel de municipios en la vista Temporada (enlace del
  // banner de alertas)
  onOpenTemporada?: () => void;
};

const OUTFALL_COLORS = colors.outfall;
const STRUCTURAL_SECTION = 'Cierre estructural';
const BEACH_COLORS = colors.status;

// Solo un grupo con >=2 puntos de muestreo reales (etiqueta "PM" o
// romano) abre el selector de PMs en la card: duplicados OSM sin
// etiqueta agrupados por nombre (p.ej. La Hornilla) quedan como
// playa simple
const pmMembersOf = (members?: GeoFeature[]) => {
  const labeled = (members ?? []).filter((m) =>
    beachPointLabel(m.properties.name),
  );
  return labeled.length > 1 ? labeled : undefined;
};

// Categoría visual del pin — la misma lógica que elige el icono:
// OSM sin monitorizar y playas de estado desconocido comparten pin
// gris, así que el filtro "Sin monitorizar" las cubre a ambas
const beachCategory = (f: GeoFeature): string =>
  f.properties.monitored === false && f.properties.alert !== true
    ? 'unmonitored'
    : f.properties.status && f.properties.status !== 'unknown'
      ? (f.properties.status as string)
      : 'unmonitored';

// Emisarios: todo lo que no es legal/illegal lleva el pin "en trámite"
const outfallCategory = (f: GeoFeature): string =>
  f.properties.status === 'legal' || f.properties.status === 'illegal'
    ? (f.properties.status as string)
    : 'unknown';

const BEACH_STATES: [string, string, string][] = [
  [colors.status.open, 'Apta', 'open'],
  [colors.status.warning, 'Aviso', 'warning'],
  [colors.status.closed, 'Cerrada', 'closed'],
  [colors.status.unmonitored, 'Sin monitorizar', 'unmonitored'],
];
// Categorías de causa que el backend emite para cierres estructurales
// (_STRUCTURAL_CAUSES en queries.py) — se mantienen en el tiempo, al
// contrario que un episodio de contaminación
const STRUCTURAL_CAUSES = new Set([
  'Desprendimientos',
  'Obras',
  'Colapso del terreno',
]);
const OUTFALL_STATES: [string, string, string][] = [
  [colors.outfall.legal, 'Autorizado', 'legal'],
  [colors.outfall.illegal, 'No autorizado', 'illegal'],
  [colors.outfall.unknown, 'En trámite', 'unknown'],
];

// Toggle inmutable de un estado en su set de la leyenda
const toggleInSet = (set: Set<string>, key: string) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

type SearchItem = {
  key: string;
  kind: 'beach' | 'outfall' | 'municipality';
  label: string;
  sub: string;
  feature?: GeoFeature;
  members?: GeoFeature[];
  center?: [number, number];
};

export default function CoastMap({
  outfalls,
  beaches,
  focus,
  selectionActive,
  selectedBeachId,
  selectedOutfallId,
  pmPoints,
  zoneFocus = null,
  onSelect,
  onDismissSelection,
  onOpenList,
  onOpenMunicipalities,
  onOpenOutfalls,
  onOpenHelp,
  episodes = [],
  onOpenTemporada,
}: CoastMapProps) {
  const [satellite, setSatellite] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Lista desplegable de playas en aviso (banner de alertas)
  const [alertsOpen, setAlertsOpen] = useState(false);
  // "N más" de la sección estructural; vuelve a plegarse al cerrar
  const [structuralOpen, setStructuralOpen] = useState(false);
  useEffect(() => {
    if (!alertsOpen) setStructuralOpen(false);
  }, [alertsOpen]);
  // Panel de capas por estado (botón flotante junto a la brújula)
  const [layersOpen, setLayersOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Ref del buscador: Keyboard.dismiss() solo no basta en Android —
  // el input conserva el foco y el teclado se queda tapando la card
  const searchInputRef = useRef<TextInput>(null);
  // Cada estado de la leyenda es una sub-capa marcable: marcado =
  // visible, desmarcado = oculto. Empiezan todas marcadas; el set
  // vacío equivale a la capa apagada (no hay switch aparte)
  const [beachSel, setBeachSel] = useState<Set<string>>(
    () => new Set(['open', 'warning', 'closed', 'unmonitored']),
  );
  const [outfallSel, setOutfallSel] = useState<Set<string>>(
    () => new Set(['legal', 'illegal', 'unknown']),
  );
  const [pulse, setPulse] = useState(0);
  // Dots PM visibles solo con la card de un grupo abierta: el pin del
  // centroide sería un duplicado sobre puntos oficiales → se retira
  const pmShown = !!(pmPoints && pmPoints.features.length > 0);
  const cameraRef = useRef<CameraRef>(null);
  const { height: winH } = useWindowDimensions();
  // Con la card abierta el pin se apoya en el borde superior de la
  // card, no en el centro de la franja libre: el nombre de la playa se
  // dibuja BAJO el pin (~40px) y la card plegada puede cubrir hasta el
  // 64% del alto (PEEK_MAX de FeatureSheet) + 44px que flota sobre el
  // borde — su borde superior queda a 0.36·winH-44. Reservar abajo
  // 0.28·winH+308 centra el punto ~50px sobre ese borde: la etiqueta
  // queda visible y el pin lo más bajo posible. El clamp garantiza una
  // franja libre mínima en pantallas bajas/horizontal
  const CARD_PAD = {
    top: 120,
    bottom: Math.min(Math.round(winH * 0.28) + 348, winH - 180),
  };
  // La card de vertido flota alta (~30%): su pin sube un poco más que
  // el de playa para no quedar tapado por la ficha
  const CARD_PAD_OUTFALL = {
    top: 120,
    bottom: Math.min(Math.round(winH * 0.5) + 140, winH - 180),
  };

  // Vista actual + vista guardada antes de volar a un pin (para restaurar
  // al cerrar la card)
  const lastView = useRef<{ center: [number, number]; zoom: number }>({
    center: TENERIFE_VIEW.center,
    zoom: TENERIFE_VIEW.zoom,
  });
  const savedView = useRef<{
    center: [number, number];
    zoom: number;
  } | null>(null);
  // Marca si el usuario arrastró el mapa a mano después del último
  // vuelo automático — si lo hizo, al cerrar la card no se restaura
  // la vista previa: se quedó donde él decidió
  const userPanned = useRef(false);
  const prevSelection = useRef(selectionActive);

  const saveView = () => {
    // Cada vuelo automático resetea la marca de paneo manual
    userPanned.current = false;
    // Solo guarda si venimos de mapa libre: al cambiar de playa con la
    // card ya abierta no machaca la posicion original
    if (!selectionActive) savedView.current = { ...lastView.current };
  };

  // Un grupo multi-PM no se encuadra a zoom fijo 15.5 sobre el
  // centroide (los PMs de los extremos quedaban fuera, debajo del
  // banner de alertas o bajo la card): se ajusta el bbox real de los
  // miembros con margen lateral y aire extra arriba para el banner
  const fitBeachBounds = (members: GeoFeature[], duration: number) => {
    const lons = members.map((m) => m.geometry.coordinates[0]);
    const lats = members.map((m) => m.geometry.coordinates[1]);
    cameraRef.current?.fitBounds(
      [
        Math.min(...lons),
        Math.min(...lats),
        Math.max(...lons),
        Math.max(...lats),
      ],
      {
        padding: {
          top: CARD_PAD.top + 60,
          right: 64,
          bottom: CARD_PAD.bottom,
          left: 64,
        },
        duration,
      },
    );
  };

  // Ficha de una zona abierta: paneo puro, SIN tocar el zoom — mover
  // el centro hacia el sur desplaza el contenido hacia arriba unos
  // píxeles para que los dots respiren sobre la ficha. Al volver al
  // selector se restaura el centro previo
  const LIFT_PX = 20;
  const prevZoneFocus = useRef<GeoFeature | null>(null);
  const preLiftCenter = useRef<[number, number] | null>(null);
  useEffect(() => {
    const prev = prevZoneFocus.current;
    prevZoneFocus.current = zoneFocus;
    if (!pmShown) return;
    const opening = !!zoneFocus && !prev;
    const closing = !zoneFocus && !!prev;
    if (!opening && !closing) return;
    const { center, zoom } = lastView.current;
    // Mismo padding que fitBeachBounds: con padding 0 el centro pasaría
    // al centro real de pantalla y el contenido caería ~200px solo por
    // el reseteo de padding, tapando el desplazamiento que queremos
    const pad = {
      top: CARD_PAD.top + 60,
      right: 64,
      bottom: CARD_PAD.bottom,
      left: 64,
    };
    if (opening) {
      preLiftCenter.current = center;
      // Centro hacia el SUR = los puntos quedan al norte del centro y
      // el contenido aparece más arriba en pantalla
      const mpp =
        (156543.03 * Math.cos((center[1] * Math.PI) / 180)) / 2 ** zoom;
      const dLat = (LIFT_PX * mpp) / 111320;
      cameraRef.current?.flyTo({
        center: [center[0], center[1] - dLat],
        zoom,
        padding: pad,
        duration: 400,
      });
    } else {
      // Solo restaura si la zona cerrada sigue perteneciendo al grupo
      // visible (vuelta al selector). Si la selección saltó a otra
      // playa, zoneFocus llega obsoleto y el encuadre nuevo manda —
      // sin este filtro el mapa volaba de vuelta al grupo anterior
      const sameGroup = pmPoints!.features.some(
        (f) => f.id === prev!.id,
      );
      if (sameGroup && preLiftCenter.current) {
        cameraRef.current?.flyTo({
          center: preLiftCenter.current,
          zoom,
          padding: pad,
          duration: 400,
        });
      }
      preLiftCenter.current = null;
    }
  }, [zoneFocus, pmShown]);

  // Card cerrada -> vuelve a la vista previa al toque del pin, SOLO si
  // el usuario no movió el mapa a mano mientras la ficha estaba
  // abierta (si lo movió, esa posición es la que quiere)
  useEffect(() => {
    if (
      prevSelection.current &&
      !selectionActive &&
      savedView.current &&
      !userPanned.current
    ) {
      cameraRef.current?.flyTo({
        center: savedView.current.center,
        zoom: savedView.current.zoom,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        duration: 800,
      });
    }
    if (!selectionActive) savedView.current = null;
    prevSelection.current = selectionActive;
  }, [selectionActive]);

  // Vuela a una playa en aviso y abre su ficha (lista del banner).
  // No guarda vista previa: navegar a una alerta es decisión del
  // usuario, no un toque accidental de pin — al cerrar no se restaura
  const openAlertBeach = (f: GeoFeature) => {
    closeSearch();
    userPanned.current = false;
    savedView.current = null;
    // El pin se dibuja en el centroide del grupo, no en las coords del
    // PM: la cámara apunta al mismo punto o queda descolocado
    const gk = (f.properties as { groupKey?: string }).groupKey;
    const g = gk ? beachGroups.get(gk) : undefined;
    const [lon, lat] = (g?.center ??
      (f.geometry as { coordinates: [number, number] }).coordinates) as [
      number,
      number,
    ];
    if (g && g.members.length > 1) {
      fitBeachBounds(g.members, 1200);
    } else {
      cameraRef.current?.flyTo({
        center: [lon, lat],
        zoom: 15.5,
        padding: CARD_PAD,
        duration: 1200,
      });
    }
    onSelect({
      type: 'beach',
      feature: f,
      hasAlert: true,
      members: pmMembersOf(gk ? beachGroups.get(gk)?.members : undefined),
    });
    setAlertsOpen(false);
  };

  // Agrupación por playa: cada punto de muestreo (PM1, PM2, Troya I/II)
  // es un registro oficial distinto, pero el mapa dibuja UN pin por
  // playa en el centroide, coloreado por el peor estado del grupo.
  // La ficha que se abre es la del PM peor parado (representante).
  const beachGroups = useMemo(() => {
    // globalThis.Map: "Map" aquí es el componente de MapLibre
    const groups = new globalThis.Map<
      string,
      {
        members: GeoFeature[];
        rep: GeoFeature;
        center: [number, number];
      }
    >();
    for (const f of beaches.features) {
      const key = groupKeyOf(f);
      const g = groups.get(key) ?? {
        members: [],
        rep: f,
        center: [0, 0] as [number, number],
      };
      g.members.push(f);
      groups.set(key, g);
    }
    const rank = (f: GeoFeature) => {
      const s =
        f.properties.monitored === false && f.properties.alert !== true
          ? 'unmonitored'
          : (f.properties.status ?? 'unknown');
      return (
        { closed: 0, warning: 1, unknown: 2, open: 3, unmonitored: 4 }[s] ?? 5
      );
    };
    for (const g of groups.values()) {
      // Orden estable del selector de PMs (PM1<PM2, Troya I<II)
      g.members.sort((a, b) =>
        a.properties.name.localeCompare(b.properties.name),
      );
      g.rep = g.members.reduce(
        (a, b) => (rank(b) < rank(a) ? b : a),
        g.members[0],
      );
      const n = g.members.length;
      g.center = [
        g.members.reduce((s, f) => s + f.geometry.coordinates[0], 0) / n,
        g.members.reduce((s, f) => s + f.geometry.coordinates[1], 0) / n,
      ];
    }
    return groups;
  }, [beaches]);

  // Un pin por playa: geometría del centroide + propiedades del PM
  // representante (peor estado) + groupKey para resolver al pulsar
  const groupedBeaches = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: [...beachGroups.entries()].map(([key, g]) => ({
        ...g.rep,
        geometry: { type: 'Point' as const, coordinates: g.center },
        properties: {
          ...g.rep.properties,
          groupKey: key,
          members: g.members.length,
          // Nombre corto para la etiqueta del pin (zoom cercano)
          label: displayBeachName(beachBaseName(g.rep.properties.name)),
          // Marca de seleccionada: su etiqueta va en capa propia.
          // Casa contra cualquier PM del grupo, no solo el rep — si la
          // card cambia de PM la etiqueta de la playa sigue puesta
          sel: g.members.some((m) => m.id === selectedBeachId),
        },
      })),
    }),
    [beachGroups, selectedBeachId],
  );

  // Conteo de alertas vivas: por playa (grupo), no por punto de muestreo
  const closedCount = groupedBeaches.features.filter(
    (f) => f.properties.status === 'closed',
  ).length;
  const warningCount = groupedBeaches.features.filter(
    (f) => f.properties.status === 'warning',
  ).length;
  const hasAlerts = closedCount + warningCount > 0;

  // Vertido seleccionado: propiedad sel para agrandar su pin (los
  // emisarios no llevan etiqueta de nombre)
  const outfallsMarked = useMemo<FeatureCollection>(
    () => ({
      ...outfalls,
      features: outfalls.features.map((f) => ({
        ...f,
        properties: {
          ...f.properties,
          sel: f.id === selectedOutfallId,
        },
      })),
    }),
    [outfalls, selectedOutfallId],
  );

  const alertBeaches = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      // Sin filtro de monitorizada: una playa OSM cerrada según
      // prensa (Benijo) también es una alerta de verdad
      features: groupedBeaches.features.filter(
        (f) =>
          f.properties.status === 'closed' || f.properties.status === 'warning',
      ),
    }),
    [groupedBeaches],
  );

  // Dos grandes categorías de alerta: contaminación (transitoria) y
  // cierre estructural (desprendimientos/obras/colapso — se mantiene
  // en el tiempo). Dentro de cada sección, de la más reciente a la
  // más antigua por inicio real de la alerta (alerted_at)
  const alertSections = useMemo<[string, GeoFeature[]][]>(() => {
    const byWhen = (a: GeoFeature, b: GeoFeature) =>
      (b.properties.alerted_at ?? b.properties.reported_at ?? '').localeCompare(
        a.properties.alerted_at ?? a.properties.reported_at ?? '',
      );
    const isStructural = (f: GeoFeature) =>
      f.properties.status === 'closed' &&
      !!f.properties.alert_cause &&
      STRUCTURAL_CAUSES.has(f.properties.alert_cause);
    const contam = alertBeaches.features
      .filter((f) => f.properties.status === 'closed' && !isStructural(f))
      .sort(byWhen);
    const structural = alertBeaches.features.filter(isStructural).sort(byWhen);
    const warnings = alertBeaches.features
      .filter((f) => f.properties.status === 'warning')
      .sort(byWhen);
    return [
      ['Contaminación', contam],
      [STRUCTURAL_SECTION, structural],
      ['Avisos', warnings],
    ].filter(([, fs]) => fs.length > 0) as [string, GeoFeature[]][];
  }, [alertBeaches]);

  // Marcas de la leyenda: se aplican sobre la FC entera del source —
  // pins, etiquetas, seleccionada y pulso quedan filtrados de una vez
  const visibleBeaches = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: groupedBeaches.features.filter((f) =>
        beachSel.has(beachCategory(f)),
      ),
    }),
    [groupedBeaches, beachSel],
  );

  const visibleOutfalls = useMemo<FeatureCollection>(
    () => ({
      ...outfallsMarked,
      features: outfallsMarked.features.filter((f) =>
        outfallSel.has(outfallCategory(f)),
      ),
    }),
    [outfallsMarked, outfallSel],
  );

  // Episodios insulares: cabecera del banner + sección verde
  // "Reabiertas recientemente" (puente del push de reapertura — el
  // usuario la recibe y la confirmación vive aquí). Los "activos" son
  // las alertas VIVAS (closedCount+warningCount), no los episodios
  // abiertos: un cierre estructural sin prensa fresca sigue cerrado
  // aunque su episodio lleve fin estimado (Benijo)
  const resueltas = useMemo(() => recentlyResolved(episodes, 30), [episodes]);
  // Una playa resuelta abre su ficha igual que una alerta: episodio →
  // PM representativo → feature del mapa
  const openEpisodeBeach = (beachId: number) => {
    const f = beaches.features.find((x) => x.id === beachId);
    if (f) openAlertBeach(f);
  };

  // El pulso respeta el filtro; la lista del banner no (es global)
  const visibleAlertBeaches = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: visibleBeaches.features.filter(
        (f) =>
          f.properties.status === 'closed' || f.properties.status === 'warning',
      ),
    }),
    [visibleBeaches],
  );

  // Pulso de alerta: con la card multipunto abierta, el halo deja el
  // centroide (que podía caer sobre una zona abierta — Jardín caía
  // sobre la zona 5) y se mueve a las coordenadas reales de las
  // zonas que están cerradas o en aviso
  const alertPulse = useMemo<FeatureCollection>(() => {
    if (!pmPoints || pmPoints.features.length === 0)
      return visibleAlertBeaches;
    const memberIds = new Set(pmPoints.features.map((f) => f.id));
    return {
      type: 'FeatureCollection',
      features: [
        ...visibleAlertBeaches.features.filter(
          (f) => !memberIds.has(f.id),
        ),
        ...pmPoints.features.filter(
          (f) =>
            (f.properties.status === 'closed' ||
              f.properties.status === 'warning') &&
            beachSel.has(beachCategory(f)),
        ),
      ],
    };
  }, [visibleAlertBeaches, pmPoints, beachSel]);

  // Halo que crece y se desvance ~1 ciclo/seg solo si hay alertas
  useEffect(() => {
    if (!hasAlerts) return;
    const t = setInterval(() => setPulse((p) => (p + 0.1) % 1), 110);
    return () => clearInterval(t);
  }, [hasAlerts]);

  // Vuela a la playa elegida en la lista
  useEffect(() => {
    if (focus) {
      userPanned.current = false;
      savedView.current = null;
      const exact = focus[2] != null;
      // Si el foco casa con un PM de un grupo, el pin está en el
      // centroide: volar ahí, no a las coords del PM
      let cx = focus[0];
      let cy = focus[1];
      let grp: { members: GeoFeature[]; center: [number, number] } | undefined;
      for (const g of beachGroups.values()) {
        if (
          g.members.some(
            (m) =>
              Math.abs(m.geometry.coordinates[0] - focus[0]) < 1e-6 &&
              Math.abs(m.geometry.coordinates[1] - focus[1]) < 1e-6,
          )
        ) {
          [cx, cy] = g.center;
          grp = g;
          break;
        }
      }
      // Grupo multi-PM: encuadra todos los puntos — también con zoom
      // explícito ("Ver en mapa", deep-link): ver el pin de una zona
      // sin las hermanas era zoom demasiado cerca
      if (grp && grp.members.length > 1) {
        fitBeachBounds(grp.members, 1500);
        return;
      }
      cameraRef.current?.flyTo({
        center: [cx, cy],
        zoom: focus[2] ?? 15.5,
        // Card abierta (o a punto) → padding para no tapar el pin:
        // tipo explícito en el foco, o sin zoom exacto el de playa
        padding: focus[3]
          ? focus[3] === 'outfall'
            ? CARD_PAD_OUTFALL
            : CARD_PAD
          : exact
            ? undefined
            : CARD_PAD,
        duration: 1500,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // Resultados del buscador: playas, vertidos y municipios que
  // contienen la query (mínimo 2 caracteres)
  const searchResults = useMemo<SearchItem[]>(() => {
    const q = searchNorm(query);
    if (q.length < 2) return [];
    const items: SearchItem[] = [];
    // Playas agrupadas como en el mapa: "troya" da UN resultado
    // (casa también por el nombre de cualquiera de sus PMs)
    for (const [key, g] of beachGroups) {
      const label = displayBeachName(beachBaseName(g.rep.properties.name));
      const hay = searchNorm(
        [label, ...g.members.map((m) => m.properties.name)].join(' '),
      );
      if (hay.includes(q)) {
        items.push({
          key: `b${key}`,
          kind: 'beach',
          label,
          sub:
            (g.rep.properties.municipality ?? 'Playa') +
            (g.members.length > 1 ? ` · ${g.members.length} zonas` : ''),
          feature: g.rep,
          members: g.members,
          center: g.center,
        });
      }
    }
    for (const f of outfalls.features) {
      if (searchNorm(f.properties.name ?? '').includes(q)) {
        items.push({
          key: `o${f.id}`,
          kind: 'outfall',
          label: displayBeachName(f.properties.name ?? ''),
          sub: 'Emisario',
          feature: f,
        });
      }
    }
    const munis = new Set(
      beaches.features
        .map((f) => f.properties.municipality)
        .filter((m): m is string => !!m),
    );
    for (const m of munis) {
      if (searchNorm(m).includes(q)) {
        const pts = beaches.features.filter(
          (f) => f.properties.municipality === m,
        );
        items.push({
          key: `m${m}`,
          kind: 'municipality',
          label: m,
          sub: 'Municipio',
          center: [
            pts.reduce((s, f) => s + f.geometry.coordinates[0], 0) / pts.length,
            pts.reduce((s, f) => s + f.geometry.coordinates[1], 0) / pts.length,
          ],
        });
      }
    }
    return items.slice(0, 8);
  }, [query, beachGroups, outfalls]);

  const pickResult = (item: SearchItem) => {
    setQuery('');
    setSearchOpen(false);
    // Blur + dismiss: el blur suelta el foco del input (si no, el
    // teclado puede quedarse abierto tapando la card del selector PM)
    searchInputRef.current?.blur();
    Keyboard.dismiss();
    // Búsqueda deliberada: no guarda vista previa — al cerrar la card
    // el mapa se queda donde el usuario decidió ir, no rebota atrás.
    // También invalida una vista guardada de un pin anterior
    userPanned.current = false;
    savedView.current = null;
    if (item.feature) {
      // Playa agrupada: vuela al centroide (o bbox de los PMs si es
      // grupo multi-punto); ficha del PM representante
      const [lon, lat] = item.center ?? item.feature.geometry.coordinates;
      if (item.kind === 'beach' && (item.members?.length ?? 0) > 1) {
        fitBeachBounds(item.members ?? [], 1200);
      } else {
        cameraRef.current?.flyTo({
          center: [lon, lat],
          zoom: item.kind === 'beach' ? 15.5 : 13.5,
          padding: item.kind === 'outfall' ? CARD_PAD_OUTFALL : CARD_PAD,
          duration: 1200,
        });
      }
      onSelect(
        item.kind === 'beach'
          ? {
              type: 'beach',
              feature: item.feature,
              hasAlert: item.feature.properties.alert === true,
              members: pmMembersOf(item.members),
            }
          : { type: 'outfall', feature: item.feature },
      );
    } else if (item.center) {
      cameraRef.current?.flyTo({
        center: item.center,
        zoom: 11,
        duration: 1400,
      });
    }
  };

  // La búsqueda se cierra al tocar el mapa o cualquier otro botón de
  // la topbar — no solo al volver a pulsar la lupa o elegir resultado
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
    searchInputRef.current?.blur();
    Keyboard.dismiss();
  };
  // Lo mismo para el desplegable de avisos del banner y el panel de
  // capas — tocar el mapa u otro botón cierra lo que esté abierto
  // Atrás con buscador/avisos/capas abierto: se cierra el overlay, no
  // la app. Al re-suscribirse en cada cambio este listener queda el
  // más reciente y corre antes que el handler de selección de App
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (searchOpen || alertsOpen || layersOpen) {
        closeOverlays();
        return true;
      }
      return false;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen, alertsOpen, layersOpen]);

  const closeOverlays = () => {
    closeSearch();
    setAlertsOpen(false);
    setLayersOpen(false);
  };

  // Fila del panel de capas: checkbox cuadrado + dot de color + label.
  // Marcado = visible en el mapa
  const checkRow = (
    rowKey: string,
    color: string,
    label: string,
    on: boolean,
    onPress: () => void,
    isAll = false,
  ) => (
    <Pressable
      key={rowKey}
      style={({ pressed }) => [
        styles.layerItem,
        pressed && styles.layerItemPressed,
      ]}
      onPress={onPress}
      accessibilityRole="togglebutton"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
    >
      <View
        style={[
          styles.check,
          { borderColor: color },
          on && { backgroundColor: color },
        ]}
      >
        {on && <Text style={styles.checkMark}>✓</Text>}
      </View>
      {!isAll && <View style={[styles.dot, { backgroundColor: color }]} />}
      <Text
        style={[
          styles.layerItemText,
          isAll && styles.layerItemTextAll,
          !on && styles.layerItemTextOff,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );

  // Sección del panel (Emisarios / Playas): cabecera + fila Todas +
  // una fila por estado
  const layerSection = (
    title: string,
    allLabel: string,
    states: [string, string, string][],
    sel: Set<string>,
    setSel: React.Dispatch<React.SetStateAction<Set<string>>>,
  ) => {
    const allOn = sel.size === states.length;
    return (
      <View style={styles.layerSection}>
        <Text style={styles.layerHead}>{title}</Text>
        {checkRow(
          `${title}-all`,
          colors.primary,
          allLabel,
          allOn,
          () => setSel(allOn ? new Set() : new Set(states.map(([, , k]) => k))),
          true,
        )}
        {states.map(([color, label, key]) =>
          checkRow(key, color, label, sel.has(key), () =>
            setSel((s) => toggleInSet(s, key)),
          ),
        )}
      </View>
    );
  };

  const handlePress =
    (type: 'outfall' | 'beach') =>
    (e: NativeSyntheticEvent<PressEventWithFeatures>) => {
      const candidates = (e.nativeEvent.features ??
        []) as unknown as GeoFeature[];
      if (!candidates.length) return;
      // Un tap en pin no es un tap al mapa: sin esto la card se abría
      // debajo del buscador / alertas / panel de capas
      closeOverlays();
      // Los pines se solapan (icon-allow-overlap) y el hit-test devuelve
      // todos los candidatos: gana el más cercano al punto tocado, no
      // el primero por orden interno del source
      const [tapLon, tapLat] = e.nativeEvent.lngLat;
      const feature = candidates.reduce((best, f) => {
        const [lon, lat] = f.geometry.coordinates;
        const [bLon, bLat] = best.geometry.coordinates;
        return (lon - tapLon) ** 2 + (lat - tapLat) ** 2 <
          (bLon - tapLon) ** 2 + (bLat - tapLat) ** 2
          ? f
          : best;
      });
      saveView();
      // Zoom de detalle; el padding de cámara deja el pin en la franja
      // libre sobre la card. En playas el pin está en el centroide del
      // grupo, no en las coords del PM tocado
      const groupKey = (feature.properties as { groupKey?: string }).groupKey;
      const g =
        type === 'beach' && groupKey ? beachGroups.get(groupKey) : undefined;
      const [lon, lat] = (g?.center ??
        (feature.geometry as { coordinates: [number, number] })
          .coordinates) as [number, number];
      const rep = g?.rep ?? feature;
      if (type === 'beach' && g && g.members.length > 1) {
        fitBeachBounds(g.members, 900);
      } else {
        cameraRef.current?.flyTo({
          center: [lon, lat],
          // Playa: zoom 15.5 — el de la ficha abierta desde un emisario,
          // que enseña el entorno de la playa de cerca
          zoom: type === 'beach' ? 15.5 : 15,
          padding: type === 'outfall' ? CARD_PAD_OUTFALL : CARD_PAD,
          duration: 900,
        });
      }
      if (type === 'outfall') {
        // El feature del evento de tap puede no traer el id del
        // GeoJSON (y sus coords vienen cuantizadas por el tiling):
        // se resuelve el original más cercano para que
        // selectedOutfallId funcione y el pin seleccionado crezca
        const [fLon, fLat] = feature.geometry.coordinates;
        const orig =
          outfalls.features.reduce<GeoFeature | null>((best, o) => {
            const d =
              (o.geometry.coordinates[0] - fLon) ** 2 +
              (o.geometry.coordinates[1] - fLat) ** 2;
            const bd = best
              ? (best.geometry.coordinates[0] - fLon) ** 2 +
                (best.geometry.coordinates[1] - fLat) ** 2
              : Infinity;
            return d < bd ? o : best;
          }, null) ?? feature;
        onSelect({ type: 'outfall', feature: orig });
      } else {
        // El pin es el grupo: se abre la ficha del PM peor parado
        onSelect({
          type: 'beach',
          feature: rep,
          hasAlert: rep.properties.alert === true,
          members: pmMembersOf(g?.members),
        });
      }
    };

  return (
    <View style={styles.container}>
      <Map
        style={styles.map}
        mapStyle={satellite ? SATELLITE_STYLE : SEA_STYLE}
        attributionPosition={{ bottom: 8, right: 8 }}
        onPress={() => {
          // Solo el buscador cierra con tap al mapa: alertas y capas
          // son paneles — se cierran con su botón, un item o Atrás
          if (searchOpen) closeOverlays();
        }}
        onRegionDidChange={(e) => {
          const vs = e.nativeEvent as unknown as {
            center: [number, number];
            zoom: number;
            userInteraction?: boolean;
          };
          if (vs?.center && typeof vs.zoom === 'number') {
            lastView.current = { center: vs.center, zoom: vs.zoom };
          }
          // Paneo/zoom manual: al cerrar la card no se restaura la
          // vista anterior — el usuario ya eligió dónde mirar
          if (vs?.userInteraction) userPanned.current = true;
        }}
      >
        <Camera ref={cameraRef} initialViewState={TENERIFE_BOUNDS} />

        <Images
          images={{
            'pin-open': require('../assets/icons/pin-open.png'),
            'pin-warning': require('../assets/icons/pin-warning.png'),
            'pin-closed': require('../assets/icons/pin-closed.png'),
            'pin-unmonitored': require('../assets/icons/pin-unmonitored.png'),
            'pin-outfall-legal': require('../assets/icons/pin-outfall-legal.png'),
            'pin-outfall-illegal': require('../assets/icons/pin-outfall-illegal.png'),
            'pin-outfall-processing': require('../assets/icons/pin-outfall-processing.png'),
          }}
        />

        {outfallSel.size > 0 && (
          <GeoJSONSource
            id="outfalls"
            data={visibleOutfalls}
            onPress={handlePress('outfall')}
          >
            <Layer
              id="outfall-icons"
              type="symbol"
              filter={['!=', ['get', 'sel'], true]}
              layout={{
                'icon-image': [
                  'match',
                  ['get', 'status'],
                  'legal',
                  'pin-outfall-legal',
                  'illegal',
                  'pin-outfall-illegal',
                  'pin-outfall-processing',
                ],
                'icon-size': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  9,
                  0.16,
                  13,
                  0.28,
                  16,
                  0.32,
                ],
                'icon-anchor': 'bottom',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
              }}
            />
            {/* El vertido seleccionado se repinta en capa propia con
                tamaño fijo grande — data-driven icon-size con * se
                lo tragaba en silencio */}
            <Layer
              id="outfall-icon-selected"
              type="symbol"
              filter={['==', ['get', 'sel'], true]}
              layout={{
                'icon-image': [
                  'match',
                  ['get', 'status'],
                  'legal',
                  'pin-outfall-legal',
                  'illegal',
                  'pin-outfall-illegal',
                  'pin-outfall-processing',
                ],
                'icon-size': 0.45,
                'icon-anchor': 'bottom',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
              }}
            />
            {/* Nombre del vertido seleccionado bajo el pin — mismo
                estilo que las etiquetas de playa; solo una feature
                (sel) así que no compite por espacio */}
            <Layer
              id="outfall-label-selected"
              type="symbol"
              filter={['==', ['get', 'sel'], true]}
              layout={{
                'text-field': ['get', 'name'],
                'text-size': 13,
                'text-font': ['Noto Sans Bold'],
                'text-offset': [0, 1.0],
                'text-anchor': 'top',
                'text-allow-overlap': true,
                // false = SÍ registra su caja de colisión: se pinta
                // antes que las etiquetas de playa y solo se apagan
                // las que le solapan de verdad (el resto sigue)
                'text-ignore-placement': false,
              }}
              paint={{
                'text-color': colors.text,
                'text-halo-color': '#ffffff',
                'text-halo-width': 2.2,
              }}
            />
          </GeoJSONSource>
        )}

        {beachSel.size > 0 && hasAlerts && (
          <GeoJSONSource id="beach-alerts" data={alertPulse}>
            <Layer
              id="beach-pulse"
              type="circle"
              paint={{
                'circle-radius': 14 + pulse * 26,
                'circle-color': [
                  'match',
                  ['get', 'status'],
                  'closed',
                  BEACH_COLORS.closed,
                  BEACH_COLORS.warning,
                ],
                'circle-opacity': 0.6 * (1 - pulse),
              }}
            />
          </GeoJSONSource>
        )}

        {beachSel.size > 0 && (
          <GeoJSONSource
            id="beaches"
            data={visibleBeaches}
            onPress={handlePress('beach')}
          >
            <Layer
              id="beach-pins"
              type="symbol"
              filter={['!=', ['get', 'sel'], true]}
              layout={{
                'icon-image': [
                  'case',
                  [
                    'all',
                    ['==', ['get', 'monitored'], false],
                    ['!=', ['get', 'alert'], true],
                  ],
                  'pin-unmonitored',
                  [
                    'match',
                    ['get', 'status'],
                    'closed',
                    'pin-closed',
                    'warning',
                    'pin-warning',
                    'unknown',
                    'pin-unmonitored',
                    'pin-open',
                  ],
                ],
                'icon-size': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  9,
                  0.2,
                  13,
                  0.34,
                  16,
                  0.36,
                ],
                'icon-anchor': 'bottom',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
              }}
            />
            {/* Pin de la playa seleccionada: capa propia a tamaño
                fijo grande — mismo tratamiento que el vertido
                seleccionado. Con los dots PM visibles (grupo abierto)
                se vuelve invisible: el centroide les pisaba posición.
                Opacidad, no desmontaje: quitar el Layer con la source
                montada rompe el índice nativo de capas */}
            <Layer
              id="beach-pin-selected"
              type="symbol"
              filter={['==', ['get', 'sel'], true]}
              layout={{
                'icon-image': [
                  'case',
                  [
                    'all',
                    ['==', ['get', 'monitored'], false],
                    ['!=', ['get', 'alert'], true],
                  ],
                  'pin-unmonitored',
                  [
                    'match',
                    ['get', 'status'],
                    'closed',
                    'pin-closed',
                    'warning',
                    'pin-warning',
                    'unknown',
                    'pin-unmonitored',
                    'pin-open',
                  ],
                ],
                'icon-size': 0.45,
                'icon-anchor': 'bottom',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
              }}
              paint={{ 'icon-opacity': pmShown ? 0 : 1 }}
            />
            {/* Nombre de la playa bajo el pin: visible ya a zoom 12 —
                siempre por debajo del zoom al que vuela la card (15.5).
                symbol-sort-key da prioridad a la seleccionada: gana
                las colisiones y el motor descarta las vecinas que le
                pisen — así no se solapan al cambiar de playa */}
            <Layer
              id="beach-labels"
              type="symbol"
              minzoom={12}
              layout={{
                'text-field': ['get', 'label'],
                'text-size': ['case', ['==', ['get', 'sel'], true], 13, 11],
                'text-font': ['Noto Sans Bold'],
                'text-offset': [0, 1.0],
                'text-anchor': 'top',
                'text-allow-overlap': false,
                'text-ignore-placement': false,
                'symbol-sort-key': ['case', ['==', ['get', 'sel'], true], 0, 1],
              }}
              paint={{
                'text-color': colors.text,
                'text-halo-color': '#ffffff',
                'text-halo-width': [
                  'case',
                  ['==', ['get', 'sel'], true],
                  2.2,
                  1.8,
                ],
                // Con los dots PM pintados, el nombre del grupo en el
                // centroide choca con las etiquetas "PMn" y repite lo
                // que ya dice la cabecera de la card → se apaga
                'text-opacity': pmShown
                  ? ['case', ['==', ['get', 'sel'], true], 0, 1]
                  : 1,
              }}
            />
          </GeoJSONSource>
        )}

        {/* Dots de los puntos de muestreo de la playa abierta */}
        {pmPoints && pmPoints.features.length > 0 && (
          <GeoJSONSource id="pm-points" data={pmPoints}>
            <Layer
              id="pm-dots"
              type="circle"
              paint={{
                'circle-radius': 7,
                'circle-color': [
                  'case',
                  [
                    'all',
                    ['==', ['get', 'monitored'], false],
                    ['!=', ['get', 'alert'], true],
                  ],
                  BEACH_COLORS.unmonitored,
                  [
                    'match',
                    ['get', 'status'],
                    'closed',
                    BEACH_COLORS.closed,
                    'warning',
                    BEACH_COLORS.warning,
                    'unknown',
                    BEACH_COLORS.unknown,
                    BEACH_COLORS.open,
                  ],
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2.5,
              }}
            />
            <Layer
              id="pm-dot-labels"
              type="symbol"
              layout={{
                'text-field': ['get', 'pointLabel'],
                'text-size': 11,
                'text-font': ['Noto Sans Bold'],
                'text-offset': [0, 1.1],
                'text-anchor': 'top',
                'text-allow-overlap': true,
                'text-ignore-placement': true,
              }}
              paint={{
                'text-color': colors.text,
                'text-halo-color': '#ffffff',
                'text-halo-width': 2,
              }}
            />
          </GeoJSONSource>
        )}
      </Map>

      <View style={styles.topBlock} pointerEvents="box-none">
        <View style={styles.topbar}>
          <Image
            source={require('../assets/icon.png')}
            style={styles.topbarBrand}
          />
          {onOpenList && (
            <>
              <Pressable
                style={({ pressed }) => [
                  styles.topbarBtn,
                  pressed && styles.topbarBtnPressed,
                ]}
                onPress={() => {
                  closeOverlays();
                  onOpenList();
                }}
                accessibilityRole="button"
                accessibilityLabel="Abrir lista de playas"
              >
                <Image
                  source={require('../assets/icons/beach.png')}
                  style={styles.topbarIcon}
                />
                <Text style={styles.topbarLabel}>Playas</Text>
              </Pressable>
              <View style={styles.topbarDivider} />
            </>
          )}
          {onOpenOutfalls && (
            <>
              <Pressable
                style={({ pressed }) => [
                  styles.topbarBtn,
                  pressed && styles.topbarBtnPressed,
                ]}
                onPress={() => {
                  closeOverlays();
                  onOpenOutfalls();
                }}
                accessibilityRole="button"
                accessibilityLabel="Abrir lista de emisarios"
              >
                <Image
                  source={require('../assets/icons/icon-faucet.png')}
                  style={styles.topbarIcon}
                />
                <Text style={styles.topbarLabel}>Emisarios</Text>
              </Pressable>
              <View style={styles.topbarDivider} />
            </>
          )}
          {onOpenMunicipalities && (
            <>
              <Pressable
                style={({ pressed }) => [
                  styles.topbarBtn,
                  pressed && styles.topbarBtnPressed,
                ]}
                onPress={() => {
                  closeOverlays();
                  onOpenMunicipalities();
                }}
                accessibilityRole="button"
                accessibilityLabel="Abrir incidencias por municipio"
              >
                <Image
                  source={require('../assets/icons/icon-townhall.png')}
                  style={styles.topbarIcon}
                />
                <Text style={styles.topbarLabel}>Municipios</Text>
              </Pressable>
              <View style={styles.topbarDivider} />
            </>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.topbarBtn,
              pressed && styles.topbarBtnPressed,
            ]}
            onPress={() => {
              const next = !searchOpen;
              setSearchOpen(next);
              setQuery('');
              setAlertsOpen(false);
              if (next) onDismissSelection?.();
            }}
            accessibilityRole="button"
            accessibilityLabel="Buscar playa, emisario o municipio"
          >
            <Image
              source={require('../assets/icons/icon-search.png')}
              style={styles.topbarIcon}
            />
            <Text style={styles.topbarLabel}>Buscar</Text>
          </Pressable>
          <View style={styles.topbarDivider} />
          {onOpenHelp && (
            <Pressable
              style={({ pressed }) => [
                styles.topbarBtn,
                pressed && styles.topbarBtnPressed,
              ]}
              onPress={() => {
                closeOverlays();
                onDismissSelection?.();
                onOpenHelp?.();
              }}
              accessibilityRole="button"
              accessibilityLabel="Abrir guía de uso"
            >
              <Image
                source={require('../assets/icons/icon-book.png')}
                style={styles.topbarIcon}
              />
              <Text style={styles.topbarLabel}>Guía</Text>
            </Pressable>
          )}
        </View>
        <Pressable
          style={({ pressed }) => [
            styles.banner,
            {
              backgroundColor: closedCount
                ? colors.status.closed
                : warningCount
                  ? colors.status.warning
                  : colors.status.open,
            },
            pressed && styles.pressFx,
          ]}
          onPress={() => {
            // Con alertas: despliega la lista de playas en aviso.
            // Sin alertas: abre la lista general.
            closeSearch();
            setLayersOpen(false);
            if (hasAlerts) {
              const next = !alertsOpen;
              setAlertsOpen(next);
              // El desplegable se monta sobre la card: misma regla que
              // Buscar/Guía — abrirlo cierra la ficha
              if (next) onDismissSelection?.();
            } else {
              onOpenList?.();
            }
          }}
          accessibilityRole="button"
          accessibilityLabel="Resumen del estado de las playas"
          accessibilityState={{ expanded: alertsOpen }}
        >
          {(closedCount > 0 || warningCount > 0) && (
            <Image
              source={require('../assets/icons/icon-alert.png')}
              style={styles.bannerIcon}
            />
          )}
          <Text style={styles.bannerText}>
            {closedCount || warningCount
              ? [
                  closedCount
                    ? `${closedCount} ${closedCount === 1 ? 'cerrada' : 'cerradas'}`
                    : null,
                  warningCount
                    ? `${warningCount} ${warningCount === 1 ? 'aviso' : 'avisos'}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'Todas las playas sin incidencias'}
            {hasAlerts ? (alertsOpen ? ' ▴' : ' ▾') : ''}
          </Text>
        </Pressable>
        {alertsOpen && hasAlerts && (
          // Card acotada: sin maxHeight una ola de alertas desbordaba
          // hasta la barra nativa; la lista scrollea y el botón de
          // episodios queda fijo abajo (fuera del ScrollView)
          <View style={[styles.alertList, { maxHeight: winH * 0.62 }]}>
            <ScrollView
              style={styles.alertListScroll}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
            >
              <Text style={[styles.alertSection, styles.alertSectionActive]}>
                Activas ahora · {alertBeaches.features.length}
              </Text>
              {alertSections.map(([sectionLabel, features]) => {
                if (features.length === 0) return null;
                const foldable = sectionLabel === STRUCTURAL_SECTION;
                const preview = foldable
                  ? foldCount(features.map((f) => f.properties))
                  : features.length;
                const hidden = features.slice(preview);
                const shown =
                  structuralOpen || !foldable
                    ? features
                    : features.slice(0, preview);
                return (
                  <View key={sectionLabel}>
                    {alertSections.length > 1 && (
                      <Text style={styles.alertSubsection}>
                        {sectionLabel} · {features.length}
                      </Text>
                    )}
                    {shown.map((f) => {
                      const s =
                        f.properties.status === 'closed' ? 'closed' : 'warning';
                      return (
                        <Pressable
                          key={
                            (f.properties as { groupKey?: string }).groupKey ??
                            f.id
                          }
                          style={({ pressed }) => [
                            styles.alertRow,
                            pressed && styles.pressFx,
                          ]}
                          onPress={() => openAlertBeach(f)}
                          accessibilityRole="button"
                          accessibilityLabel={`${displayBeachName(
                            beachBaseName(f.properties.name),
                          )}, ${s === 'closed' ? 'cerrada' : 'aviso'}`}
                        >
                          <View
                            style={[
                              styles.alertDot,
                              { backgroundColor: colors.status[s] },
                            ]}
                          />
                          <View style={styles.alertText}>
                            <Text style={styles.alertName} numberOfLines={1}>
                              {displayBeachName(
                                beachBaseName(f.properties.name),
                              )}
                            </Text>
                            <Text style={styles.alertSub} numberOfLines={1}>
                              {f.properties.municipality ?? ''}
                            </Text>
                          </View>
                          <View style={styles.alertStateCol}>
                            <Text
                              style={[
                                styles.alertState,
                                { color: colors.status[s] },
                              ]}
                            >
                              {s === 'closed' ? 'Cerrada' : 'Aviso'}
                            </Text>
                            {f.properties.alert_cause ? (
                              <Text style={styles.alertCause} numberOfLines={1}>
                                {f.properties.alert_cause}
                              </Text>
                            ) : null}
                          </View>
                        </Pressable>
                      );
                    })}
                    {hidden.length > 0 && (
                      <Pressable
                        style={({ pressed }) => [
                          styles.alertRow,
                          pressed && styles.pressFx,
                        ]}
                        onPress={() => {
                          LayoutAnimation.configureNext(
                            LayoutAnimation.Presets.easeInEaseOut,
                          );
                          setStructuralOpen((o) => !o);
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: structuralOpen }}
                        accessibilityLabel={
                          structuralOpen
                            ? 'Ver menos cierres estructurales'
                            : `Ver ${hidden.length} cierres estructurales más`
                        }
                      >
                        {structuralOpen ? (
                          <View style={styles.alertDotsSpacer} />
                        ) : (
                          <View style={styles.alertDots}>
                            {[0, 1, 2].map((i) => (
                              <View
                                key={i}
                                style={[
                                  styles.alertDotSmall,
                                  i > 0 && styles.alertDotStacked,
                                  { zIndex: 3 - i },
                                ]}
                              />
                            ))}
                          </View>
                        )}
                        <View style={styles.alertText}>
                          <Text style={styles.alertFoldName}>
                            {structuralOpen
                              ? 'Ver menos'
                              : `${hidden.length} más`}
                          </Text>
                          {!structuralOpen && (
                            <Text style={styles.alertSub} numberOfLines={1}>
                              {foldSummary(
                                hidden.map((f) => f.properties.municipality),
                              )}
                            </Text>
                          )}
                        </View>
                        <Text style={styles.alertFoldChevron}>
                          {structuralOpen ? '▴' : '▾'}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
              {resueltas.length > 0 && (
                <Text
                  style={[styles.alertSection, styles.alertSectionResolved]}
                >
                  Reabiertas recientemente · {resueltas.length}
                </Text>
              )}
              {resueltas.map((ep) => (
                <Pressable
                  key={`res-${ep.id}-${ep.beach_id}`}
                  style={({ pressed }) => [
                    styles.alertRow,
                    pressed && styles.pressFx,
                  ]}
                  onPress={() => openEpisodeBeach(ep.beach_id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${displayBeachName(
                    ep.beach_name,
                  )}, reabierta`}
                >
                  <View
                    style={[
                      styles.alertDot,
                      { backgroundColor: colors.status.open },
                    ]}
                  />
                  <View style={styles.alertText}>
                    <Text style={styles.alertName} numberOfLines={1}>
                      {displayBeachName(ep.beach_name)}
                    </Text>
                    <Text style={styles.alertSub} numberOfLines={1}>
                      {ep.municipality ?? ''}
                    </Text>
                  </View>
                  <View style={styles.alertStateCol}>
                    <Text
                      style={[
                        styles.alertState,
                        { color: colors.status.open },
                      ]}
                    >
                      Reabierta
                    </Text>
                    <Text style={styles.alertCause} numberOfLines={1}>
                      {ep.closed_at ? fmtDate(ep.closed_at) : ''} ·{' '}
                      {formatDays(episodeDays(ep))} cerrada
                    </Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
            {onOpenTemporada && (
              <Pressable
                style={({ pressed }) => [
                  styles.alertMore,
                  pressed && styles.pressFx,
                ]}
                onPress={() => {
                  setAlertsOpen(false);
                  onOpenTemporada();
                }}
                accessibilityRole="button"
                accessibilityLabel="Ver todos los episodios del verano"
              >
                <Text style={styles.alertMoreText}>
                  Todos los episodios del verano ›
                </Text>
              </Pressable>
            )}
          </View>
        )}
        {searchOpen && (
          <View style={styles.searchWrap}>
            <View style={styles.searchBar}>
              <Image
                source={require('../assets/icons/icon-search.png')}
                style={styles.searchIcon}
              />
              <TextInput
                ref={searchInputRef}
                style={styles.searchInput}
                placeholder="Buscar playa, emisario o municipio..."
                placeholderTextColor={colors.textFaint}
                value={query}
                onChangeText={setQuery}
                autoFocus
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel="Buscar playa, emisario o municipio"
              />
            </View>
            {searchResults.length > 0 && (
              <View style={styles.searchResults}>
                {searchResults.map((item) => (
                  <Pressable
                    key={item.key}
                    style={({ pressed }) => [
                      styles.searchRow,
                      pressed && styles.pressFx,
                    ]}
                    onPress={() => pickResult(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.label}, ${item.sub}`}
                    accessibilityHint="Centrar en el mapa"
                  >
                    <Text style={styles.searchLabel} numberOfLines={1}>
                      {item.label}
                    </Text>
                    <Text style={styles.searchSub} numberOfLines={1}>
                      {item.sub}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
      </View>

      {/* Basemap mapa/satélite: cuadradito flotante arriba-derecha,
          debajo de la topbar — gesto de "capas" tipo Google Maps,
          icono fijo (el propio mapa ya muestra el estado) */}
      <Pressable
        style={({ pressed }) => [
          styles.satBtn,
          (alertsOpen || layersOpen) && styles.ctrlBtnDisabled,
          pressed && styles.pressFx,
        ]}
        disabled={alertsOpen || layersOpen}
        onPress={() => setSatellite((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={
          satellite ? 'Volver a vista de mapa' : 'Cambiar a vista satélite'
        }
        accessibilityState={{ checked: satellite }}
      >
        <Image
          source={require('../assets/icons/icon-satellite.png')}
          style={styles.satIcon}
        />
      </Pressable>

      {/* Brujula: reorienta el mapa al norte (como en Google Maps) */}
      <Pressable
        style={({ pressed }) => [
          styles.compassBtn,
          (alertsOpen || layersOpen) && styles.ctrlBtnDisabled,
          pressed && styles.pressFx,
        ]}
        disabled={alertsOpen || layersOpen}
        onPress={() =>
          cameraRef.current?.easeTo({
            center: lastView.current.center,
            bearing: 0,
            duration: 400,
          })
        }
        accessibilityRole="button"
        accessibilityLabel="Orientar el mapa al norte"
      >
        <Image
          source={require('../assets/icons/icon-compass.png')}
          style={styles.satIcon}
        />
      </Pressable>

      {/* Capas: abre el panel de checkboxes por estado */}
      <Pressable
        style={({ pressed }) => [styles.layersBtn, pressed && styles.pressFx]}
        onPress={() => {
          const next = !layersOpen;
          closeSearch();
          setAlertsOpen(false);
          if (next) onDismissSelection?.();
          setLayersOpen(next);
        }}
        accessibilityRole="button"
        accessibilityLabel="Abrir panel de capas"
        accessibilityState={{ expanded: layersOpen }}
      >
        <Image
          source={require('../assets/icons/icon-layers.png')}
          style={styles.satIcon}
        />
      </Pressable>

      {layersOpen && (
        <View style={styles.layersPanel}>
          {layerSection(
            'Emisarios',
            'Todos',
            OUTFALL_STATES,
            outfallSel,
            setOutfallSel,
          )}
          <View style={styles.layerDivider} />
          {layerSection('Playas', 'Todas', BEACH_STATES, beachSel, setBeachSel)}
        </View>
      )}

      <View style={styles.legend} pointerEvents="box-none">
        {/* Leyenda siempre visible: dos filas (Emisarios / Playas)
            pegadas abajo — sin botón Capas */}
        <View style={styles.legendCard}>
          <View style={styles.layerRow}>
            <Image
              source={require('../assets/icons/icon-faucet.png')}
              style={styles.legendIcon}
            />
            <View style={styles.legendSub}>
              {OUTFALL_STATES.map(([color, label, key]) => (
                <View
                  key={label}
                  style={[
                    styles.swatchRow,
                    !outfallSel.has(key) && styles.swatchDimmed,
                  ]}
                >
                  <View style={[styles.dot, { backgroundColor: color }]} />
                  <Text style={styles.swatchText}>{label}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={[styles.layerRow, { marginTop: 13 }]}>
            <Image
              source={require('../assets/icons/beach.png')}
              style={styles.legendIcon}
            />
            <View style={styles.legendSub}>
              {BEACH_STATES.map(([color, label, key]) => (
                <View
                  key={label}
                  style={[
                    styles.swatchRow,
                    !beachSel.has(key) && styles.swatchDimmed,
                  ]}
                >
                  <View style={[styles.dot, { backgroundColor: color }]} />
                  <Text style={styles.swatchText}>{label}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      </View>

      {/* Sin backdrop: con alertas/capas abiertos el mapa sigue vivo
          (scroll, pines). Satélite y brújula se deshabilitan vía prop
          mientras haya un panel abierto; los paneles se cierran con su
          botón, un item o Atrás */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  // Bloque superior: barra de botones + pill de avisos apilados
  topBlock: {
    position: 'absolute',
    top: (Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 24) + 8,
    left: 12,
    right: 12,
    alignItems: 'center',
    gap: 8,
    // Por encima del backdrop de overlays (30): la topbar, el
    // desplegable de alertas y el buscador siguen pulsables
    zIndex: 40,
    elevation: 40,
  },
  // Altura fija: el icono absoluto la necesita como referencia
  // estable. top+bottom sin altura fija en un hijo absoluto dentro de
  // un contenedor de alto automático es ambiguo para Yoga y puede
  // disparar el tamaño sin control — de ahí el bug anterior.
  topbar: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    height: 48,
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 14,
    paddingLeft: 52,
    paddingRight: 6,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  topbarBrand: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 48,
    height: 48,
    opacity: 0.72,
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
  },
  topbarBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 0,
    paddingVertical: 5,
    borderRadius: 8,
  },
  topbarBtnPressed: {
    backgroundColor: 'rgba(7,82,118,0.10)',
  },
  // Feedback táctil común: leve fundido al presionar
  pressFx: {
    opacity: 0.6,
  },
  topbarIcon: {
    width: 22,
    height: 22,
  },
  topbarLabel: {
    fontSize: 10,
    lineHeight: 12,
    fontFamily: fonts.semibold,
    color: colors.text,
    marginTop: 1,
  },
  topbarDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.75)',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  bannerIcon: {
    width: 15,
    height: 15,
    marginRight: 7,
  },
  bannerText: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 17,
    fontFamily: fonts.bold,
  },
  alertList: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 12,
    paddingVertical: 4,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  alertListScroll: {
    // Cede altura al botón fijo de abajo cuando la lista crece
    flexShrink: 1,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 10,
  },
  alertDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  alertText: {
    flex: 1,
  },
  // Fila "N más": misma rejilla que una playa, con 3 puntos apilados
  // en el hueco del punto de estado
  alertDots: {
    width: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertDotsSpacer: {
    width: 10,
  },
  alertDotSmall: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.status.closed,
    borderWidth: 1,
    borderColor: '#fff',
  },
  alertDotStacked: {
    marginLeft: -5,
    opacity: 0.7,
  },
  alertFoldName: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  alertFoldChevron: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  alertName: {
    fontSize: 14,
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  alertSub: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 1,
  },
  alertStateCol: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  alertState: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fonts.bold,
  },
  // Causa bajo "Cerrada": "Contaminación", "Desprendimientos"...
  alertCause: {
    fontSize: 10,
    lineHeight: 13,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
    marginTop: 1,
  },
  // Separador de sección: banda rellena a todo lo ancho — se distingue
  // a primera vista de los hairlines de cada fila
  alertSection: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fonts.extrabold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  // Subsección dentro de "Activas ahora" (contaminación vs cierre
  // estructural): más discreta que la banda de sección
  alertSubsection: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fonts.extrabold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 4,
  },
  // Activa = peligro suave; resuelta = alivio
  alertSectionActive: {
    backgroundColor: 'rgba(198,40,40,0.10)',
    color: colors.status.closed,
  },
  alertSectionResolved: {
    backgroundColor: 'rgba(13,148,136,0.10)',
    color: colors.status.open,
  },
  alertMore: {
    marginHorizontal: 12,
    marginVertical: 10,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.status.closed,
    alignItems: 'center',
    elevation: 2,
  },
  alertMoreText: {
    fontSize: 15,
    fontFamily: fonts.extrabold,
    color: '#fff',
  },
  searchWrap: {
    alignSelf: 'stretch',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 12,
    paddingHorizontal: 14,
    elevation: 4,
  },
  searchIcon: {
    width: 16,
    height: 16,
    tintColor: colors.textFaint,
  },
  searchInput: {
    flex: 1,
    paddingLeft: 8,
    paddingVertical: 9,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  searchResults: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 12,
    marginTop: 6,
    paddingVertical: 4,
    elevation: 6,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 10,
  },
  searchLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  searchSub: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  // Wrapper posicional a todo lo ancho: centra la tarjeta de capas
  legend: {
    position: 'absolute',
    // 46 despeja la barra de gestos y casi la de 3 botones (~48dp);
    // número fijo porque no usamos safe-area-context
    bottom: Platform.OS === 'android' ? 46 : 10,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  // Basemap flotante: solo icono, arriba-derecha bajo la topbar
  satBtn: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 112 : 96,
    right: 18, // algo separado del borde: el gesto de scroll de Android se lo come
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    zIndex: 5,
  },
  satIcon: {
    width: 20,
    height: 20,
  },
  compassBtn: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 152 : 136, // bajo el boton de capas
    right: 18,
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    zIndex: 5,
  },
  legendCard: {
    width: '97%', // ancho fijo: tapa las etiquetas de mar a los lados
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 10,
    elevation: 4,
    // Desplazada a la izquierda: tapa el logo de MapLibre (fijo
    // abajo-izquierda, independiente de attributionPosition)
    transform: [{ translateX: -0.5 }],
  },
  // Icono + swatches como un solo bloque centrado en la card (sin
  // flex:1 en legendSub, si no el icono queda pinchado a la izquierda)
  layerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    justifyContent: 'center',
  },
  legendIcon: {
    width: 18,
    height: 18,
    marginLeft: -4,
    marginRight: 14,
  },
  // Swatches informativos en línea (no interactivos — las capas se
  // controlan desde el panel del botón flotante). wrap + flexShrink
  // obligatorios: sin ellos la fila se centra como bloque mayor que
  // el hueco y recorta el primer y último swatch por igual
  // (pantallas estrechas / fuente grande de accesibilidad)
  legendSub: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    flexShrink: 1,
    justifyContent: 'center',
    gap: 14,
    rowGap: 4,
  },
  swatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // La leyenda refleja el filtro: estado desmarcado en el panel =
  // swatch atenuado ("esto es lo que estás viendo ahora")
  swatchDimmed: {
    opacity: 0.35,
  },
  swatchText: {
    fontSize: 12,
    lineHeight: 19,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  // Botón flotante de capas: bajo la brújula, misma cápsula que los
  // demás botones de mapa
  layersBtn: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 192 : 176,
    right: 18,
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    zIndex: 5,
  },
  // Botones flotantes atenuados mientras hay un panel abierto
  // (alertas/capas) — se ven muertos, no se pueden pulsar
  ctrlBtnDisabled: {
    opacity: 0.4,
  },
  // Panel de capas: tarjeta desplegable bajo el botón, alineada a la
  // derecha; tap al mapa la cierra
  layersPanel: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 232 : 216,
    right: 18,
    width: 210,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    // Por encima del backdrop de overlays (30) para seguir interactivo
    zIndex: 40,
    elevation: 40,
  },
  layerSection: {
    paddingHorizontal: 6,
  },

  layerDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 7,
    marginHorizontal: 2,
  },
  layerHead: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fonts.extrabold,
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 4,
    marginBottom: 2,
  },
  layerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  layerItemPressed: {
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  layerItemText: {
    fontSize: 13,
    lineHeight: 17,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  layerItemTextAll: {
    fontFamily: fonts.semibold,
  },
  layerItemTextOff: {
    color: colors.textFaint,
  },
  check: {
    width: 15,
    height: 15,
    borderRadius: 4,
    borderWidth: 2,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: {
    color: '#fff',
    fontSize: 10,
    lineHeight: 11,
    fontFamily: fonts.extrabold,
    includeFontPadding: false,
    textAlign: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#fff',
  },
});

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Keyboard,
  NativeSyntheticEvent,
  Platform,
  Pressable,
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
} from '../lib/format';
import {
  activeEpisodes,
  closuresThisYear,
  episodeDays,
  recentlyResolved,
} from '../lib/episodes';
import { groupKeyOf } from '../lib/beachGroups';
import { colors, fonts } from '../lib/theme';
import seaStyle from '../assets/mapstyle-sea.json';

// Estilo vectorial tematico (OpenFreeMap/OpenMapTiles retenido con la
// paleta oceanica por scripts_gen_mapstyle.py). Sin API key.
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
  // [lon, lat, zoom?] a donde volar la cámara; con zoom explícito se
  // centra exacto (no hay card abierta que tape el punto)
  focus?: [number, number, number?] | null;
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
  // Panel de capas por estado (botón flotante junto a la brújula)
  const [layersOpen, setLayersOpen] = useState(false);
  const [query, setQuery] = useState('');
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
  const cameraRef = useRef<CameraRef>(null);
  const { height: winH } = useWindowDimensions();
  // Con la card abierta la zona libre va de la topbar (~110px) al borde
  // de la card (~62% de alto): el padding de cámara centra el pin en
  // esa franja en PANTALLA — robusto a rotación y tamaño, a diferencia
  // del antiguo offset en grados de latitud
  const CARD_PAD = {
    top: 110,
    bottom: Math.round(winH * 0.62),
  };
  // La card de vertido flota alta (~30%): su pin baja más hacia el
  // centro para no quedar despegado de la ficha
  const CARD_PAD_OUTFALL = {
    top: 110,
    bottom: Math.round(winH * 0.5),
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
  const prevSelection = useRef(selectionActive);

  const saveView = () => {
    // Solo guarda si venimos de mapa libre: al cambiar de playa con la
    // card ya abierta no machaca la posicion original
    if (!selectionActive) savedView.current = { ...lastView.current };
  };

  // Card cerrada -> vuelve a la vista previa al toque del pin
  useEffect(() => {
    if (prevSelection.current && !selectionActive && savedView.current) {
      cameraRef.current?.flyTo({
        center: savedView.current.center,
        zoom: savedView.current.zoom,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        duration: 800,
      });
      savedView.current = null;
    }
    prevSelection.current = selectionActive;
  }, [selectionActive]);

  // Vuela a una playa en aviso y abre su ficha (lista del banner)
  const openAlertBeach = (f: GeoFeature) => {
    closeSearch();
    saveView();
    // El pin se dibuja en el centroide del grupo, no en las coords del
    // PM: la cámara apunta al mismo punto o queda descolocado
    const gk = (f.properties as { groupKey?: string }).groupKey;
    const g = gk ? beachGroups.get(gk) : undefined;
    const [lon, lat] = (g?.center ??
      (f.geometry as { coordinates: [number, number] })
        .coordinates) as [number, number];
    cameraRef.current?.flyTo({
      center: [lon, lat],
      zoom: 13,
      padding: CARD_PAD,
      duration: 1200,
    });
    onSelect({
      type: 'beach',
      feature: f,
      hasAlert: true,
      members: pmMembersOf(
        gk ? beachGroups.get(gk)?.members : undefined,
      ),
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
      const g = groups.get(key) ?? { members: [], rep: f, center: [0, 0] as [number, number] };
      g.members.push(f);
      groups.set(key, g);
    }
    const rank = (f: GeoFeature) => {
      const s =
        f.properties.monitored === false && f.properties.alert !== true
          ? 'unmonitored'
          : (f.properties.status ?? 'unknown');
      return (
        { closed: 0, warning: 1, unknown: 2, open: 3, unmonitored: 4 }[s] ??
        5
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
          f.properties.status === 'closed' ||
          f.properties.status === 'warning',
      ),
    }),
    [groupedBeaches],
  );

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

  // Episodios insulares: cabecera del banner ("N cierres en 2026") +
  // sección verde "Resueltas recientemente" (puente del push de
  // reapertura — el usuario la recibe y la confirmación vive aquí)
  const yearLine = useMemo(() => {
    const year = new Date().getFullYear();
    const n = closuresThisYear(episodes, year).length;
    const active = activeEpisodes(episodes).length;
    return n > 0
      ? `${year} · ${n} ${n === 1 ? 'cierre' : 'cierres'}${
          active ? ` · ${active} ${active === 1 ? 'activo' : 'activos'} ahora` : ''
        }`
      : null;
  }, [episodes]);
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
          f.properties.status === 'closed' ||
          f.properties.status === 'warning',
      ),
    }),
    [visibleBeaches],
  );

  // Halo que crece y se desvance ~1 ciclo/seg solo si hay alertas
  useEffect(() => {
    if (!hasAlerts) return;
    const t = setInterval(() => setPulse((p) => (p + 0.1) % 1), 110);
    return () => clearInterval(t);
  }, [hasAlerts]);

  // Vuela a la playa elegida en la lista
  useEffect(() => {
    if (focus) {
      saveView();
      const exact = focus[2] != null;
      // Si el foco casa con un PM de un grupo, el pin está en el
      // centroide: volar ahí, no a las coords del PM
      let cx = focus[0];
      let cy = focus[1];
      for (const g of beachGroups.values()) {
        if (
          g.members.some(
            (m) =>
              Math.abs(m.geometry.coordinates[0] - focus[0]) < 1e-6 &&
              Math.abs(m.geometry.coordinates[1] - focus[1]) < 1e-6,
          )
        ) {
          [cx, cy] = g.center;
          break;
        }
      }
      cameraRef.current?.flyTo({
        center: [cx, cy],
        zoom: focus[2] ?? 13,
        // Sin zoom explícito hay card abierta (o a punto) → padding
        padding: exact ? undefined : CARD_PAD,
        duration: 1500,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // Resultados del buscador: playas, vertidos y municipios que
  // contienen la query (mínimo 2 caracteres)
  const searchResults = useMemo<SearchItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const items: SearchItem[] = [];
    // Playas agrupadas como en el mapa: "troya" da UN resultado
    // (casa también por el nombre de cualquiera de sus PMs)
    for (const [key, g] of beachGroups) {
      const label = displayBeachName(
        beachBaseName(g.rep.properties.name),
      );
      const hay = [label, ...g.members.map((m) => m.properties.name)]
        .join(' ')
        .toLowerCase();
      if (hay.includes(q)) {
        items.push({
          key: `b${key}`,
          kind: 'beach',
          label,
          sub:
            (g.rep.properties.municipality ?? 'Playa') +
            (g.members.length > 1 ? ` · ${g.members.length} PMs` : ''),
          feature: g.rep,
          members: g.members,
          center: g.center,
        });
      }
    }
    for (const f of outfalls.features) {
      if ((f.properties.name ?? '').toLowerCase().includes(q)) {
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
      if (m.toLowerCase().includes(q)) {
        const pts = beaches.features.filter(
          (f) => f.properties.municipality === m,
        );
        items.push({
          key: `m${m}`,
          kind: 'municipality',
          label: m,
          sub: 'Municipio',
          center: [
            pts.reduce((s, f) => s + f.geometry.coordinates[0], 0) /
              pts.length,
            pts.reduce((s, f) => s + f.geometry.coordinates[1], 0) /
              pts.length,
          ],
        });
      }
    }
    return items.slice(0, 8);
  }, [query, beachGroups, outfalls]);

  const pickResult = (item: SearchItem) => {
    setQuery('');
    setSearchOpen(false);
    Keyboard.dismiss();
    saveView();
    if (item.feature) {
      // Playa agrupada: vuela al centroide; ficha del PM representante
      const [lon, lat] = item.center ?? item.feature.geometry.coordinates;
      cameraRef.current?.flyTo({
        center: [lon, lat],
        zoom: item.kind === 'beach' ? 15 : 13.5,
        padding: item.kind === 'outfall' ? CARD_PAD_OUTFALL : CARD_PAD,
        duration: 1200,
      });
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
    Keyboard.dismiss();
  };
  // Lo mismo para el desplegable de avisos del banner y el panel de
  // capas — tocar el mapa u otro botón cierra lo que esté abierto
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
      {!isAll && (
        <View style={[styles.dot, { backgroundColor: color }]} />
      )}
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
          () =>
            setSel(
              allOn ? new Set() : new Set(states.map(([, , k]) => k)),
            ),
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
      const candidates = (e.nativeEvent.features ?? []) as unknown as
        GeoFeature[];
      if (!candidates.length) return;
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
      const groupKey = (feature.properties as { groupKey?: string })
        .groupKey;
      const g =
        type === 'beach' && groupKey
          ? beachGroups.get(groupKey)
          : undefined;
      const [lon, lat] = (g?.center ??
        (feature.geometry as { coordinates: [number, number] })
          .coordinates) as [number, number];
      const rep = g?.rep ?? feature;
      cameraRef.current?.flyTo({
        center: [lon, lat],
        // Emisario: zoom alto — el nombre del seleccionado necesita
        // aire respecto a las etiquetas de playas cercanas
        zoom: type === 'beach' ? 13 : 15,
        padding: type === 'outfall' ? CARD_PAD_OUTFALL : CARD_PAD,
        duration: 900,
      });
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
          if (searchOpen || alertsOpen || layersOpen) closeOverlays();
        }}
        onRegionDidChange={(e) => {
          const vs = e.nativeEvent as unknown as {
            center: [number, number];
            zoom: number;
          };
          if (vs?.center && typeof vs.zoom === 'number') {
            lastView.current = { center: vs.center, zoom: vs.zoom };
          }
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
                'text-ignore-placement': true,
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
          <GeoJSONSource id="beach-alerts" data={visibleAlertBeaches}>
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
                seleccionado */}
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
            />
            {/* Nombre de la playa bajo el pin: visible ya a zoom 12 —
                coincide con el zoom al que vuela la card (13).
                symbol-sort-key da prioridad a la seleccionada: gana
                las colisiones y el motor descarta las vecinas que le
                pisen — así no se solapan al cambiar de playa */}
            <Layer
              id="beach-labels"
              type="symbol"
              minzoom={12}
              layout={{
                'text-field': ['get', 'label'],
                'text-size': [
                  'case',
                  ['==', ['get', 'sel'], true],
                  13,
                  11,
                ],
                'text-font': ['Noto Sans Bold'],
                'text-offset': [0, 1.0],
                'text-anchor': 'top',
                'text-allow-overlap': false,
                'text-ignore-placement': false,
                'symbol-sort-key': [
                  'case',
                  ['==', ['get', 'sel'], true],
                  0,
                  1,
                ],
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
          {onOpenList && (
            <Pressable
              style={styles.topbarBtn}
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
          )}
          {onOpenOutfalls && (
            <Pressable
              style={styles.topbarBtn}
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
          )}
          {onOpenMunicipalities && (
            <Pressable
              style={styles.topbarBtn}
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
          )}
          <Pressable
            style={styles.topbarBtn}
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
              style={styles.topbarBtn}
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
          style={[
            styles.banner,
            {
              backgroundColor: closedCount
                ? colors.status.closed
                : warningCount
                  ? colors.status.warning
                  : colors.status.open,
            },
          ]}
          onPress={() => {
            // Con alertas: despliega la lista de playas en aviso.
            // Sin alertas: abre la lista general.
            closeSearch();
            if (hasAlerts) setAlertsOpen((v) => !v);
            else onOpenList?.();
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
          <View style={styles.alertList}>
            {yearLine && (
              <Text style={styles.alertYearLine}>{yearLine}</Text>
            )}
            {[...alertBeaches.features]
              .sort((a) => (a.properties.status === 'closed' ? -1 : 1))
              .map((f) => {
                const s =
                  f.properties.status === 'closed' ? 'closed' : 'warning';
                return (
                  <Pressable
                    key={
                      (f.properties as { groupKey?: string }).groupKey ??
                      f.id
                    }
                    style={styles.alertRow}
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
            {resueltas.length > 0 && (
              <Text style={styles.alertSection}>
                Resueltas recientemente
              </Text>
            )}
            {resueltas.map((ep) => (
              <Pressable
                key={`res-${ep.id}-${ep.beach_id}`}
                style={styles.alertRow}
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
                    {episodeDays(ep)}{' '}
                    {episodeDays(ep) === 1 ? 'día' : 'días'} cerrada
                  </Text>
                </View>
              </Pressable>
            ))}
            {onOpenTemporada && (
              <Pressable
                style={styles.alertMore}
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
                    style={styles.searchRow}
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
        style={styles.satBtn}
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
        style={styles.compassBtn}
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
        style={styles.layersBtn}
        onPress={() => {
          const next = !layersOpen;
          closeSearch();
          setAlertsOpen(false);
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
          {layerSection(
            'Playas',
            'Todas',
            BEACH_STATES,
            beachSel,
            setBeachSel,
          )}
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
                  <View
                    style={[styles.dot, { backgroundColor: color }]}
                  />
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
                  <View
                    style={[styles.dot, { backgroundColor: color }]}
                  />
                  <Text style={styles.swatchText}>{label}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      </View>

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
    top: (Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 24) + 8,
    left: 12,
    right: 12,
    alignItems: 'center',
    gap: 8,
  },
  topbar: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 6,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  topbarBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.border,
  },
  topbarIcon: {
    width: 22,
    height: 22,
  },
  topbarLabel: {
    fontSize: 9,
    lineHeight: 12,
    fontFamily: fonts.semibold,
    color: colors.text,
    marginTop: 2,
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
  // "2026 · 7 cierres · 2 activos ahora" — contexto anual arriba de
  // la lista de alertas del banner
  alertYearLine: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 2,
  },
  alertSection: {
    fontSize: 10,
    fontFamily: fonts.extrabold,
    color: colors.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 2,
  },
  alertMore: {
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  alertMoreText: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.primary,
    textAlign: 'center',
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
    bottom: Platform.OS === 'android' ? 40 : 10,
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
    paddingHorizontal: 14,
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
    marginRight: 20,
  },
  // Swatches informativos en línea (no interactivos — las capas se
  // controlan desde el panel del botón flotante)
  legendSub: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 16,
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
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    zIndex: 6,
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

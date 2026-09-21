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

import type { FeatureCollection, GeoFeature } from '../lib/api';
import {
  beachBaseName,
  beachPointLabel,
  displayBeachName,
} from '../lib/format';
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
}: CoastMapProps) {
  const [satellite, setSatellite] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Lista desplegable de playas en aviso (banner de alertas)
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [showOutfalls, setShowOutfalls] = useState(true);
  const [showBeaches, setShowBeaches] = useState(true);
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
  // Lo mismo para el desplegable de avisos del banner
  const closeOverlays = () => {
    closeSearch();
    setAlertsOpen(false);
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
        zoom: type === 'beach' ? 13 : 13.5,
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
          if (searchOpen || alertsOpen) closeOverlays();
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

        {showOutfalls && (
          <GeoJSONSource
            id="outfalls"
            data={outfallsMarked}
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
          </GeoJSONSource>
        )}

        {showBeaches && hasAlerts && (
          <GeoJSONSource id="beach-alerts" data={alertBeaches}>
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

        {showBeaches && (
          <GeoJSONSource
            id="beaches"
            data={groupedBeaches}
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
                    <Text
                      style={[
                        styles.alertState,
                        { color: colors.status[s] },
                      ]}
                    >
                      {s === 'closed' ? 'Cerrada' : 'Aviso'}
                    </Text>
                  </Pressable>
                );
              })}
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
          source={require('../assets/icons/icon-layers.png')}
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

      <View style={styles.legend} pointerEvents="box-none">
        {/* Leyenda siempre visible: dos filas (Emisarios / Playas)
            pegadas abajo — sin botón Capas */}
        <View style={styles.legendCard}>
          <View style={styles.layerRow}>
            <Pressable
              style={[
                styles.legendRow,
                !showOutfalls && styles.legendOff,
              ]}
              onPress={() => setShowOutfalls((v) => !v)}
              accessibilityRole="switch"
              accessibilityLabel="Capa de emisarios"
              accessibilityState={{ checked: showOutfalls }}
            >
              <Image
                source={require('../assets/icons/icon-faucet.png')}
                style={styles.legendIcon}
              />
              <View
                style={[
                  styles.legendSwitch,
                  showOutfalls ? styles.switchOn : styles.switchOff,
                ]}
              >
                <Text style={styles.switchText}>
                  {showOutfalls ? 'ON' : 'OFF'}
                </Text>
              </View>
            </Pressable>
            <View style={styles.legendSub}>
              {[
                [OUTFALL_COLORS.legal, 'Autorizado'],
                [OUTFALL_COLORS.illegal, 'No autorizado'],
                [OUTFALL_COLORS.unknown, 'En trámite'],
              ].map(([color, label]) => (
                <View key={label} style={styles.swatchRow}>
                  <View
                    style={[styles.dot, { backgroundColor: color }]}
                  />
                  <Text style={styles.swatchText}>{label}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={[styles.layerRow, { marginTop: 6 }]}>
            <Pressable
              style={[
                styles.legendRow,
                !showBeaches && styles.legendOff,
              ]}
              onPress={() => setShowBeaches((v) => !v)}
              accessibilityRole="switch"
              accessibilityLabel="Capa de playas"
              accessibilityState={{ checked: showBeaches }}
            >
              <Image
                source={require('../assets/icons/beach.png')}
                style={styles.legendIcon}
              />
              <View
                style={[
                  styles.legendSwitch,
                  showBeaches ? styles.switchOn : styles.switchOff,
                ]}
              >
                <Text style={styles.switchText}>
                  {showBeaches ? 'ON' : 'OFF'}
                </Text>
              </View>
            </Pressable>
            <View style={styles.legendSub}>
              {[
                [BEACH_COLORS.open, 'Apta'],
                [BEACH_COLORS.warning, 'Aviso'],
                [BEACH_COLORS.closed, 'Cerrada'],
                [BEACH_COLORS.unmonitored, 'Sin monitorizar'],
              ].map(([color, label]) => (
                <View key={label} style={styles.swatchRow}>
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
  alertState: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fonts.bold,
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
    bottom: Platform.OS === 'android' ? 48 : 18,
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
    width: '96%', // ancho fijo: tapa las etiquetas de mar a los lados
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    elevation: 4,
  },
  layerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 76, // icono + switch, sin etiqueta
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 5,
    paddingHorizontal: 7,
    elevation: 1,
  },
  legendSwitch: {
    marginLeft: 'auto',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  switchOn: {
    backgroundColor: colors.primary,
  },
  switchOff: {
    backgroundColor: colors.off,
  },
  switchText: {
    color: '#fff',
    fontSize: 10,
    lineHeight: 14,
    fontFamily: fonts.extrabold,
    minWidth: 26, // sin esto Android recorta "ON" a "O"
    textAlign: 'center',
  },
  legendOff: {
    opacity: 0.35,
  },
  legendTitle: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  legendIcon: {
    width: 16,
    height: 16,
    marginRight: 6,
  },
  // Swatches en línea a la derecha del switch; envuelven si no caben
  legendSub: {
    flex: 1, // ocupa el resto de la tarjeta: el contenido respira
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-evenly',
    marginLeft: 10,
    gap: 8,
  },
  swatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#fff',
  },
  swatchText: {
    fontSize: 11,
    lineHeight: 16, // sin esto Android recorta ascendentes/descendentes
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
});

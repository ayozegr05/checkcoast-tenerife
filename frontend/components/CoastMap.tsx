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
import { beachBaseName, displayBeachName } from '../lib/format';
import { colors, fonts } from '../lib/theme';
import seaStyle from '../assets/mapstyle-sea.json';

// Estilo vectorial tematico (OpenFreeMap/OpenMapTiles retenido con la
// paleta oceanica por scripts_gen_mapstyle.py). Sin API key.
const SEA_STYLE = seaStyle as unknown as StyleSpecification;

// Estilo raster satélite con Esri World Imagery + capa de etiquetas
// transparente (vista híbrida). Gratuito, sin API key.
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    esri: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Esri, Maxar, Earthstar Geographics',
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
    { id: 'esri', type: 'raster', source: 'esri' },
    { id: 'esri-labels', type: 'raster', source: 'esri-labels' },
  ],
};

// Vista inicial centrada en Tenerife
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
  focus?: [number, number] | null; // [lon, lat] a donde volar la cámara
  selectionActive: boolean; // hay card abierta -> al cerrar restaura vista
  // Puntos de muestreo de la playa seleccionada (capa temporal de
  // dots coloreados por estado mientras la card está abierta)
  pmPoints?: FeatureCollection;
  onSelect: (selection: Selection) => void;
  onOpenList?: () => void;
  onOpenMunicipalities?: () => void;
  onOpenOutfalls?: () => void;
  onOpenHelp?: () => void;
};

const OUTFALL_COLORS = colors.outfall;
const BEACH_COLORS = colors.status;

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
  pmPoints,
  onSelect,
  onOpenList,
  onOpenMunicipalities,
  onOpenOutfalls,
  onOpenHelp,
}: CoastMapProps) {
  const [satellite, setSatellite] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [showOutfalls, setShowOutfalls] = useState(true);
  const [showBeaches, setShowBeaches] = useState(true);
  const [pulse, setPulse] = useState(0);
  const cameraRef = useRef<CameraRef>(null);
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
        duration: 800,
      });
      savedView.current = null;
    }
    prevSelection.current = selectionActive;
  }, [selectionActive]);

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
      const key = `${f.properties.municipality ?? ''}|${beachBaseName(
        f.properties.name,
      ).toUpperCase()}`;
      const g = groups.get(key) ?? { members: [], rep: f, center: [0, 0] as [number, number] };
      g.members.push(f);
      groups.set(key, g);
    }
    const rank = (f: GeoFeature) => {
      const s =
        f.properties.monitored === false
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
        },
      })),
    }),
    [beachGroups],
  );

  // Conteo de alertas vivas: por playa (grupo), no por punto de muestreo
  const closedCount = groupedBeaches.features.filter(
    (f) => f.properties.status === 'closed',
  ).length;
  const warningCount = groupedBeaches.features.filter(
    (f) => f.properties.status === 'warning',
  ).length;
  const hasAlerts = closedCount + warningCount > 0;

  const alertBeaches = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: groupedBeaches.features.filter(
        (f) =>
          f.properties.monitored !== false &&
          (f.properties.status === 'closed' ||
            f.properties.status === 'warning'),
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
      cameraRef.current?.flyTo({
        center: [focus[0], focus[1] - 0.014],
        zoom: 13,
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
          sub: 'Vertido',
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
        center: [lon, lat - (item.kind === 'beach' ? 0.014 : 0.03)],
        zoom: item.kind === 'beach' ? 13 : 12,
        duration: 1200,
      });
      onSelect(
        item.kind === 'beach'
          ? {
              type: 'beach',
              feature: item.feature,
              hasAlert: item.feature.properties.alert === true,
              members: item.members,
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

  const handlePress =
    (type: 'outfall' | 'beach') =>
    (e: NativeSyntheticEvent<PressEventWithFeatures>) => {
      const feature = e.nativeEvent.features?.[0] as unknown as
        | GeoFeature
        | undefined;
      if (!feature) return;
      saveView();
      // Zoom de detalle + centro desplazado al sur: el pin queda justo
      // por encima de la card flotante.
      const [lon, lat] = (
        feature.geometry as { coordinates: [number, number] }
      ).coordinates;
      cameraRef.current?.flyTo({
        center: [lon, lat - (type === 'beach' ? 0.014 : 0.03)],
        zoom: type === 'beach' ? 13 : 12,
        duration: 900,
      });
      if (type === 'outfall') {
        onSelect({ type: 'outfall', feature });
      } else {
        // El pin es el grupo: se abre la ficha del PM peor parado
        const groupKey = (
          feature.properties as { groupKey?: string }
        ).groupKey;
        const g = groupKey ? beachGroups.get(groupKey) : undefined;
        const rep = g?.rep ?? feature;
        onSelect({
          type: 'beach',
          feature: rep,
          hasAlert: rep.properties.alert === true,
          members: g?.members,
        });
      }
    };

  return (
    <View style={styles.container}>
      <Map
        style={styles.map}
        mapStyle={satellite ? SATELLITE_STYLE : SEA_STYLE}
        attributionPosition={{ bottom: 8, right: 8 }}
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
        <Camera ref={cameraRef} initialViewState={TENERIFE_VIEW} />

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
            data={outfalls}
            onPress={handlePress('outfall')}
          >
            <Layer
              id="outfall-icons"
              type="symbol"
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
                'icon-size': 0.36,
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
              layout={{
                'icon-image': [
                  'case',
                  ['==', ['get', 'monitored'], false],
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
                'icon-size': 0.42,
                'icon-anchor': 'bottom',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
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
                  ['==', ['get', 'monitored'], false],
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
                'text-font': [
                  'Noto Sans Regular',
                  'Open Sans Regular',
                  'Arial Unicode MS Regular',
                ],
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
              onPress={onOpenList}
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
              onPress={onOpenOutfalls}
              accessibilityRole="button"
              accessibilityLabel="Abrir lista de vertidos"
            >
              <Image
                source={require('../assets/icons/icon-faucet.png')}
                style={styles.topbarIcon}
              />
              <Text style={styles.topbarLabel}>Vertidos</Text>
            </Pressable>
          )}
          {onOpenMunicipalities && (
            <Pressable
              style={styles.topbarBtn}
              onPress={onOpenMunicipalities}
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
              setSearchOpen((v) => !v);
              setQuery('');
            }}
            accessibilityRole="button"
            accessibilityLabel="Buscar playa, vertido o municipio"
          >
            <Image
              source={require('../assets/icons/icon-search.png')}
              style={styles.topbarIcon}
            />
            <Text style={styles.topbarLabel}>Buscar</Text>
          </Pressable>
          <View style={styles.topbarDivider} />
          <Pressable
            style={styles.topbarBtn}
            onPress={() => setSatellite((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel="Cambiar vista del mapa"
          >
            <Image
              source={
                satellite
                  ? require('../assets/icons/icon-map.png')
                  : require('../assets/icons/icon-satellite.png')
              }
              style={styles.topbarIcon}
            />
            <Text style={styles.topbarLabel}>
              {satellite ? 'Mapa' : 'Satélite'}
            </Text>
          </Pressable>
          {onOpenHelp && (
            <Pressable
              style={styles.topbarBtn}
              onPress={onOpenHelp}
              accessibilityRole="button"
              accessibilityLabel="Abrir ayuda"
            >
              <Image
                source={require('../assets/icons/icon-help.png')}
                style={styles.topbarIcon}
              />
              <Text style={styles.topbarLabel}>Ayuda</Text>
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
            // Con alertas: vuela a la mas grave y abre su ficha.
            // Sin alertas: abre la lista general.
            const top =
              alertBeaches.features.find(
                (f) => f.properties.status === 'closed',
              ) ?? alertBeaches.features[0];
            if (top) {
              saveView();
              const [lon, lat] = (
                top.geometry as { coordinates: [number, number] }
              ).coordinates;
              cameraRef.current?.flyTo({
                center: [lon, lat - 0.014],
                zoom: 13,
                duration: 1200,
              });
              const gk = (
                top.properties as { groupKey?: string }
              ).groupKey;
              onSelect({
                type: 'beach',
                feature: top,
                hasAlert: true,
                members: gk ? beachGroups.get(gk)?.members : undefined,
              });
            } else {
              onOpenList?.();
            }
          }}
          accessibilityRole="button"
          accessibilityLabel="Resumen del estado de las playas"
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
          </Text>
        </Pressable>
        {searchOpen && (
          <View style={styles.searchWrap}>
            <TextInput
              style={styles.searchInput}
              placeholder="Buscar playa, vertido o municipio..."
              placeholderTextColor={colors.textFaint}
              value={query}
              onChangeText={setQuery}
              autoFocus
              autoCorrect={false}
              returnKeyType="search"
            />
            {searchResults.length > 0 && (
              <View style={styles.searchResults}>
                {searchResults.map((item) => (
                  <Pressable
                    key={item.key}
                    style={styles.searchRow}
                    onPress={() => pickResult(item)}
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

      <View style={styles.legend} pointerEvents="box-none">
        <Pressable
          style={[styles.legendRow, !showOutfalls && styles.legendOff]}
          onPress={() => setShowOutfalls((v) => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: showOutfalls }}
        >
          <Image
            source={require('../assets/icons/icon-faucet.png')}
            style={styles.legendIcon}
          />
          <Text style={styles.legendTitle}>Vertidos</Text>
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
              <View style={[styles.dot, { backgroundColor: color }]} />
              <Text style={styles.swatchText}>{label}</Text>
            </View>
          ))}
        </View>
        <Pressable
          style={[
            styles.legendRow,
            styles.legendRowGap,
            !showBeaches && styles.legendOff,
          ]}
          onPress={() => setShowBeaches((v) => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: showBeaches }}
        >
          <Image
            source={require('../assets/icons/beach.png')}
            style={styles.legendIcon}
          />
          <Text style={styles.legendTitle}>Playas</Text>
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
              <View style={[styles.dot, { backgroundColor: color }]} />
              <Text style={styles.swatchText}>{label}</Text>
            </View>
          ))}
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 58,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.border,
  },
  topbarIcon: {
    width: 22,
    height: 22,
  },
  topbarLabel: {
    fontSize: 10,
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
    fontFamily: fonts.bold,
  },
  searchWrap: {
    alignSelf: 'stretch',
  },
  searchInput: {
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
    elevation: 4,
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
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  legend: {
    position: 'absolute',
    bottom: Platform.OS === 'android' ? 42 : 12, // por encima de la barra de gestos
    left: 5,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 8,
    padding: 10,
    elevation: 4,
  },
  legendRowGap: {
    marginTop: 8,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 140,
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
    fontFamily: fonts.extrabold,
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
  legendSub: {
    marginLeft: 14,
    marginTop: 4,
    marginBottom: 2,
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
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
});

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Image,
  Keyboard,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
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
import { beachBaseName, displayBeachName } from '../lib/format';

import { recentlyResolved } from '../lib/episodes';

import {
  beachCategory,
  buildAlertSections,
  buildBeachGroups,
  outfallCategory,
  pmMembersOf,
  searchMap,
  type SearchItem,
} from '../lib/mapData';
import { colors } from '../lib/theme';
import seaStyle from '../assets/mapstyle-sea.json';
import AlertsBanner from './map/AlertsBanner';
import LayersPanel from './map/LayersPanel';
import MapLegend from './map/MapLegend';
import MapSearch from './map/MapSearch';
import MapTopbar from './map/MapTopbar';

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
  const beachGroups = useMemo(
    () => buildBeachGroups(beaches.features),
    [beaches],
  );

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
  const alertSections = useMemo(
    () => buildAlertSections(alertBeaches.features),
    [alertBeaches],
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
      // Grupo multi-PM sin zoom explícito: encuadra todos los puntos
      if (!exact && grp && grp.members.length > 1) {
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
  const searchResults = useMemo(
    () => searchMap(query, beachGroups, outfalls.features, beaches.features),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, beachGroups, outfalls],
  );

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

  // Pill del banner: con alertas despliega/pliega la lista; sin
  // alertas abre la lista general
  const pressBanner = () => {
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
        <MapTopbar
          onOpenList={
            onOpenList &&
            (() => {
              closeOverlays();
              onOpenList();
            })
          }
          onOpenOutfalls={
            onOpenOutfalls &&
            (() => {
              closeOverlays();
              onOpenOutfalls();
            })
          }
          onOpenMunicipalities={
            onOpenMunicipalities &&
            (() => {
              closeOverlays();
              onOpenMunicipalities();
            })
          }
          onToggleSearch={() => {
            const next = !searchOpen;
            setSearchOpen(next);
            setQuery('');
            setAlertsOpen(false);
            if (next) onDismissSelection?.();
          }}
          onOpenHelp={
            onOpenHelp &&
            (() => {
              closeOverlays();
              onDismissSelection?.();
              onOpenHelp();
            })
          }
        />
        <AlertsBanner
          closedCount={closedCount}
          warningCount={warningCount}
          alertsOpen={alertsOpen}
          alertCount={alertBeaches.features.length}
          alertSections={alertSections}
          resueltas={resueltas}
          onPress={pressBanner}
          onOpenAlertBeach={openAlertBeach}
          onOpenEpisodeBeach={openEpisodeBeach}
          onOpenTemporada={
            onOpenTemporada &&
            (() => {
              setAlertsOpen(false);
              onOpenTemporada();
            })
          }
        />
        {searchOpen && (
          <MapSearch
            query={query}
            onChangeQuery={setQuery}
            results={searchResults}
            onPick={pickResult}
            inputRef={searchInputRef}
          />
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
        <LayersPanel
          beachSel={beachSel}
          setBeachSel={setBeachSel}
          outfallSel={outfallSel}
          setOutfallSel={setOutfallSel}
        />
      )}

      <MapLegend beachSel={beachSel} outfallSel={outfallSel} />

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
  // Feedback táctil común: leve fundido al presionar
  pressFx: {
    opacity: 0.6,
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
});

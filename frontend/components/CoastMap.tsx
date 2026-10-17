import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Image,
  ImageBackground,
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
  Map,
  type PressEventWithFeatures,
  type StyleSpecification,
} from '@maplibre/maplibre-react-native';

import type {
  FeatureCollection,
  GeoFeature,
  MunicipalityIncident,
} from '../lib/api';
import { beachBaseName, displayBeachName, pointLongLabel } from '../lib/format';
import { groupKeyOf } from '../lib/beachGroups';
import { storage } from '../lib/storage';

import { recentlyResolved } from '../lib/episodes';

import {
  beachCategory,
  buildAlertSections,
  buildBeachGroups,
  isStructuralClosure,
  outfallCategory,
  pmMembersOf,
  searchMap,
  type SearchItem,
} from '../lib/mapData';
import {
  TENERIFE_BOUNDS,
  useMapCamera,
  type MapFocus,
} from '../hooks/useMapCamera';
import { colors, fonts } from '../lib/theme';
import seaStyle from '../assets/mapstyle-sea.json';
import AlertsBanner from './map/AlertsBanner';
import LayersPanel from './map/LayersPanel';
import MapLayers from './map/MapLayers';
import MapLegend from './map/MapLegend';
import MapSearch from './map/MapSearch';
import MapTopbar from './map/MapTopbar';

// Flag de primer uso del bocadillo de capas
const LAYERS_HINT_KEY = 'checkcoast.layers_hint_seen';

// Estilo vectorial tematico (OpenFreeMap/OpenMapTiles retenido con la
// paleta oceanica por scripts/gen_mapstyle.py). Sin API key.
const SEA_STYLE = seaStyle as unknown as StyleSpecification;

// Estilo raster satélite con PNOA del IGN (ortofoto oficial española,
// sin key): cobertura uniforme — Esri World Imagery deja tiles
// placeholder negros en Anaga/Teide a cualquier zoom. El TMS de IDEE
// (endpoint canónico) es estable; el WMTS de www.ign.es responde 504
// intermitentes y dejaba la tierra como mancha borrosa (tiles padre
// estiradas). Las etiquetas siguen siendo la capa de Esri (híbrido).
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    pnoa: {
      type: 'raster',
      tiles: ['https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{y}.jpeg'],
      scheme: 'tms',
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

export type Selection =
  | { type: 'outfall'; feature: GeoFeature }
  | {
      type: 'beach';
      feature: GeoFeature;
      hasAlert: boolean;
      // Puntos de muestreo del grupo (si la playa tiene varios PMs):
      // la card muestra primero un selector para elegir cuál ver
      members?: GeoFeature[];
      // PM concreto a abrir directamente (sin pasar por el selector):
      // deep-links, pushes y filas de episodio apuntan a un PM —
      // la ficha debe abrirse en esa zona, no en el selector genérico
      pm?: GeoFeature;
    };

type CoastMapProps = {
  outfalls: FeatureCollection;
  beaches: FeatureCollection; // con properties.alert ya inyectado
  // [lon, lat, zoom?, tipoCard?] a donde volar la cámara; con zoom
  // explícito y SIN tipo se centra exacto (pin sin card). Con tipo,
  // se aplica el padding de la card que se abre (beach | outfall)
  focus?: MapFocus;
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
  // La ficha expandida tapa los botones flotantes (satélite, brújula,
  // capas): se desactivan para que un toque sobre la ficha — la ✕
  // queda justo sobre el botón satélite — cierre la card en vez de
  // pulsar el botón tapado
  controlsCovered?: boolean;
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
  controlsCovered = false,
}: CoastMapProps) {
  const [satellite, setSatellite] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Lista desplegable de playas en aviso (banner de alertas)
  const [alertsOpen, setAlertsOpen] = useState(false);
  // Panel de capas por estado (botón flotante junto a la brújula)
  const [layersOpen, setLayersOpen] = useState(false);
  // Bocadillo de primer uso sobre la leyenda: enseña una vez que hay
  // capas ocultas y que la leyenda/botón las abre
  const [layersHint, setLayersHint] = useState(false);
  const [query, setQuery] = useState('');
  // Ref del buscador: Keyboard.dismiss() solo no basta en Android —
  // el input conserva el foco y el teclado se queda tapando la card
  const searchInputRef = useRef<TextInput>(null);
  // Cada estado de la leyenda es una sub-capa marcable: marcado =
  // visible, desmarcado = oculto. Empiezan todas marcadas; el set
  // vacío equivale a la capa apagada (no hay switch aparte)
  const [beachSel, setBeachSel] = useState<Set<string>>(
    () => new Set(['open', 'warning', 'closed', 'structural']),
  );
  const [outfallSel, setOutfallSel] = useState<Set<string>>(
    () => new Set(['illegal']),
  );
  const [pulse, setPulse] = useState(0);
  // Agrupación por playa: cada punto de muestreo (PM1, PM2, Troya I/II)
  // es un registro oficial distinto, pero el mapa dibuja UN pin por
  // playa en el centroide, coloreado por el peor estado del grupo.
  // La ficha que se abre es la del PM peor parado (representante).
  // useMemo manual necesario: React Compiler no está activo en el
  // build (experiments.reactCompiler off) — sin esto se recalcularía
  // el agrupado de ~200 playas en cada render

  const beachGroups = useMemo(
    () => buildBeachGroups(beaches.features),
    [beaches.features],
  );

  // Cámara: refs de vista, restauración al cerrar la ficha, paddings
  // de card y vuelos a pins — la coreografía vive en el hook
  const {
    cameraRef,
    cardPad,
    outfallPad,
    saveView,
    discardSavedView,
    fitBeachBounds,
    onRegionDidChange,
    northUp,
  } = useMapCamera({
    selectionActive,
    focus,
    zoneFocus,
    pmPoints,
    beachGroups,
  });

  // Bocadillo de capas: solo el primer arranque del build — enseña
  // que la leyenda/botón abren el panel. Se marca al tocarlo o al
  // abrir Capas por cualquier vía
  useEffect(() => {
    let alive = true;
    storage
      ?.getItem(LAYERS_HINT_KEY)
      .then((seen) => {
        if (alive && seen === null) setLayersHint(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const dismissLayersHint = () => {
    setLayersHint(false);
    storage?.setItem(LAYERS_HINT_KEY, '1').catch(() => {});
  };

  const openLayers = () => {
    closeSearch();
    setAlertsOpen(false);
    onDismissSelection?.();
    dismissLayersHint();
    setLayersOpen(true);
  };

  // Vuela a una playa en aviso y abre su ficha (lista del banner).
  // No guarda vista previa: navegar a una alerta es decisión del
  // usuario, no un toque accidental de pin — al cerrar no se restaura
  const openAlertBeach = (f: GeoFeature) => {
    closeSearch();
    discardSavedView();
    // El pin se dibuja en el centroide del grupo, no en las coords del
    // PM: la cámara apunta al mismo punto o queda descolocado
    // La feature puede venir cruda de `beaches` (fila de episodio):
    // sin groupKey inyectado el grupo no resolvía, la ficha quedaba
    // sin zonas y su cabecera perdía el nombre de la cala
    const gk =
      (f.properties as { groupKey?: string }).groupKey ?? groupKeyOf(f);
    const g = beachGroups[gk];
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
        padding: cardPad,
        duration: 1200,
      });
    }
    const members = pmMembersOf(gk ? beachGroups[gk]?.members : undefined);
    onSelect({
      type: 'beach',
      feature: f,
      hasAlert: true,
      members,
      // La fila de alerta/episodio apunta a un PM concreto: abre la
      // ficha de esa zona directamente (atrás → picker), no el picker
      // genérico con cabecera de playa sin indicar cuál reabrió
      ...(members ? { pm: f } : {}),
    });
    setAlertsOpen(false);
  };

  // Un pin por playa: geometría del centroide + propiedades del PM
  // representante (peor estado) + groupKey para resolver al pulsar
  const groupedBeaches = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: Object.entries(beachGroups).map(([key, g]) => ({
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

  // Nombre común de la zona de un PM en un complejo multipunto
  // ("Punta Brava"); null si la playa es de un solo punto — el
  // banner lo usa para "Playa Jardín · Punta Brava"
  const zoneLabelFor = (beachId: number) => {
    const f = beaches.features.find((x) => x.id === beachId);
    if (!f) return null;
    const gk =
      (f.properties as { groupKey?: string }).groupKey ?? groupKeyOf(f);
    const g = gk ? beachGroups[gk] : undefined;
    if (!g || g.members.length < 2) return null;
    return pointLongLabel(f.properties.name);
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
    // El cierre estructural no late: el pulso es urgencia
    // (contaminación), no un aviso viejo que todos conocen
    if (!pmPoints || pmPoints.features.length === 0)
      return {
        type: 'FeatureCollection',
        features: visibleAlertBeaches.features.filter(
          (f) => !isStructuralClosure(f),
        ),
      };
    const memberIds = new Set(pmPoints.features.map((f) => f.id));
    return {
      type: 'FeatureCollection',
      features: [
        ...visibleAlertBeaches.features.filter((f) => !memberIds.has(f.id)),
        ...pmPoints.features.filter(
          (f) =>
            (f.properties.status === 'closed' ||
              f.properties.status === 'warning') &&
            beachSel.has(beachCategory(f)),
        ),
      ].filter((f) => !isStructuralClosure(f)),
    };
  }, [visibleAlertBeaches, pmPoints, beachSel]);

  // Pulso estructural: mismo lenguaje que la contaminación pero lento
  // y tenue — lo crónico late despacio, no grita. Con la card PM
  // abierta sigue a cada cala, si no al centroide (igual que alertPulse)
  const structuralPulse = useMemo(() => {
    if (pmPoints && pmPoints.features.length > 0) {
      return {
        type: 'FeatureCollection' as const,
        features: pmPoints.features.filter(
          (f) => isStructuralClosure(f) && beachSel.has(beachCategory(f)),
        ),
      };
    }
    return {
      type: 'FeatureCollection' as const,
      features: visibleAlertBeaches.features.filter(isStructuralClosure),
    };
  }, [visibleAlertBeaches, pmPoints, beachSel]);

  // Halo que crece y se desvance ~1 ciclo/seg solo si hay algo que
  // pulsar — con solo cierres estructurales alertPulse queda vacío y
  // el timer re-renderizaría sin animación visible
  const pulsing = alertPulse.features.length > 0;
  useEffect(() => {
    if (!pulsing) return;
    const t = setInterval(() => setPulse((p) => (p + 0.1) % 1), 110);
    return () => clearInterval(t);
  }, [pulsing]);

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
    discardSavedView();
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
          padding: item.kind === 'outfall' ? outfallPad : cardPad,
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
  const closeOverlays = () => {
    closeSearch();
    setAlertsOpen(false);
    setLayersOpen(false);
  };

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

  const handlePress = (
    type: 'outfall' | 'beach',
    e: NativeSyntheticEvent<PressEventWithFeatures>,
  ) => {
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
    const g = type === 'beach' && groupKey ? beachGroups[groupKey] : undefined;
    const [lon, lat] = (g?.center ??
      (feature.geometry as { coordinates: [number, number] }).coordinates) as [
      number,
      number,
    ];
    const rep = g?.rep ?? feature;
    if (type === 'beach' && g && g.members.length > 1) {
      fitBeachBounds(g.members, 900);
    } else {
      cameraRef.current?.flyTo({
        center: [lon, lat],
        // Playa: zoom 15.5 — el de la ficha abierta desde un emisario,
        // que enseña el entorno de la playa de cerca
        zoom: type === 'beach' ? 15.5 : 15,
        padding: type === 'outfall' ? outfallPad : cardPad,
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
        onRegionDidChange={onRegionDidChange}
      >
        <Camera ref={cameraRef} initialViewState={TENERIFE_BOUNDS} />

        {/* Catálogo de capas (pins, pulsos, etiquetas, dots PM):
            extraído a components/map/MapLayers — es JSX declarativo,
            la lógica queda aquí */}
        <MapLayers
          visibleBeaches={visibleBeaches}
          visibleOutfalls={visibleOutfalls}
          showBeaches={beachSel.size > 0}
          showOutfalls={outfallSel.size > 0}
          alertPulse={alertPulse}
          structuralPulse={structuralPulse}
          pulse={pulse}
          pmPoints={pmPoints}
          onPressFeature={handlePress}
        />
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
          zoneLabelFor={zoneLabelFor}
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
        pointerEvents={controlsCovered ? 'none' : 'auto'}
        style={({ pressed }) => [
          styles.satBtn,
          (alertsOpen || layersOpen) && styles.ctrlBtnDisabled,
          controlsCovered && styles.ctrlHidden,
          pressed && styles.pressFx,
        ]}
        disabled={alertsOpen || layersOpen || controlsCovered}
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
        pointerEvents={controlsCovered ? 'none' : 'auto'}
        style={({ pressed }) => [
          styles.compassBtn,
          (alertsOpen || layersOpen) && styles.ctrlBtnDisabled,
          controlsCovered && styles.ctrlHidden,
          pressed && styles.pressFx,
        ]}
        disabled={alertsOpen || layersOpen || controlsCovered}
        onPress={northUp}
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
        pointerEvents={controlsCovered ? 'none' : 'auto'}
        style={({ pressed }) => [
          styles.layersBtn,
          controlsCovered && styles.ctrlHidden,
          pressed && styles.pressFx,
        ]}
        disabled={controlsCovered}
        onPress={() => {
          if (!layersOpen) {
            openLayers();
          } else {
            setLayersOpen(false);
          }
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

      {/* Bocadillo de primer uso: apunta a la leyenda, que ahora
          abre el panel de capas */}
      {layersHint && !layersOpen && (
        <Pressable
          style={styles.layersHintWrap}
          onPress={openLayers}
          accessibilityRole="button"
          accessibilityLabel="Abrir panel de capas"
        >
          {/* Mismo degradado mar que la cabecera de la IntroCard */}
          <ImageBackground
            source={require('../assets/gradient-sea.png')}
            style={styles.layersHintBubble}
            imageStyle={styles.layersHintBubbleImg}
            resizeMode="cover"
          >
            <Text style={styles.layersHintText}>
              ¿Quieres ver todas las playas y emisarios?
            </Text>
            <View style={styles.layersHintRow}>
              <Text style={[styles.layersHintText, { width: 140 }]}>
                Pulsa aquí o en «Capas»
              </Text>
              <View style={styles.layersHintBtn}>
                <Image
                  source={require('../assets/icons/icon-layers.png')}
                  style={styles.layersHintIcon}
                />
              </View>
              <Text style={[styles.layersHintText, { width: 75 }]}>
                para verlas
              </Text>
            </View>
          </ImageBackground>
          <View style={styles.layersHintTail} />
        </Pressable>
      )}
      <MapLegend
        beachSel={beachSel}
        outfallSel={outfallSel}
        onOpenLayers={openLayers}
      />

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
  // Bocadillo de primer uso sobre la leyenda (la cola apunta a ella)
  layersHintWrap: {
    position: 'absolute',
    bottom: Platform.OS === 'android' ? 132 : 104,
    left: 0,
    right: 0,
    elevation: 6,
    zIndex: 6,
  },
  layersHintBubble: {
    borderRadius: 10,
    overflow: 'hidden',
    // Centrado por construcción: margen fijo a ambos lados, el globo
    // estira entre ellos — no depende de alignSelf ni de Yoga
    marginHorizontal: '10%',
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  layersHintBubbleImg: {
    borderRadius: 10,
  },
  // Segunda línea del bocadillo: texto + mini-botón en fila centrada
  layersHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    marginTop: 4,
  },
  layersHintText: {
    color: colors.onColor,
    fontSize: 12,
    fontFamily: fonts.semibold,
    textAlign: 'center',
  },
  // Réplica del botón Capas del mapa: cápsula blanca + icono
  layersHintBtn: {
    width: 20,
    height: 20,
    marginLeft: 1,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  layersHintIcon: {
    width: 14,
    height: 14,
  },
  layersHintTail: {
    position: 'absolute',
    bottom: -7,
    alignSelf: 'center',
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    // Azul medio del degradado: casa con el borde inferior del globo
    borderTopColor: colors.primary,
  },
  // Botones flotantes atenuados mientras hay un panel abierto
  // (alertas/capas) — se ven muertos, no se pueden pulsar
  ctrlBtnDisabled: {
    opacity: 0.4,
  },
  // Cubiertos por la ficha expandida: invisibles y sin toques — un
  // tap sobre la card no debe llegar al botón oculto debajo
  ctrlHidden: {
    opacity: 0,
  },
});

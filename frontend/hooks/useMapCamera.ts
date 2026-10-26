import { useEffect, useRef } from 'react';
import { useWindowDimensions } from 'react-native';
import type { CameraRef } from '@maplibre/maplibre-react-native';

import type { FeatureCollection, GeoFeature } from '../lib/api';
import type { MapBeachGroup } from '../lib/mapData';
import { shortOutfallName } from '../lib/format';

// Vista inicial: la isla entera encuadrada con margen (fitBounds se
// adapta al tamaño de pantalla, a diferencia de un zoom fijo)
export const TENERIFE_BOUNDS = {
  bounds: [-16.95, 27.98, -16.1, 28.58] as [number, number, number, number],
  padding: { top: 110, right: 24, bottom: 70, left: 24 },
};
// Centro/zoom equivalente para restaurar la vista tras cerrar una card
const TENERIFE_VIEW = {
  center: [-16.6291, 28.2916] as [number, number],
  zoom: 9,
};

// [lon, lat, zoom?, tipoCard?] a donde volar la cámara; con zoom
// explícito y SIN tipo se centra exacto (pin sin card). Con tipo,
// se aplica el padding de la card que se abre (beach | outfall)
export type MapFocus = [number, number, number?, ('beach' | 'outfall')?] | null;

type ViewState = { center: [number, number]; zoom: number };

type UseMapCameraArgs = {
  // hay card abierta -> al cerrar restaura la vista guardada
  selectionActive: boolean;
  // Miembros del grupo de la ficha abierta (solo playas multi-PM):
  // al cerrar, el aterrizaje es el arenal entero, no la vista previa
  selectionMembers?: GeoFeature[];
  // foco externo (lista, deep-link, alerta): vuela a ese punto
  focus?: MapFocus;
  // Zona concreta abierta en la ficha multipunto (null = selector):
  // el encuadre sube al PM concreto mientras la ficha lo muestra
  zoneFocus?: GeoFeature | null;
  // Puntos de muestreo del grupo seleccionado (dots temporales)
  pmPoints?: FeatureCollection;
  // Grupos de playa: el foco sobre un PM se traduce a su centroide
  beachGroups: Record<string, MapBeachGroup>;
  // Borde superior real de la ficha de emisario abierta (lo reporta
  // FeatureSheet tras medir el contenido) — corrige el encuadre del
  // pin para que su etiqueta no quede bajo la ficha
  outfallSheetTop?: number | null;
  // Emisario seleccionado (para el re-encuadre fino de arriba)
  selectedOutfall?: GeoFeature | null;
};

// Coreografía de cámara del mapa: guarda la vista antes de un vuelo,
// vuela a pins/cards con el padding adecuado y restaura al cerrar —
// respetando un paneo manual del usuario. El estado interno (vista
// guardada, paneo manual) queda encapsulado; los callers reciben
// cameraRef para vuelos puntuales y los helpers de intención
export function useMapCamera({
  selectionActive,
  selectionMembers,
  focus,
  zoneFocus = null,
  pmPoints,
  beachGroups,
  outfallSheetTop = null,
  selectedOutfall = null,
}: UseMapCameraArgs) {
  const cameraRef = useRef<CameraRef>(null);
  const { height: winH } = useWindowDimensions();
  // Con la card abierta el pin se apoya en el borde superior de la
  // card, no en el centro de la franja libre: el nombre de la playa se
  // dibuja BAJO el pin (~40px) y la card plegada puede cubrir hasta el
  // 64% del alto (PEEK_MAX de FeatureSheet) + 44px que flota sobre el
  // borde — su borde superior queda a 0.36·winH-44. Reservar abajo
  // 0.28·winH+348 centra el punto ~50px sobre ese borde: la etiqueta
  // queda visible y el pin lo más bajo posible. El clamp garantiza una
  // franja libre mínima en pantallas bajas/horizontal. +318 en cardPad:
  // los pins con badge son más altos y a 348 quedaban pegados al borde
  const cardPad = {
    top: 120,
    bottom: Math.min(Math.round(winH * 0.28) + 318, winH - 180),
  };
  // fitBeachBounds (grupo multi-PM) conserva la reserva anterior:
  // el +318 pensado para pin único dejaba el encuadre demasiado abajo
  const boundsPad = {
    top: cardPad.top,
    bottom: Math.min(Math.round(winH * 0.28) + 348, winH - 180),
  };
  // Card de vertido: estimación inicial conservadora (~media
  // pantalla). La ficha mide su contenido real (peek = cuerpo +
  // cabecera) y reporta su borde superior — el ajuste fino llega
  // con outfallSheetTop abajo; aquí solo evitamos que el pin
  // arranque dentro de la ficha
  const outfallSheetOcc = Math.min(Math.round(winH * 0.5) + 44, winH - 220);
  // El nombre del vertido se dibuja BAJO el pin (~16px/línea a 13px,
  // ~15 caracteres por línea con wrap por palabra, sobre la etiqueta
  // ya acortada sin "Valle de…"): cada línea pide su reserva bajo el
  // punto o la card se la come — el +12 es aire entre label y ficha
  const outfallPadFor = (name?: string | null) => {
    const lines = Math.max(
      1,
      Math.ceil(shortOutfallName(name ?? '').length / 15),
    );
    return {
      top: 120,
      bottom: Math.min(outfallSheetOcc + lines * 16 + 12, winH - 180),
    };
  };
  // Foco externo sin nombre a la mano: peor caso de etiqueta (2 líneas)
  const outfallPad = {
    top: 120,
    bottom: Math.min(outfallSheetOcc + 44, winH - 180),
  };

  // Vista actual + vista guardada antes de volar a un pin (para
  // restaurar al cerrar la card)
  const lastView = useRef<ViewState>({
    center: TENERIFE_VIEW.center,
    zoom: TENERIFE_VIEW.zoom,
  });
  const savedView = useRef<ViewState | null>(null);
  // Marca si el usuario arrastró el mapa a mano después del último
  // vuelo automático — si lo hizo, al cerrar la card no se restaura
  // la vista previa: se quedó donde él decidió
  const userPanned = useRef(false);
  const prevSelection = useRef(selectionActive);
  const prevMembers = useRef(selectionMembers);

  // Navegación deliberada (alerta, búsqueda, lista, deep-link): no hay
  // vista que restaurar al cerrar la card — el mapa se queda donde el
  // usuario decidió ir
  const discardSavedView = () => {
    userPanned.current = false;
    savedView.current = null;
  };

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
          top: boundsPad.top + 60,
          right: 64,
          bottom: boundsPad.bottom,
          left: 64,
        },
        duration,
      },
    );
  };

  // Card cerrada -> vuelve a la vista previa al toque del pin, SOLO si
  // el usuario no movió el mapa a mano mientras la ficha estaba
  // abierta (si lo movió, esa posición es la que quiere). Excepción:
  // en un grupo multi-PM el aterrizaje es el arenal entero — el zoom
  // de detalle de la zona abierta dejaba un pin aislado a 15.5
  useEffect(() => {
    if (prevSelection.current && !selectionActive && !userPanned.current) {
      if ((prevMembers.current?.length ?? 0) > 1) {
        fitBeachBounds(prevMembers.current!, 800);
      } else if (savedView.current) {
        cameraRef.current?.flyTo({
          center: savedView.current.center,
          zoom: savedView.current.zoom,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          duration: 800,
        });
      }
    }
    if (!selectionActive) savedView.current = null;
    prevSelection.current = selectionActive;
    prevMembers.current = selectionMembers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionActive, selectionMembers]);

  const pmShown = !!(pmPoints && pmPoints.features.length > 0);
  // Ficha de una zona abierta: vuela al PM concreto con zoom de
  // detalle (≥15.5). El pinch-zoom de MapLibre se ancla al punto del
  // gesto, no al centro de cámara — encuadrar el grupo y solo panear
  // al PM dejaba el centro libre sobre el mar y el zoom se perdía;
  // con el PM a zoom de detalle el punto domina la pantalla y el
  // gesto se queda sobre él. Al volver al selector se restaura la
  // vista previa (centro + zoom)
  const prevZoneFocus = useRef<GeoFeature | null>(null);
  const preZoneView = useRef<ViewState | null>(null);
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
    // el reseteo de padding, tapando el desplazamiento que queremos.
    // +64 abajo: el dot del PM quedaba pegado al borde superior de la
    // ficha — con la reserva extra sube a la mitad de la franja libre
    const pad = {
      top: cardPad.top + 60,
      right: 64,
      bottom: cardPad.bottom + 64,
      left: 64,
    };
    if (opening) {
      preZoneView.current = { center, zoom };
      const [pmLon, pmLat] = zoneFocus!.geometry.coordinates as [
        number,
        number,
      ];
      cameraRef.current?.flyTo({
        center: [pmLon, pmLat],
        zoom: Math.max(zoom, 15.5),
        padding: pad,
        duration: 400,
      });
    } else {
      // Vuelta al selector: encuadra el grupo entero. Restaurar la
      // vista previa fallaba cuando la ficha abrió la zona directa
      // (deep-link desde Municipios): preZoneView era la vista del
      // mapa ANTES de volar — ajena al grupo. fitBounds es el
      // encuadre correcto venga de donde venga
      const sameGroup = pmPoints!.features.some((f) => f.id === prev!.id);
      if (sameGroup) {
        fitBeachBounds(pmPoints!.features, 400);
      }
      preZoneView.current = null;
    }
  }, [zoneFocus, pmShown, pmPoints, cardPad.top, cardPad.bottom]);

  // Vuela a la playa elegida en la lista
  useEffect(() => {
    if (focus) {
      discardSavedView();
      const exact = focus[2] != null;
      // Si el foco casa con un PM de un grupo, el pin está en el
      // centroide: volar ahí, no a las coords del PM
      let cx = focus[0];
      let cy = focus[1];
      let grp: MapBeachGroup | undefined;
      for (const g of Object.values(beachGroups)) {
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
            ? outfallPad
            : cardPad
          : exact
            ? undefined
            : cardPad,
        duration: 1500,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // Re-encuadre fino del pin de emisario: el vuelo inicial usa una
  // reserva estimada; cuando la ficha reporta su borde superior real
  // (peek medido) se recoloca el punto para que la etiqueta completa
  // quede justo encima. Solo en reposo — expandir no cambia peek,
  // así que un arrastre del usuario no dispara correcciones
  useEffect(() => {
    if (outfallSheetTop == null || !selectedOutfall) return;
    const [lon, lat] = selectedOutfall.geometry.coordinates as [number, number];
    const lines = Math.max(
      1,
      Math.ceil(
        shortOutfallName(selectedOutfall.properties.name ?? '').length / 15,
      ),
    );
    cameraRef.current?.easeTo({
      center: [lon, lat],
      zoom: lastView.current.zoom,
      padding: {
        top: 120,
        bottom: Math.min(
          Math.round(winH - outfallSheetTop) + lines * 16 + 8,
          winH - 180,
        ),
      },
      duration: 450,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outfallSheetTop, selectedOutfall]);

  // onRegionDidChange del Map: actualiza la vista actual y marca el
  // paneo/zoom manual (al cerrar la card no se restaura la vista
  // anterior — el usuario ya eligió dónde mirar)
  const onRegionDidChange = (e: unknown) => {
    const vs = (
      e as {
        nativeEvent?: {
          center?: [number, number];
          zoom?: number;
          userInteraction?: boolean;
        };
      }
    ).nativeEvent;
    if (vs?.center && typeof vs.zoom === 'number') {
      lastView.current = { center: vs.center, zoom: vs.zoom };
    }
    if (vs?.userInteraction) userPanned.current = true;
  };

  // Brújula: reorienta el mapa al norte conservando centro y zoom
  const northUp = () =>
    cameraRef.current?.easeTo({
      center: lastView.current.center,
      bearing: 0,
      duration: 400,
    });

  return {
    cameraRef,
    cardPad,
    outfallPad,
    outfallPadFor,
    saveView,
    discardSavedView,
    fitBeachBounds,
    onRegionDidChange,
    northUp,
  };
}

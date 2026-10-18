import React from 'react';
import type { NativeSyntheticEvent } from 'react-native';
import {
  GeoJSONSource,
  Images,
  Layer,
  type PressEventWithFeatures,
} from '@maplibre/maplibre-react-native';

import type { FeatureCollection } from '../../lib/api';
import { FAUNA_CAUSES, STRUCTURAL_CAUSES } from '../../lib/mapData';
import { colors } from '../../lib/theme';

const BEACH_COLORS = colors.status;

type Props = {
  // Colecciones ya filtradas por la selección de la leyenda
  visibleBeaches: FeatureCollection;
  visibleOutfalls: FeatureCollection;
  // Toggles de capas (leyenda): si un estado entero está apagado su
  // source ni se monta
  showBeaches: boolean;
  showOutfalls: boolean;
  // Halos de pulso (contaminación = rápido; estructural = anillo fijo)
  alertPulse: FeatureCollection;
  structuralPulse: FeatureCollection;
  pulse: number; // 0..1, timer del padre
  // Dots "PMn" de la playa con card abierta
  pmPoints?: FeatureCollection;
  onPressFeature: (
    type: 'outfall' | 'beach',
    e: NativeSyntheticEvent<PressEventWithFeatures>,
  ) => void;
};

// Catálogo de capas del mapa: imágenes de pin + todas las sources/
// layers de playas, emisarios, pulsos y dots PM. Es JSX declarativo
// puro — la lógica (cámara, selección, filtros) queda en CoastMap.
export default function MapLayers({
  visibleBeaches,
  visibleOutfalls,
  showBeaches,
  showOutfalls,
  alertPulse,
  structuralPulse,
  pulse,
  pmPoints,
  onPressFeature,
}: Props) {
  const pmShown = !!(pmPoints && pmPoints.features.length > 0);
  const pulsing = alertPulse.features.length > 0;
  const pulsingStructural = structuralPulse.features.length > 0;

  return (
    <>
      <Images
        images={{
          'pin-open': require('../../assets/icons/pin-open.png'),
          'pin-warning': require('../../assets/icons/pin-warning.png'),
          'pin-closed': require('../../assets/icons/pin-closed.png'),
          'pin-algas': require('../../assets/icons/pin-algas.png'),
          'pin-medusas': require('../../assets/icons/pin-medusas.png'),
          'pin-gasoil': require('../../assets/icons/pin-gasoil.png'),
          'pin-structural': require('../../assets/icons/pin-structural.png'),
          'pin-unmonitored': require('../../assets/icons/pin-unmonitored.png'),
          'pin-outfall-legal': require('../../assets/icons/pin-outfall-legal.png'),
          'pin-outfall-illegal': require('../../assets/icons/pin-outfall-illegal.png'),
          'pin-outfall-processing': require('../../assets/icons/pin-outfall-processing.png'),
        }}
      />

      {showOutfalls && (
        <GeoJSONSource
          id="outfalls"
          data={visibleOutfalls}
          onPress={(e) => onPressFeature('outfall', e)}
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
              'text-halo-color': colors.surface,
              'text-halo-width': 2.2,
            }}
          />
        </GeoJSONSource>
      )}

      {/* Halo estructural fijo: anillo granate pequeño que marca la
          zona crónica sin latir — la urgencia es solo de
          contaminación */}
      {showBeaches && pulsingStructural && (
        <GeoJSONSource id="structural-pulse" data={structuralPulse}>
          <Layer
            id="beach-pulse-structural"
            type="circle"
            paint={{
              // radio + translate interpolados al zoom: el pin crece
              // con icon-size y el anillo debe seguir envolviendo la
              // cabeza (el punto de anclaje es la punta inferior)
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                9,
                11,
                13,
                17,
                16,
                18,
              ],
              'circle-translate': [
                'interpolate',
                ['linear'],
                ['zoom'],
                9,
                ['literal', [0, -11]],
                13,
                ['literal', [0, -18]],
                16,
                ['literal', [0, -19]],
              ],
              'circle-color': BEACH_COLORS.structural,
              'circle-opacity': 0.2,
              'circle-stroke-color': BEACH_COLORS.structural,
              'circle-stroke-width': 2,
              'circle-stroke-opacity': 0.55,
            }}
          />
        </GeoJSONSource>
      )}

      {showBeaches && pulsing && (
        <GeoJSONSource id="beach-alerts" data={alertPulse}>
          <Layer
            id="beach-pulse"
            type="circle"
            paint={{
              'circle-radius': 14 + pulse * 26,
              'circle-color': [
                'case',
                [
                  'all',
                  ['==', ['get', 'status'], 'closed'],
                  [
                    'in',
                    ['get', 'alert_cause'],
                    ['literal', [...FAUNA_CAUSES]],
                  ],
                ],
                BEACH_COLORS.fauna,
                [
                  'match',
                  ['get', 'status'],
                  'closed',
                  BEACH_COLORS.closed,
                  BEACH_COLORS.warning,
                ],
              ],
              'circle-opacity': 0.6 * (1 - pulse),
            }}
          />
        </GeoJSONSource>
      )}

      {showBeaches && (
        <GeoJSONSource
          id="beaches"
          data={visibleBeaches}
          onPress={(e) => onPressFeature('beach', e)}
        >
          <Layer
            id="beach-pins"
            type="symbol"
            filter={[
              'all',
              ['!=', ['get', 'sel'], true],
              ['!=', ['get', 'status'], 'closed'],
            ]}
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
                0.17,
                13,
                0.29,
                16,
                0.34,
              ],
              'icon-anchor': 'bottom',
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
            }}
          />
          {/* Pines de cierre en capa propia: el asset es 96x146 (pin
              + badge flotante de causa), asi que el icon-size se
              compensa x146/96 para que el pin renderice al mismo
              tamano que los demas */}
          <Layer
            id="beach-pins-closed"
            type="symbol"
            filter={[
              'all',
              ['!=', ['get', 'sel'], true],
              ['==', ['get', 'status'], 'closed'],
            ]}
            layout={{
              'icon-image': [
                'case',
                // Estructural lo decide el backend por mayoría de
                // prensa; sin el flag (API antigua) cae a la causa
                [
                  'any',
                  ['==', ['get', 'alert_structural'], true],
                  [
                    'all',
                    ['!', ['has', 'alert_structural']],
                    [
                      'in',
                      ['get', 'alert_cause'],
                      ['literal', [...STRUCTURAL_CAUSES]],
                    ],
                  ],
                ],
                'pin-structural',
                // Causas con pin propio: el badge del pin ilustra
                // por que cerro (algas / medusas / gasoil)
                [
                  'match',
                  ['get', 'alert_cause'],
                  'Algas',
                  'pin-algas',
                  'Medusas',
                  'pin-medusas',
                  'Hidrocarburos',
                  'pin-gasoil',
                  'pin-closed',
                ],
              ],
              'icon-size': [
                'interpolate',
                ['linear'],
                ['zoom'],
                9,
                0.17 * (146 / 96),
                13,
                0.29 * (146 / 96),
                16,
                0.34 * (146 / 96),
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
            filter={[
              'all',
              ['==', ['get', 'sel'], true],
              ['!=', ['get', 'status'], 'closed'],
            ]}
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
          <Layer
            id="beach-pin-selected-closed"
            type="symbol"
            filter={[
              'all',
              ['==', ['get', 'sel'], true],
              ['==', ['get', 'status'], 'closed'],
            ]}
            layout={{
              'icon-image': [
                'case',
                [
                  'any',
                  ['==', ['get', 'alert_structural'], true],
                  [
                    'all',
                    ['!', ['has', 'alert_structural']],
                    [
                      'in',
                      ['get', 'alert_cause'],
                      ['literal', [...STRUCTURAL_CAUSES]],
                    ],
                  ],
                ],
                'pin-structural',
                [
                  'match',
                  ['get', 'alert_cause'],
                  'Algas',
                  'pin-algas',
                  'Medusas',
                  'pin-medusas',
                  'Hidrocarburos',
                  'pin-gasoil',
                  'pin-closed',
                ],
              ],
              // Menos que el normal: el pin con badge es alto y con
              // la ficha abierta quedaba comido entre banner y sheet
              'icon-size': 0.3 * (146 / 96),
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
              'text-halo-color': colors.surface,
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
                // Granate = estructural, igual que el pin y el banner
                [
                  'all',
                  ['==', ['get', 'status'], 'closed'],
                  [
                    'any',
                    ['==', ['get', 'alert_structural'], true],
                    [
                      'all',
                      ['!', ['has', 'alert_structural']],
                      [
                        'in',
                        ['get', 'alert_cause'],
                        ['literal', [...STRUCTURAL_CAUSES]],
                      ],
                    ],
                  ],
                ],
                BEACH_COLORS.structural,
                // Añil = fauna marina, igual que el pin y el banner
                [
                  'all',
                  ['==', ['get', 'status'], 'closed'],
                  [
                    'in',
                    ['get', 'alert_cause'],
                    ['literal', [...FAUNA_CAUSES]],
                  ],
                ],
                BEACH_COLORS.fauna,
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
              'circle-stroke-color': colors.surface,
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
              'text-halo-color': colors.surface,
              'text-halo-width': 2,
            }}
          />
        </GeoJSONSource>
      )}
    </>
  );
}

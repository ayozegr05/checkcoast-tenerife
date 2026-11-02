import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { MunicipalityIncident } from '../../lib/api';
import { episodeDays } from '../../lib/episodes';
import { displayBeachName, displayCause, formatDays } from '../../lib/format';
import { fmtDate } from '../../lib/muniStats';
import { FAUNA_CAUSES, STRUCTURAL_CAUSES } from '../../lib/structural';
import { zoneName } from '../../lib/zones';
import { thumbUrl } from '../SatelliteShot';
import { styles } from './statsStyles';

// Fila de episodio de las vistas cronológicas (Verano y Año): miniatura
// satélite de la playa + badge de estado + municipio, fechas y causa.
// Cada fila es una playa distinta — la foto la identifica de un vistazo,
// como en la lista de Playas
export default function EpisodeRow({
  ep,
  coords = null,
  onPress,
}: {
  ep: MunicipalityIncident;
  // Centro de la playa (lon/lat) para la miniatura Esri — null si la
  // playa no está en el conjunto cargado
  coords?: [number, number] | null;
  onPress: () => void;
}) {
  const open = ep.closed_at === null;
  // En complejos multipunto la fila es de UNA cala: el nombre común
  // ("Punta Brava" para Jardín PM4) la identifica — sin mapa de zona
  // cae al token ("PM4"); playa de un PM → sin sufijo
  const zone = ep.zone_tag
    ? (zoneName(ep.beach_name, ep.zone_tag) ?? ep.zone_tag)
    : null;
  const name = displayBeachName(ep.beach_name) + (zone ? ` · ${zone}` : '');
  // Mismo lenguaje de color que el pin del mapa: granate = cierre
  // estructural (desprendimientos/obras/colapso — crónico, no
  // urgente), añil = fauna marina; el rojo queda para contaminación
  const badgeTone = STRUCTURAL_CAUSES.has(ep.cause ?? '')
    ? styles.badgeStructural
    : FAUNA_CAUSES.has(ep.cause ?? '')
      ? styles.badgeFauna
      : styles.badgeClosed;
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressFx]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Ver ficha de ${name}`}
    >
      <View style={styles.epMain}>
        {coords && (
          <Image
            source={{ uri: thumbUrl(coords, 160, 0.5) }}
            style={styles.epThumb}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        )}
        <View style={styles.epBody}>
          <View style={styles.rowHeader}>
            <Text style={styles.rowName} numberOfLines={1}>
              {name}
            </Text>
            {/* Badge solo en lo que exige atención: un episodio cerrado
                no es "bueno", solo es pasado — las fechas ya lo cuentan */}
            {open && (
              <Text
                style={[
                  styles.badge,
                  styles.badgeTail,
                  ep.kind === 'closure' ? badgeTone : styles.badgeWarning,
                ]}
              >
                {ep.kind === 'closure' ? 'Sigue cerrada' : 'Aviso activo'}
              </Text>
            )}
          </View>
          <Text style={styles.rowSub}>
            {ep.municipality ?? 'Sin municipio'} ·{' '}
            {open
              ? `desde el ${fmtDate(ep.opened_at)}`
              : `${fmtDate(ep.opened_at)} → ${fmtDate(
                  ep.closed_at as string,
                )} · ${formatDays(episodeDays(ep))}`}
            {ep.cause ? ` · ${displayCause(ep.cause)}` : ''}
            {ep.via === 'press' ? ' · según prensa' : ''}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

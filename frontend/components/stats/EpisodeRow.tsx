import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { MunicipalityIncident } from '../../lib/api';
import { episodeDays } from '../../lib/episodes';
import {
  displayBeachName,
  displayCause,
  fmtSpan,
  formatDays,
  staleNewsNote,
} from '../../lib/format';
import { FAUNA_CAUSES, STRUCTURAL_CAUSES } from '../../lib/structural';
import { zoneLabel } from '../../lib/zones';
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
  const beach = displayBeachName(ep.beach_name);
  // En complejos multipunto la fila es de UNA cala: va al principio
  // de la línea de datos ("Punta Brava · Puerto de la Cruz · …") —
  // un nombre oficial largo que se trunque nunca se come la zona, que
  // es lo que distingue una fila de su hermana
  const zone = ep.zone_tag ? zoneLabel(ep.beach_name, ep.zone_tag) : null;
  // Mismo lenguaje de color que el pin del mapa: granate = cierre
  // estructural (desprendimientos/obras/colapso — crónico, no
  // urgente), añil = fauna marina; el rojo queda para contaminación
  const badgeTone = STRUCTURAL_CAUSES.has(ep.cause ?? '')
    ? styles.badgeStructural
    : FAUNA_CAUSES.has(ep.cause ?? '')
      ? styles.badgeFauna
      : styles.badgeClosed;
  // La cabecera de mes ya dice el año del inicio: el rango no lo
  // repite salvo que cruce de año ("3 sep → 9 oct · 37 días")
  const span = fmtSpan(
    ep.opened_at,
    ep.closed_at,
    Number(ep.opened_at.slice(0, 4)),
  );
  const stale = staleNewsNote(ep.closed_at, ep.last_news_at);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressFx]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Ver ficha de ${beach}${zone ? ` · ${zone}` : ''}`}
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
            {/* Hasta dos líneas: los nombres oficiales largos ("Playa
                del Cabezo-Paseo de las Palmeras") caben enteros */}
            <Text style={styles.rowName} numberOfLines={2}>
              {beach}
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
                {ep.kind === 'closure' ? 'Cierre vigente' : 'Aviso vigente'}
              </Text>
            )}
          </View>
          <Text style={styles.rowSub}>
            {zone ? `${zone} · ` : ''}
            {ep.municipality ?? 'Sin municipio'} · {span}
            {open ? '' : ` · ${formatDays(episodeDays(ep))}`}
            {ep.cause ? ` · ${displayCause(ep.cause)}` : ''}
            {ep.via === 'press' ? ' · según prensa' : ''}
            {stale ? ` · ${stale}` : ''}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

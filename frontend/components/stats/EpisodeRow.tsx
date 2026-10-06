import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { MunicipalityIncident } from '../../lib/api';
import { episodeDays } from '../../lib/episodes';
import { displayBeachName, formatDays } from '../../lib/format';
import { fmtDate } from '../../lib/muniStats';
import { styles } from './statsStyles';

// Fila de episodio de las vistas cronológicas (Temporada y "Este año"):
// playa + badge de estado + municipio, fechas y causa
export default function EpisodeRow({
  ep,
  onPress,
}: {
  ep: MunicipalityIncident;
  onPress: () => void;
}) {
  const open = ep.closed_at === null;
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressFx]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Ver ficha de ${displayBeachName(ep.beach_name)}`}
    >
      <View style={styles.rowHeader}>
        <Text style={styles.rowName} numberOfLines={1}>
          {displayBeachName(ep.beach_name)}
        </Text>
        <Text
          style={[
            styles.badge,
            open
              ? ep.kind === 'closure'
                ? styles.badgeClosed
                : styles.badgeWarning
              : styles.badgeOpen,
          ]}
        >
          {open
            ? ep.kind === 'closure'
              ? 'Sigue cerrada'
              : 'Aviso activo'
            : ep.kind === 'closure'
              ? 'Cierre resuelto'
              : 'Aviso resuelto'}
        </Text>
      </View>
      <Text style={styles.rowSub}>
        {ep.municipality ?? 'Sin municipio'} ·{' '}
        {open
          ? `desde el ${fmtDate(ep.opened_at)}`
          : `${fmtDate(ep.opened_at)} → ${fmtDate(
              ep.closed_at as string,
            )} · ${formatDays(episodeDays(ep))}`}
        {ep.cause
          ? ` · ${ep.cause.charAt(0).toLowerCase()}${ep.cause.slice(1)}`
          : ''}
        {ep.via === 'press' ? ' · según prensa' : ''}
      </Text>
    </Pressable>
  );
}

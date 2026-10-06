import React from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  MuniStats,
  barColorOf,
  rankColorOf,
  scoreOf,
  yearBarColorOf,
  yearScoreOf,
} from '../../lib/muniStats';
import { styles } from './statsStyles';

// Fila del ranking de municipios: círculo de posición (podio con color
// de severidad), nombre, nº de playas, barra de afectación y badges.
// En modo-año muestra los episodios DE ESE AÑO en vez del vivo+histórico
export default function MuniRow({
  m,
  index,
  total,
  isYearMode,
  selYear,
  yearCause,
  causeCount,
  maxScore,
  onPress,
}: {
  m: MuniStats;
  index: number;
  total: number;
  isYearMode: boolean;
  selYear: number;
  yearCause: string;
  // Cierres de la causa activa en este municipio (0 si yearCause='all')
  causeCount: number;
  maxScore: number;
  onPress: () => void;
}) {
  const score = isYearMode ? yearScoreOf(m) : scoreOf(m);
  const barColor = isYearMode ? yearBarColorOf(m) : barColorOf(m);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressFx]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${m.name}, posición ${index + 1} de ${total}, ${
        m.beaches
      } playas, ${
        isYearMode
          ? `${m.yearClosures} cierres y ${m.yearWarnings} avisos en ${selYear}`
          : `${m.incidents} incidentes`
      }`}
      accessibilityHint="Ver línea temporal de incidentes"
    >
      <View style={styles.rowHeader}>
        <View
          style={[
            styles.rank,
            index < 3 && styles.rankPodium,
            {
              backgroundColor: isYearMode
                ? index < 3
                  ? yearBarColorOf(m)
                  : '#8fa3ad'
                : rankColorOf(m, index),
            },
          ]}
        >
          <Text style={styles.rankText}>{index + 1}</Text>
        </View>
        <Text style={styles.rowName}>{m.name}</Text>
        <Text style={styles.rowBeaches}>
          {m.beaches} {m.beaches === 1 ? 'playa' : 'playas'}
          {m.points > m.beaches ? ` · ${m.points} zonas` : ''}
        </Text>
      </View>
      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            {
              width: `${(score / maxScore) * 100}%`,
              backgroundColor: barColor,
            },
          ]}
        />
      </View>
      <View style={styles.rowStats}>
        {isYearMode ? (
          <>
            {(m.yearClosures ?? 0) > 0 && (
              <Text style={[styles.badge, styles.badgeClosed]}>
                {m.yearClosures} {m.yearClosures === 1 ? 'cierre' : 'cierres'}
              </Text>
            )}
            {(m.yearWarnings ?? 0) > 0 && (
              <Text style={[styles.badge, styles.badgeWarning]}>
                {m.yearWarnings} {m.yearWarnings === 1 ? 'aviso' : 'avisos'}
              </Text>
            )}
            {(m.yearActive ?? 0) > 0 && (
              <Text style={[styles.badge, styles.badgeEnded]}>
                {m.yearActive}{' '}
                {m.yearActive === 1 ? 'sigue abierta' : 'siguen abiertas'}
              </Text>
            )}
          </>
        ) : (
          <>
            {m.closedNow > 0 && (
              <Text style={[styles.badge, styles.badgeClosed]}>
                {m.closedNow} {m.closedNow === 1 ? 'cerrada' : 'cerradas'} ahora
              </Text>
            )}
            {m.warningNow > 0 && (
              <Text style={[styles.badge, styles.badgeWarning]}>
                {m.warningNow} {m.warningNow === 1 ? 'aviso' : 'avisos'} activo
                {m.warningNow === 1 ? '' : 's'}
              </Text>
            )}
          </>
        )}
        {yearCause !== 'all' && (
          <Text style={[styles.badge, styles.badgeEnded]}>
            {causeCount}{' '}
            {yearCause === 'sin causa' ? 'sin causa' : yearCause.toLowerCase()}
          </Text>
        )}
      </View>
      <Text style={styles.rowSub} numberOfLines={isYearMode ? 2 : 1}>
        {isYearMode
          ? `Afectadas: ${(m.yearBeaches ?? []).join(' · ')}`
          : `${m.incidents} ${
              m.incidents === 1 ? 'incidente' : 'incidentes'
            } (${m.closuresLastYear} últ. año) · ${m.badSamples} ${
              m.badSamples === 1 ? 'muestra' : 'muestras'
            } no apta${m.badSamples === 1 ? '' : 's'}`}
      </Text>
    </Pressable>
  );
}

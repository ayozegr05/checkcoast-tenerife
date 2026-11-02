import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { displayCause } from '../../lib/format';
import { muniMapImage } from '../../lib/muniMap';
import {
  MuniStats,
  barColorOf,
  scoreOf,
  yearBarColorOf,
  yearScoreOf,
} from '../../lib/muniStats';
import { styles } from './statsStyles';

// Fila del ranking de municipios: nombre, nº de playas, barra de
// afectación y badges — el orden ES el ranking (la posición vive en
// el a11y label, no en un círculo de chrome). En modo-episodio
// (año seleccionado o histórico) muestra los episodios DEL ÁMBITO;
// el modo vivo queda para un ranking sin periodo
export default function MuniRow({
  m,
  index,
  total,
  isYearMode,
  histMode = false,
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
  // Ámbito total: los badges cubren todo el registro, no el año
  histMode?: boolean;
  selYear: number;
  yearCause: string;
  // Cierres de la causa activa en este municipio (0 si yearCause='all')
  causeCount: number;
  maxScore: number;
  onPress: () => void;
}) {
  const score = isYearMode ? yearScoreOf(m) : scoreOf(m);
  const barColor = isYearMode ? yearBarColorOf(m) : barColorOf(m);
  // La barra mide algo que se puede contar: fracción de playas del
  // municipio tocadas en el ámbito — no un score abstracto. En el
  // modo vivo (ranking sin periodo) queda el score relativo
  const affected = m.yearBeaches?.length ?? 0;
  const beachWord = m.beaches === 1 ? 'playa' : 'playas';
  const barRatio = isYearMode
    ? Math.min(1, affected / Math.max(1, m.beaches))
    : score / maxScore;
  const shape = muniMapImage(m.municipality ?? m.name);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressFx]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${m.name}, posición ${index + 1} de ${total}, ${
        isYearMode
          ? `${affected} de ${m.beaches} ${beachWord} afectadas, ` +
            `${m.yearClosures} cierres y ${m.yearWarnings} avisos ${
              histMode ? 'en el histórico' : `en ${selYear}`
            }`
          : `${m.beaches} playas, ${m.incidents} incidentes`
      }`}
      accessibilityHint="Ver línea temporal de incidentes"
    >
      <View style={styles.rowBody}>
        {shape ? (
          <Image
            source={shape}
            style={styles.rowShape}
            resizeMode="contain"
            accessibilityElementsHidden
          />
        ) : (
          // «Sin municipio» no tiene silueta — el hueco mantiene
          // alineado el texto con el resto de filas
          <View style={styles.rowShape} />
        )}
        <View style={styles.rowContent}>
          <View style={styles.rowHeader}>
            <Text style={styles.rowName}>{m.name}</Text>
            {!isYearMode && (
              <Text style={styles.rowBeaches}>
                {m.beaches} {beachWord}
                {m.points > m.beaches ? ` · ${m.points} zonas` : ''}
              </Text>
            )}
          </View>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${barRatio * 100}%`,
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
                    {m.yearClosures}{' '}
                    {m.yearClosures === 1 ? 'cierre' : 'cierres'}
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
                    {m.closedNow} {m.closedNow === 1 ? 'cerrada' : 'cerradas'}{' '}
                    ahora
                  </Text>
                )}
                {m.warningNow > 0 && (
                  <Text style={[styles.badge, styles.badgeWarning]}>
                    {m.warningNow} {m.warningNow === 1 ? 'aviso' : 'avisos'}{' '}
                    activo
                    {m.warningNow === 1 ? '' : 's'}
                  </Text>
                )}
              </>
            )}
            {yearCause !== 'all' && (
              <Text style={[styles.badge, styles.badgeEnded]}>
                {causeCount}{' '}
                {yearCause === 'sin causa'
                  ? 'sin causa'
                  : displayCause(yearCause)}
              </Text>
            )}
          </View>
        </View>
      </View>
      {/* Las líneas de detalle van a ancho completo bajo la isla —
          el hueco que dejaba la miniatura se aprovecha y los nombres
          ganan ~60px de ancho */}
      {isYearMode ? (
        <>
          {/* Fracción en su propia línea — el corte es siempre
              limpio y el dato clave queda escaneable; los nombres
              cuelgan debajo */}
          <Text style={styles.rowSubStrong}>
            {affected} de {m.beaches} {beachWord} afectada
            {affected === 1 ? '' : 's'}
          </Text>
          <Text style={styles.rowSubNames} numberOfLines={2}>
            {(m.yearBeaches ?? []).join(' · ')}
            {histMode && m.badSamples > 0
              ? `\n${m.badSamples} muestra${
                  m.badSamples === 1 ? '' : 's'
                } no apta${m.badSamples === 1 ? '' : 's'}`
              : ''}
          </Text>
        </>
      ) : (
        <Text style={styles.rowSub} numberOfLines={1}>
          {`${m.incidents} ${
            m.incidents === 1 ? 'incidente' : 'incidentes'
          } (${m.closuresLastYear} últ. año) · ${m.badSamples} ${
            m.badSamples === 1 ? 'muestra' : 'muestras'
          } no apta${m.badSamples === 1 ? '' : 's'}`}
        </Text>
      )}
    </Pressable>
  );
}

import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { thumbUrl } from '../SatelliteShot';
import { BeachStats, GeoFeature } from '../../lib/api';
import { pointLongLabel, displayBeachName } from '../../lib/format';
import { colors, fonts } from '../../lib/theme';
import {
  BeachGroup,
  SortMode,
  evalShort,
  statusOf,
  worstEvalOf,
  worstStatusOf,
} from '../../lib/beachGroups';
import { PM_SUFFIX } from '../../lib/pm';
import { BEACH_STATE_LABEL } from '../../lib/structural';

const STATUS_LABELS = BEACH_STATE_LABEL;
const STATUS_COLORS = colors.status;

const displayName = (name: string) =>
  displayBeachName(name.replace(PM_SUFFIX, ''));

// Evaluación oficial de la última muestra, resumida para la sub-fila
const evalLabel = (evaluation: string | null) => {
  if (!evaluation) return null;
  if (/prohib/i.test(evaluation)) return 'Prohibido';
  if (/pendiente|valoraci/i.test(evaluation)) return 'Pendiente';
  if (/calificar/i.test(evaluation)) return 'Sin calificar';
  if (/apta/i.test(evaluation)) return 'Apta';
  if (/recomend/i.test(evaluation)) return 'Recomendación';
  // Nunca mostrar el texto administrativo crudo de Náyade
  return null;
};

const fmtShort = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};

// Fila de la lista de playas: cabecera del grupo (nombre, municipio,
// totales deduplicados, badge de estado) + sub-filas de cada PM al
// expandir. Una playa simple abre la ficha directo; un complejo
// multi-PM despliega sus zonas.
export default function BeachRow({
  group: g,
  expanded,
  stats,
  sortMode,
  onToggle,
  onOpenDetail,
}: {
  group: BeachGroup;
  expanded: boolean;
  stats: Map<number, BeachStats>;
  sortMode: SortMode;
  onToggle: () => void;
  onOpenDetail: (f: GeoFeature) => void;
}) {
  const status = worstStatusOf(g);
  const statSum = (
    k:
      | 'closures'
      | 'warnings'
      | 'closures_last_year'
      | 'bad_samples'
      | 'reconstructed',
  ) => g.members.reduce((s, m) => s + (stats.get(m.id)?.[k] ?? 0), 0);
  // Cabecera del grupo: totales DEDUPLICADOS por playa física — un
  // cierre de prensa replicado en los 3 PMs cuenta una vez (Jardín:
  // 5 eventos reales, no 11)
  const closures = statSum('closures') + statSum('reconstructed');
  const warnings = statSum('warnings');
  const badSamples = statSum('bad_samples');

  return (
    <View style={styles.row}>
      <Pressable
        style={({ pressed }) => [styles.rowMain, pressed && styles.pressFx]}
        onPress={() =>
          g.members.length === 1 ? onOpenDetail(g.members[0]) : onToggle()
        }
        accessibilityRole="button"
        accessibilityLabel={`${displayName(g.name)}, ${
          g.municipality ?? 'sin municipio'
        }, ${STATUS_LABELS[status]}${
          g.members.length > 1 ? `, ${g.members.length} puntos de muestreo` : ''
        }`}
        accessibilityHint={
          g.members.length > 1
            ? 'Toca para ver los puntos de muestreo'
            : 'Toca para abrir la ficha'
        }
        accessibilityState={g.members.length > 1 ? { expanded } : undefined}
      >
        {/* Miniatura satélite del arenal: reconocer la playa de un
            vistazo en la lista — la misma foto Esri que la ficha
            (máximo zoom legible). En grupos multipunto se usa el
            primer PM */}
        <Image
          source={{
            uri: thumbUrl(
              g.members[0].geometry.coordinates as [number, number],
              160,
              0.5,
            ),
          }}
          style={styles.rowThumb}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <View style={styles.rowText}>
          <Text style={styles.rowName}>{displayName(g.name)}</Text>
          <Text style={styles.rowSub}>
            {g.municipality ?? 'Sin municipio'}
            {g.members.length > 1 ? ` · ${g.members.length} zonas` : ''}
            {[
              closures > 0
                ? `${closures} ${closures === 1 ? 'cierre' : 'cierres'}`
                : null,
              warnings > 0
                ? `${warnings} ${warnings === 1 ? 'aviso' : 'avisos'}`
                : null,
            ]
              .filter(Boolean)
              .map((s) => ` · ${s}`)}
            {sortMode === 'calidad' && worstEvalOf(g, stats) != null
              ? ` · última: ${evalShort(worstEvalOf(g, stats))}`
              : ''}
            {badSamples > 0 ? ` · ${badSamples} muestras no aptas` : ''}
          </Text>
        </View>
        <View
          style={[styles.badge, { backgroundColor: STATUS_COLORS[status] }]}
        >
          <Text style={styles.badgeText}>{STATUS_LABELS[status]}</Text>
        </View>
      </Pressable>
      {expanded &&
        g.members.map((f) => {
          const fStatus = statusOf(f);
          const st = stats.get(f.id);
          const ev = evalLabel(st?.latest_evaluation ?? null);
          const pmSub = [
            st?.latest_sampled_at ? fmtShort(st.latest_sampled_at) : null,
            ev,
            // Conteo canónico del punto: los mismos episodios por cala
            // que la fila general e Incidencias — la prensa genérica
            // replicada a todos los PM no infla cada zona (agua no
            // apta va aparte: nunca es cierre)
            st &&
            (st.closures ?? 0) +
              (st.reconstructed ?? 0) +
              (st.warnings ?? 0) +
              (st.lab_episodes ?? 0) >
              0
              ? [
                  (st.closures ?? 0) + (st.reconstructed ?? 0) > 0
                    ? `${(st.closures ?? 0) + (st.reconstructed ?? 0)} ${
                        (st.closures ?? 0) + (st.reconstructed ?? 0) === 1
                          ? 'cierre'
                          : 'cierres'
                      }`
                    : null,
                  (st.warnings ?? 0) > 0
                    ? `${st.warnings} ${st.warnings === 1 ? 'aviso' : 'avisos'}`
                    : null,
                  (st.lab_episodes ?? 0) > 0
                    ? `${st.lab_episodes} muestra${
                        st.lab_episodes === 1 ? ' no apta' : 's no aptas'
                      }`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <Pressable
              key={f.id}
              style={({ pressed }) => [styles.pmRow, pressed && styles.pressFx]}
              onPress={() => onOpenDetail(f)}
              accessibilityRole="button"
              accessibilityLabel={`${
                pointLongLabel(f.properties.name) ??
                displayName(f.properties.name)
              }, ${STATUS_LABELS[fStatus]}`}
              accessibilityHint="Abrir ficha del punto de muestreo"
            >
              {/* Miniatura del punto concreto: cada PM tiene su
                  coordenada — en zonas separadas (Jardín) se ve que
                  NO son la misma cala */}
              <Image
                source={{
                  uri: thumbUrl(
                    f.geometry.coordinates as [number, number],
                    80,
                    0.5,
                  ),
                }}
                style={styles.pmThumb}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <View style={styles.pmText}>
                <Text style={styles.pmName}>
                  {pointLongLabel(f.properties.name) ??
                    displayName(f.properties.name)}
                </Text>
                {pmSub ? <Text style={styles.pmSub}>{pmSub}</Text> : null}
              </View>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: STATUS_COLORS[fStatus] },
                ]}
              >
                <Text style={styles.badgeText}>{STATUS_LABELS[fStatus]}</Text>
              </View>
            </Pressable>
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Feedback táctil común: leve fundido al presionar
  pressFx: {
    opacity: 0.6,
  },
  row: {
    backgroundColor: colors.surface,
    marginHorizontal: 12,
    marginBottom: 6,
    borderRadius: 10,
    elevation: 1,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  pmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingLeft: 24,
    paddingRight: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  pmText: {
    flex: 1,
  },
  pmName: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
  },
  pmSub: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 1,
  },
  // Miniatura Esri del arenal: cuadrada, tamaño de fila — vende la
  // playa mejor que el nombre (misma fuente que la ficha)
  rowThumb: {
    width: 52,
    height: 52,
    borderRadius: 8,
    marginRight: 10,
    backgroundColor: colors.border,
  },
  // Versión reducida para las sub-filas de PM (jerarquía: el grupo
  // pesa más que sus puntos)
  pmThumb: {
    width: 40,
    height: 40,
    borderRadius: 7,
    marginRight: 10,
    backgroundColor: colors.border,
  },
  rowText: {
    flex: 1,
  },
  rowName: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  rowSub: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 2,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 8,
  },
  badgeText: {
    color: colors.onColor,
    fontSize: 11,
    fontFamily: fonts.bold,
  },
});

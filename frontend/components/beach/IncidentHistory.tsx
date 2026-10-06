import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { BeachIncident } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import {
  closuresInYears,
  isClosure,
  isUnclassified,
} from '../../lib/incidents';
import { groupNewsItems } from '../../lib/news';
import { colors, fonts } from '../../lib/theme';
import NewsGroupList from './NewsGroupList';

type IncidentHistoryProps = {
  incidents: BeachIncident[];
  // Filas con los titulares desplegados (varias a la vez)
  openIncs: ReadonlySet<number>;
  onToggleIncident: (id: number) => void;
};

// Historial de incidencias oficiales + episodios reconstruidos
export default function IncidentHistory({
  incidents,
  openIncs,
  onToggleIncident,
}: IncidentHistoryProps) {
  return (
    <View style={styles.history}>
      <Text style={styles.historyTitle}>
        Historial de incidencias ({incidents.length})
      </Text>
      <Text style={styles.incidentObs}>
        {incidents.filter(isClosure).length} cierres ·{' '}
        {incidents.filter((i) => !isClosure(i) && !isUnclassified(i)).length}{' '}
        avisos
        {incidents.some(isUnclassified)
          ? ` · ${incidents.filter(isUnclassified).length} muestra${
              incidents.filter(isUnclassified).length === 1 ? '' : 's'
            } sin calificar`
          : ''}
        {'\n'}
        Cerrada {closuresInYears(incidents, 1)} vez
        {closuresInYears(incidents, 1) === 1 ? '' : 'es'} el último año ·{' '}
        {closuresInYears(incidents, 5)} en los últimos 5 años
      </Text>
      {/* Sin scroll interno: la sección crece con su contenido y
              scrollea la ficha entera — un cajón fijo dejaba los
              titulares expandidos en una ventana diminuta */}
      <View>
        {incidents.map((inc) => {
          const closure = isClosure(inc);
          const unclassified = isUnclassified(inc);
          // Duración del episodio: hasta closed_at o hasta hoy
          const days = Math.max(
            1,
            Math.round(
              (Date.parse(
                inc.closed_at ?? new Date().toISOString().slice(0, 10),
              ) -
                Date.parse(inc.opened_at)) /
                86400000,
            ),
          );
          const accent = closure
            ? colors.status.closed
            : colors.outfall.unknown;
          // Analítica con respaldo de prensa = cierre real, mismo
          // cartel que el oficial; la procedencia va abajo en gris
          const tag =
            inc.via === 'press'
              ? 'SEGÚN PRENSA'
              : inc.via === 'measurement' && !inc.press_confirmed
                ? 'SEGÚN ANALÍTICA'
                : inc.closed_at
                  ? closure
                    ? 'CIERRE'
                    : 'AVISO'
                  : unclassified
                    ? 'PENDIENTE'
                    : 'ACTIVA';
          return (
            <View
              key={inc.id}
              style={[styles.incident, { borderLeftColor: accent }]}
            >
              <View style={styles.incidentHead}>
                <Text style={styles.incidentDates}>
                  {inc.end_estimated
                    ? // Fin estimado (última mención): no se
                      // muestra — solo el día del cierre
                      fmtDate(inc.opened_at)
                    : `${fmtDate(inc.opened_at)} → ${
                        inc.closed_at ? fmtDate(inc.closed_at) : 'hoy'
                      } · ${days} ${days === 1 ? 'día' : 'días'}`}
                </Text>
                <View style={[styles.incidentTag, { backgroundColor: accent }]}>
                  <Text style={styles.incidentTagText}>{tag}</Text>
                </View>
              </View>
              {inc.observations ? (
                <Text style={styles.incidentObs}>
                  {unclassified
                    ? 'Muestra tomada pero nunca clasificada por Sanidad'
                    : inc.observations}
                </Text>
              ) : null}
              {/* Evidencia del episodio: titulares que lo
                      sustentan (prensa) o lo corroboraron (oficial) */}
              {(inc.press_items?.length ?? 0) > 0 && (
                <>
                  <Pressable
                    onPress={() => onToggleIncident(inc.id)}
                    hitSlop={8}
                    style={({ pressed }) => pressed && styles.pressFx}
                    accessibilityRole="button"
                    accessibilityLabel={
                      openIncs.has(inc.id)
                        ? 'Ocultar titulares del episodio'
                        : `Ver ${inc.press_items!.length} titulares del episodio`
                    }
                  >
                    <Text style={styles.newsToggle}>
                      {openIncs.has(inc.id)
                        ? 'Ocultar titulares ▴'
                        : `Ver titulares (${inc.press_items!.length}) ▾`}
                    </Text>
                  </Pressable>
                  {/* Agrupados por fase del episodio: las
                          noticias de cierre y las de reapertura son
                          evidencias distintas del mismo suceso */}
                  {openIncs.has(inc.id) && (
                    <NewsGroupList groups={groupNewsItems(inc.press_items!)} />
                  )}
                </>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Feedback táctil común: leve fundido al presionar
  pressFx: {
    opacity: 0.6,
  },
  history: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  historyTitle: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: colors.text,
    marginBottom: 4,
  },
  incident: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 4,
    marginBottom: 8,
    backgroundColor: colors.background,
    borderRadius: 4,
  },
  incidentHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 4,
  },
  incidentTag: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  incidentTagText: {
    color: '#fff',
    fontSize: 9,
    fontFamily: fonts.extrabold,
  },
  incidentDates: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
  },
  incidentObs: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  newsToggle: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.status.warning,
    marginBottom: 4,
  },
});

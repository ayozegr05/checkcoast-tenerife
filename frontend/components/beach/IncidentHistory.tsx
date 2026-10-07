import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { BeachIncident } from '../../lib/api';
import { fmtDate, formatDays } from '../../lib/format';
import {
  episodesInYears,
  episodesThisYear,
  isClosure,
  isUnclassified,
} from '../../lib/incidents';
import { groupNewsItems } from '../../lib/news';
import { colors, fonts } from '../../lib/theme';
import { siblingZoneRef } from '../../lib/zones';
import NewsGroupList from './NewsGroupList';

type IncidentHistoryProps = {
  incidents: BeachIncident[];
  // Filas con los titulares desplegados (varias a la vez)
  openIncs: ReadonlySet<number>;
  onToggleIncident: (id: number) => void;
  // Nombre de la playa de esta ficha — resuelve el nombre común de
  // la cala hermana ("la cala Punta Brava") en complejos mapeados
  beachName?: string;
};

// Historial de incidencias oficiales + episodios reconstruidos:
// resumen de cifras + lista agrupada por año, con los episodios de
// zonas hermanas (attributed_pm) apartados al final de cada año
export default function IncidentHistory({
  incidents,
  openIncs,
  onToggleIncident,
  beachName = '',
}: IncidentHistoryProps) {
  const renderInc = (inc: BeachIncident) => {
    const closure = isClosure(inc);
    const unclassified = isUnclassified(inc);
    // Duración del episodio: hasta closed_at o hasta hoy
    const days = Math.max(
      1,
      Math.round(
        (Date.parse(inc.closed_at ?? new Date().toISOString().slice(0, 10)) -
          Date.parse(inc.opened_at)) /
          86400000,
      ),
    );
    const accent = closure ? colors.status.closed : colors.outfall.unknown;
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
      <View key={inc.id} style={[styles.incident, { borderLeftColor: accent }]}>
        <View style={styles.incidentHead}>
          <Text style={styles.incidentDates}>
            {inc.end_estimated
              ? // Fin estimado (última mención): no se
                // muestra — solo el día del cierre
                fmtDate(inc.opened_at)
              : `${fmtDate(inc.opened_at)} → ${
                  inc.closed_at ? fmtDate(inc.closed_at) : 'hoy'
                } · ${formatDays(days)}`}
          </Text>
          <View style={[styles.incidentTag, { backgroundColor: accent }]}>
            <Text style={styles.incidentTagText}>{tag}</Text>
          </View>
        </View>
        {inc.attributed_pm ? (
          <Text style={styles.incidentObs}>
            {`Ocurrió en la ${siblingZoneRef(beachName, inc.attributed_pm)}`}
          </Text>
        ) : null}
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
  };

  const own = incidents.filter((i) => !i.attributed_pm);
  const totalC = own.filter(isClosure).length;
  const totalW = own.filter((i) => !isClosure(i) && !isUnclassified(i)).length;
  const uncl = incidents.filter(isUnclassified).length;
  const y1 = episodesThisYear(incidents);
  const y5 = episodesInYears(incidents, 5);
  const parts = (c: number, w: number) =>
    [
      c ? `${c} cierre${c === 1 ? '' : 's'}` : null,
      w ? `${w} aviso${w === 1 ? '' : 's'}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  const y1parts = parts(y1.closures, y1.warnings);
  const y5parts = parts(y5.closures, y5.warnings);
  // Todo el historial cabe en 5 años → el total y el "5 años"
  // son el mismo número: una sola frase, sin repetir datos
  const allIn5 = totalC === y5.closures && totalW === y5.warnings;

  // Agrupado por año; dentro de cada año, los episodios de
  // la zona hermana (attributed_pm) van al final con su
  // propio rótulo — no son cierres de este punto
  const years = [...new Set(incidents.map((i) => i.opened_at.slice(0, 4)))];

  return (
    <View style={styles.history}>
      <View style={styles.secHead}>
        <Image
          source={require('../../assets/icons/icon-alert.png')}
          style={[styles.secIcon, { tintColor: colors.status.warning }]}
        />
        <Text style={styles.secCardTitle}>
          Historial de incidencias ({incidents.length})
        </Text>
      </View>
      <View style={styles.historySummary}>
        {allIn5 && y5parts ? (
          <View style={styles.historyStatRow}>
            {y1parts !== y5parts && (
              <Text style={styles.historyStat}>
                <Text style={styles.historySummaryNum}>
                  {y1parts || 'Sin episodios'}
                </Text>
                {' este año'}
              </Text>
            )}
            <Text style={styles.historyStat}>
              <Text style={styles.historySummaryNum}>{y5parts}</Text>
              {y1parts === y5parts ? ' este año' : ' en los últimos 5 años'}
            </Text>
            {uncl > 0 && (
              <Text style={styles.historyStat}>
                <Text style={styles.historySummaryNum}>{uncl}</Text>
                {` sin calificar`}
              </Text>
            )}
          </View>
        ) : (
          <>
            <View style={styles.historyStatRow}>
              <Text style={styles.historyStat}>
                <Text style={styles.historySummaryNum}>{totalC}</Text>
                {` cierre${totalC === 1 ? '' : 's'}`}
              </Text>
              {totalW > 0 && (
                <Text style={styles.historyStat}>
                  <Text style={styles.historySummaryNum}>{totalW}</Text>
                  {` aviso${totalW === 1 ? '' : 's'}`}
                </Text>
              )}
              {uncl > 0 && (
                <Text style={styles.historyStat}>
                  <Text style={styles.historySummaryNum}>{uncl}</Text>
                  {` sin calificar`}
                </Text>
              )}
            </View>
            <Text style={styles.historySummarySub}>
              {`Este año: ${y1parts || 'sin episodios'}  ·  Últimos 5 años: ${y5parts || 'sin episodios'}`}
            </Text>
          </>
        )}
      </View>
      {/* Sin scroll interno: la sección crece con su contenido y
          scrollea la ficha entera — un cajón fijo dejaba los
          titulares expandidos en una ventana diminuta */}
      <View>
        {years.map((y) => {
          const rows = incidents.filter((i) => i.opened_at.startsWith(y));
          const ownRows = rows.filter((i) => !i.attributed_pm);
          const sib = rows.filter((i) => i.attributed_pm);
          return (
            <View key={y}>
              <Text style={styles.historyGroupTitle}>{y}</Text>
              {ownRows.map(renderInc)}
              {sib.length > 0 && (
                <>
                  <Text style={styles.historySubGroupTitle}>
                    En la {siblingZoneRef(beachName, sib[0].attributed_pm!)}
                  </Text>
                  {sib.map(renderInc)}
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
  secHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 7,
    marginBottom: 2,
  },
  secIcon: {
    width: 22,
    height: 22,
    // Alineación óptica: el margen positivo SUBE el icono hasta que
    // su base casa con la línea base del texto del título (la caja
    // de línea tiene ~4px de descender por debajo de los glifos)
    marginBottom: 3,
  },
  secCardTitle: {
    fontSize: 15,
    fontFamily: fonts.extrabold,
    color: colors.primaryDark,
  },
  historySummary: {
    marginTop: 4,
    marginBottom: 8,
  },
  historyStatRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  historyStat: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  historySummaryNum: {
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  historySummarySub: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 2,
  },
  historyGroupTitle: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: colors.textFaint,
    marginTop: 18,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  historySubGroupTitle: {
    fontSize: 10,
    fontFamily: fonts.semibold,
    color: colors.textFaint,
    marginTop: 6,
    marginBottom: 2,
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

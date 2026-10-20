import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { BeachIncident } from '../../lib/api';
import { fmtDate, formatDays } from '../../lib/format';
import {
  episodesInYears,
  episodesThisYear,
  isClosure,
  isMuteLab,
  isUnclassified,
  isUnclassifiedObs,
} from '../../lib/incidents';
import {
  incidentBadgeArts,
  incidentCauses,
  LAB_ART,
  STRUCT_CAUSES,
} from '../../lib/causeArt';
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
  // Acordeón por año: el actual y el anterior abiertos, el resto
  // colapsados — en 15 años de historial la lista no se hace eterna.
  // Con pocos episodios (≤10) todo abierto: el acordeón solo paga
  // cuando hay volumen que esconder
  const [yearOpen, setYearOpen] = useState<Record<string, boolean>>({});
  const collapsible = incidents.length > 10;
  const yearDefault = (y: string) => Number(y) >= new Date().getFullYear() - 1;
  const isYearOpen = (y: string) =>
    !collapsible || (yearOpen[y] ?? yearDefault(y));

  const renderInc = (inc: BeachIncident) => {
    const closure = isClosure(inc);
    // unclassified = nota "Sin calificar" sin evidencia de prensa;
    // con prensa corroborante la fila es el episodio real
    const unclassified = isUnclassified(inc);
    // Analítica prohibida sin corroboración: no es cierre ni aviso
    // — badge propio (tubo + aviso) y color de aviso, nunca rojo
    const muteLab = isMuteLab(inc);
    // Duración del episodio: hasta closed_at o hasta hoy, en días
    // naturales incluyendo el inicial (misma convención que
    // episodeDays/durationDays de las vistas de temporada)
    const days =
      Math.max(
        0,
        Math.round(
          (Date.parse(inc.closed_at ?? new Date().toISOString().slice(0, 10)) -
            Date.parse(inc.opened_at)) /
            86400000,
        ),
      ) + 1;
    // Etiqueta de estado teñida por la causa dominante — como las
    // filas de alertas de la portada (estructural granate, fauna
    // añil, contaminación rojo); debajo las causas del episodio,
    // agregadas de sus titulares. Náyade sin prensa cae en
    // "Contaminación" — solo vigila E. coli/enterococos
    const causes = incidentCauses(inc);
    // La etiqueta solo pinta cuando no es cierre — en cierres
    // hablan los badges de causa
    const stateLabel = unclassified
      ? 'Sin calificar'
      : muteLab
        ? 'Agua no apta'
        : 'Aviso';
    const accent = unclassified
      ? colors.textFaint
      : muteLab
        ? colors.status.lab
        : causes.some((c) => STRUCT_CAUSES.has(c))
          ? colors.status.structural
          : causes.includes('Medusas')
            ? colors.status.fauna
            : closure
              ? colors.status.closed
              : colors.status.warning;
    const causeText = unclassified
      ? // La nota "Sin calificar" no es un cierre — pero si la
        // prensa adjunta sabe el motivo, se muestra igualmente
        causes.join(' · ') || null
      : muteLab
        ? 'Agua no apta'
        : causes.join(' · ') || 'Contaminación';
    // En un cierre la evidencia útil es el ciclo cierre→reapertura:
    // avisos y piezas de contexto ("mala calidad del agua") no
    // cuentan el episodio y ensucian la lista de titulares
    const pressItems = closure
      ? (inc.press_items ?? []).filter(
          (n) => n.event_type === 'closure' || n.event_type === 'reopening',
        )
      : (inc.press_items ?? []);
    return (
      <View key={inc.id} style={[styles.incident, { borderLeftColor: accent }]}>
        {/* Cuerpo: fechas + notas + titulares a la izquierda; el
            badge/etiqueta y la causa centrados verticalmente contra
            toda la fila, como las filas de alertas de la portada */}
        <View style={styles.incidentMain}>
          <Text style={styles.incidentDates}>
            {inc.end_estimated
              ? // Fin desconocido (nadie cubrió la reapertura): se
                // muestra abierto en vez de la última mención —
                // menos ruido y comunica lo mismo
                `${fmtDate(inc.opened_at)} → desconocido`
              : `${fmtDate(inc.opened_at)} → ${
                  inc.closed_at ? fmtDate(inc.closed_at) : 'hoy'
                } · ${formatDays(days)}`}
          </Text>
          {/* Las notas van pegadas al fondo de la columna: quedan a
              la altura de la etiqueta de causa de la derecha (badge
              + texto), no colgando de las fechas — igual que .inotes
              con margin-top:auto en la ficha web */}
          <View style={styles.incidentNotes}>
            {inc.attributed_pm ? (
              <Text style={styles.incidentObs}>
                {`Ocurrió en la ${siblingZoneRef(beachName, inc.attributed_pm)}`}
              </Text>
            ) : null}
            {/* "Sin Calificar" no se repite como nota — la etiqueta
                de la derecha ya lo dice y el detalle no aporta */}
            {inc.observations && !isUnclassifiedObs(inc.observations)
              ? // Una cláusula por línea (como la ficha web): la
                // observación viene en fragmentos unidos por "·" y
                // en bloque quedaba apretada; además el corte limpio
                // en "oficial" deja respirar al badge de la derecha
                inc.observations
                  .split('·')
                  .map((c) => c.trim())
                  .filter(Boolean)
                  .map((c, i) => (
                    <Text key={i} style={styles.incidentObs}>
                      {c.replace(' oficial en Náyade', '\noficial en Náyade')}
                    </Text>
                  ))
              : null}
            {/* Evidencia del episodio: titulares que lo
              sustentan (prensa) o lo corroboraron (oficial) */}
            {pressItems.length > 0 && (
              <>
                <Pressable
                  onPress={() => onToggleIncident(inc.id)}
                  hitSlop={8}
                  style={({ pressed }) => pressed && styles.pressFx}
                  accessibilityRole="button"
                  accessibilityLabel={
                    openIncs.has(inc.id)
                      ? 'Ocultar titulares del episodio'
                      : `Ver ${pressItems.length} titulares del episodio`
                  }
                >
                  <Text style={[styles.newsToggle, { color: accent }]}>
                    {openIncs.has(inc.id)
                      ? 'Ocultar titulares ▴'
                      : `Ver titulares (${pressItems.length}) ▾`}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
        <View style={styles.incidentSide}>
          {/* En un cierre el badge sustituye al "Cerrada" — el
              contexto de la fila ya lo dice; avisos y muestras sin
              calificar conservan su etiqueta porque no se
              sobreentiende */}
          {(closure || muteLab) && !unclassified ? (
            <View style={styles.incidentBadges}>
              {(muteLab ? [LAB_ART] : incidentBadgeArts(inc)).map(
                (art, idx) => (
                  <Image
                    key={idx}
                    testID="incident-badge"
                    source={art}
                    style={styles.incidentBadge}
                  />
                ),
              )}
            </View>
          ) : (
            <Text style={[styles.incidentState, { color: accent }]}>
              {stateLabel}
            </Text>
          )}
          {causeText && (
            <Text style={styles.incidentCause} testID="incident-cause">
              {causeText}
            </Text>
          )}
        </View>
        {/* Titulares desplegados a ancho completo de la fila (wrap
            debajo de ambas columnas): agrupados por fase y teñidos
            con el acento del episodio (Medusas → añil) salvo la
            reapertura, que siempre va en su verde de fase */}
        {pressItems.length > 0 && openIncs.has(inc.id) && (
          <View style={styles.incidentTitles}>
            <NewsGroupList
              groups={groupNewsItems(pressItems)}
              accentOverride={accent}
            />
          </View>
        )}
      </View>
    );
  };

  const own = incidents.filter((i) => !i.attributed_pm);
  // Episodios de laboratorio MUDOS aparte: el agua salió no apta
  // pero sin corroboración de cierre — contarlos como "cierres"
  // afirmaría un acto administrativo que no podemos demostrar
  const labN = own.filter(isMuteLab).length;
  const totalC = own.filter(isClosure).length;
  const totalW = own.filter(
    (i) => !isClosure(i) && !isUnclassified(i) && !isMuteLab(i),
  ).length;
  const uncl = incidents.filter(isUnclassified).length;
  const y1 = episodesThisYear(incidents);
  const y5 = episodesInYears(incidents, 5);
  const parts = (c: number, w: number, l: number) =>
    [
      c ? `${c} cierre${c === 1 ? '' : 's'}` : null,
      w ? `${w} aviso${w === 1 ? '' : 's'}` : null,
      l
        ? `${l} muestra${l === 1 ? '' : 's'} no apta${l === 1 ? '' : 's'}`
        : null,
    ]
      .filter(Boolean)
      .join(' · ');
  const y1parts = parts(y1.closures, y1.warnings, y1.lab);
  const y5parts = parts(y5.closures, y5.warnings, y5.lab);
  const y5rest = parts(0, y5.warnings, y5.lab);
  // Todo el historial cabe en 5 años → el total y el "5 años"
  // son el mismo número: una sola frase, sin repetir datos
  const allIn5 =
    totalC === y5.closures && totalW === y5.warnings && labN === y5.lab;

  // Agrupado por año; dentro de cada año, los episodios de
  // la zona hermana (attributed_pm) van al final con su
  // propio rótulo — no son cierres de este punto
  const years = [...new Set(incidents.map((i) => i.opened_at.slice(0, 4)))];

  return (
    <View style={styles.history}>
      <View style={styles.secHead}>
        <Image
          source={require('../../assets/icons/icon-episodes.png')}
          style={[styles.secIcon, { tintColor: colors.primaryDark }]}
        />
        <Text style={styles.secCardTitle}>Episodios ({incidents.length})</Text>
      </View>
      <View style={styles.historySummary}>
        {allIn5 && y5parts ? (
          // "6 cierres (4 este año) · 2 muestras no aptas" — el
          // paréntesis va pegado a los cierres y con el mismo tono
          <Text style={styles.historyStat}>
            {y5.closures > 0 && y1parts !== y5parts ? (
              <>
                <Text style={styles.historySummaryNum}>
                  {`${y5.closures} cierre${y5.closures === 1 ? '' : 's'}`}
                </Text>
                <Text style={styles.historySummaryNum}>
                  {` (${y1.closures ? y1.closures : 'ninguno'} este año)`}
                </Text>
                {y5rest ? ' · ' : ''}
                {y5rest ? (
                  <Text style={styles.historySummaryNum}>{y5rest}</Text>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.historySummaryNum}>{y5parts}</Text>
                {y1parts === y5parts
                  ? ' este año'
                  : ` (${y1parts || 'sin episodios'} este año)`}
              </>
            )}
            {uncl > 0 && (
              <>
                {' · '}
                <Text style={styles.historySummaryNum}>{uncl}</Text>
                {' sin calificar'}
              </>
            )}
          </Text>
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
              {labN > 0 && (
                <Text style={styles.historyStat}>
                  <Text style={styles.historySummaryNum}>{labN}</Text>
                  {` muestra${labN === 1 ? '' : 's'} no apta${labN === 1 ? '' : 's'}`}
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
          const open = isYearOpen(y);
          return (
            <View key={y}>
              <Pressable
                style={({ pressed }) => [
                  styles.yearHead,
                  collapsible && pressed && styles.pressFx,
                ]}
                onPress={
                  collapsible
                    ? () => setYearOpen((o) => ({ ...o, [y]: !open }))
                    : undefined
                }
                accessibilityRole={collapsible ? 'button' : 'text'}
                accessibilityLabel={`${y}, ${rows.length} episodios${
                  collapsible ? (open ? ', contraer' : ', expandir') : ''
                }`}
              >
                <View style={styles.yearChip}>
                  <Image
                    source={require('../../assets/icons/icon-calendar.png')}
                    style={styles.yearIcon}
                  />
                  <Text style={styles.yearChipText}>{y}</Text>
                  {collapsible && (
                    <Text style={styles.yearCaret}>{open ? '▾' : '▸'}</Text>
                  )}
                </View>
                {!open && (
                  <Text style={styles.yearCount}>
                    {`${rows.length} episodio${rows.length === 1 ? '' : 's'}`}
                  </Text>
                )}
                <View style={styles.yearRule} />
              </Pressable>
              {open && (
                <>
                  {ownRows.map(renderInc)}
                  {sib.length > 0 && (
                    <>
                      <Text style={styles.historySubGroupTitle}>
                        En la {siblingZoneRef(beachName, sib[0].attributed_pm!)}
                      </Text>
                      {sib.map(renderInc)}
                    </>
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
    // Sin línea divisoria: la pastilla de estado ya cierra la
    // cabecera — igual que .sec.nodiv en la ficha web
    marginTop: 10,
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
    marginBottom: 2,
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
  // Cabecera de año: icono calendario + pastilla sutil + hairline
  // hasta el borde — click = expande/colapsa el grupo
  yearHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    marginBottom: 6,
  },
  yearIcon: {
    width: 15,
    height: 15,
    // Óptica: el calendario rellena casi toda la pastilla; el leve
    // margen negativo lo centra con la línea base del año
    marginTop: -1,
  },
  yearChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(7,82,118,0.08)',
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  yearChipText: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: colors.primaryDark,
    letterSpacing: 0.4,
  },
  yearCaret: {
    fontSize: 9,
    fontFamily: fonts.semibold,
    color: colors.primaryDark,
  },
  yearCount: {
    fontSize: 10,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  yearRule: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  historySubGroupTitle: {
    fontSize: 10,
    fontFamily: fonts.semibold,
    color: colors.textFaint,
    marginTop: 6,
    marginBottom: 2,
  },
  incident: {
    flexDirection: 'row',
    // wrap: los titulares desplegados bajan a una línea propia a
    // ancho completo, debajo de notas y badge
    flexWrap: 'wrap',
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 4,
    marginBottom: 8,
    backgroundColor: colors.background,
    borderRadius: 4,
  },
  incidentMain: {
    flex: 1,
  },
  // Las notas bajan al pie de la columna para quedar a la altura
  // del texto de causa del lateral (misma idea que la ficha web)
  incidentNotes: {
    marginTop: 'auto',
  },
  incidentSide: {
    alignItems: 'flex-end',
    // Anclado arriba: al desplegar titulares la fila crece y un
    // bloque centrado se desplazaba hacia abajo
    justifyContent: 'flex-start',
    flexShrink: 0,
    paddingRight: 6,
    gap: 1,
  },
  incidentTitles: {
    width: '100%',
  },
  incidentBadges: {
    flexDirection: 'row',
    gap: 2,
  },
  incidentBadge: {
    width: 27,
    height: 27,
  },
  incidentState: {
    fontSize: 11,
    fontFamily: fonts.bold,
  },
  // La causa es el "por qué" del episodio, no un apunte: negrita
  // y casi negro en vez del gris de metadato
  incidentCause: {
    fontSize: 11.5,
    fontFamily: fonts.bold,
    color: colors.text,
    marginTop: 2,
  },
  // Las fechas son la identidad de la fila (el "cuándo" que se
  // escanea primero): mismo peso/casi negro que la causa
  incidentDates: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  incidentObs: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  newsToggle: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    marginBottom: 4,
  },
});

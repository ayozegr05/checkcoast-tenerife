import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { BeachIncident, EpisodeFocus } from '../../lib/api';
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
  // Episodio tocado desde el timeline municipal/temporada: su año
  // llega desplegado, la fila se resalta y la ficha baja hasta ella
  focus?: EpisodeFocus | null;
  // ScrollView de la ficha (FeatureSheet) — para el aterrizaje a la
  // altura de la fila objetivo
  scrollRef?: React.RefObject<ScrollView | null>;
  // Offset actual de ese ScrollView: la y medida es relativa al
  // frame visible (= contentY - scrollY) y hay que compensarla
  getScrollY?: () => number;
  // El foco se consume al aterrizar: si luego se abre la misma playa
  // desde el mapa, la ficha no vuelve a bajar al episodio viejo
  onFocusConsumed?: () => void;
};

// Historial de incidencias oficiales + episodios reconstruidos:
// resumen de cifras + lista agrupada por año, con los episodios de
// zonas hermanas (attributed_pm) apartados al final de cada año
export default function IncidentHistory({
  incidents,
  openIncs,
  onToggleIncident,
  beachName = '',
  focus = null,
  scrollRef,
  getScrollY,
  onFocusConsumed,
}: IncidentHistoryProps) {
  // Acordeón por año: el actual y el anterior abiertos, el resto
  // colapsados — en 15 años de historial la lista no se hace eterna.
  // Con pocos episodios (≤10) todo abierto: el acordeón solo paga
  // cuando hay volumen que esconder
  const [yearOpen, setYearOpen] = useState<Record<string, boolean>>({});
  const collapsible = incidents.length > 10;
  const yearDefault = (y: string) => Number(y) >= new Date().getFullYear() - 1;

  // Deep-link desde Municipios/temporada. La fila municipal puede ser
  // una fusión de varios PMs/actas: primero match por id (solo los
  // positivos — ids reales de beach_incidents, compartidos entre
  // endpoints; los sintéticos -1,-2… son locales de cada respuesta),
  // luego por fecha de apertura, luego por la ventana que lo cubre
  // (el episodio municipal abrió con el tramo de otro PM) y como
  // último recurso la fila más próxima en el tiempo
  const target = useMemo(() => {
    if (!focus) return null;
    if (focus.id > 0) {
      const byId = incidents.find((i) => i.id === focus.id);
      if (byId) return byId;
    }
    if (!focus.opened_at) return null;
    const d = Date.parse(focus.opened_at);
    const byDate = incidents.find((i) => i.opened_at === focus.opened_at);
    if (byDate) return byDate;
    const covering = incidents.find(
      (i) =>
        Date.parse(i.opened_at) <= d &&
        d <= (i.closed_at ? Date.parse(i.closed_at) : Infinity),
    );
    if (covering) return covering;
    let best: BeachIncident | null = null;
    let bestDist = Infinity;
    for (const i of incidents) {
      const dist = Math.abs(Date.parse(i.opened_at) - d);
      if (dist < bestDist) {
        best = i;
        bestDist = dist;
      }
    }
    return best;
  }, [focus, incidents]);
  const targetYear = target ? target.opened_at.slice(0, 4) : null;

  // El año del episodio tocado llega desplegado aunque sea antiguo
  // (por defecto se colapsa todo lo anterior al año pasado); el
  // usuario puede volver a cerrarlo con el toggle — solo es el
  // default del deep-link, no un bloqueo
  const isYearOpen = (y: string) =>
    !collapsible || (yearOpen[y] ?? (targetYear === y ? true : yearDefault(y)));

  // Aterrizaje: la fila objetivo se mide contra el contenido del
  // ScrollView y se baja a su altura; si el episodio fusionado no
  // casa con ninguna fila, al menos bajamos a la sección
  const targetRowRef = useRef<View>(null);
  const sectionRef = useRef<View>(null);
  const scrolled = useRef(false);
  const [flash, setFlash] = useState(false);

  const scrollToNode = (node: View | null) => {
    const sv = scrollRef?.current;
    if (!sv || !node) return;
    // Dos medidas posibles según el ancestro que resuelva:
    // · contra el inner view (contenido) → y ya es contentY
    // · contra el frame del ScrollView  → yRel = contentY - scrollY
    //   y hay que sumar el offset en vivo (por si el usuario
    //   scrolleó entre reintentos). Margen de ~150px sobre la fila:
    // no aterriza pegada al borde — deja ver la cabecera "Episodios"
    // y un par de filas de contexto encima
    const MARGIN = 210;
    const doneAbs = (y: number) =>
      sv.scrollTo({ y: Math.max(0, y - MARGIN), animated: true });
    const doneRel = (yRel: number) =>
      sv.scrollTo({
        y: Math.max(0, yRel + (getScrollY?.() ?? 0) - MARGIN),
        animated: true,
      });
    const anySv = sv as unknown as {
      // En Fabric, measureLayout exige el REF del componente nativo
      // (un handle numérico de findNodeHandle lo rechaza): el
      // ScrollView los expone como getInnerViewRef /
      // getNativeScrollRef
      getInnerViewRef?: () => any;
      getInnerViewNode?: () => number | null;
      getNativeScrollRef?: () => any;
      getScrollableNode?: () => number | null;
      measureInWindow?: (cb: (x: number, y: number) => void) => void;
    };
    // Último recurso: posiciones en ventana (fila − marco del
    // ScrollView = y relativa al frame)
    const windowFallback = () => {
      if (!anySv.measureInWindow || !node.measureInWindow) return;
      node.measureInWindow((_x, ry) =>
        anySv.measureInWindow!((_sx, sy) => doneRel(ry - sy)),
      );
    };
    // Preferimos el inner view (y absoluta, sin offset); el frame
    // nativo queda de respaldo, y los handles numéricos solo sirven
    // en la arquitectura vieja — mejor que nada
    const innerRef = anySv.getInnerViewRef?.() ?? anySv.getInnerViewNode?.();
    const frameRef =
      anySv.getNativeScrollRef?.() ?? anySv.getScrollableNode?.();
    if (innerRef && node.measureLayout) {
      node.measureLayout(innerRef, (_x, y) => doneAbs(y), windowFallback);
    } else if (frameRef && node.measureLayout) {
      node.measureLayout(frameRef, (_x, y) => doneRel(y), windowFallback);
    } else {
      windowFallback();
    }
  };

  // Fila en la que ya aterrizamos: al consumir el foco (App limpia
  // el estado) la marca sobrevive — si dependiera solo de `target`
  // el velo se apagaría de golpe al limpiarse el foco
  const [landedId, setLandedId] = useState<number | null>(null);

  const onTargetLayout = (inc: BeachIncident) => {
    if (scrolled.current) return;
    scrolled.current = true;
    setLandedId(inc.id);
    onFocusConsumed?.();
    setFlash(true);
    setTimeout(() => setFlash(false), 2400);
    // Aterrizaje en la fila exacta con re-medición escalonada: las
    // secciones de arriba (foto, banner de prensa, calidad,
    // emisarios) cargan async y empujan el contenido — un único
    // scroll quedaba corto. Cada intento mide la posición ACTUAL de
    // la fila; cuando todo está quieto los re-scrolls no mueven nada
    for (const ms of [80, 400, 900]) {
      setTimeout(() => scrollToNode(targetRowRef.current), ms);
    }
  };

  // Episodio municipal fusionado sin fila que case (id ni fecha):
  // bajar a la sección de Episodios como aterrizaje razonable
  useEffect(() => {
    if (!focus || target) return;
    const t = setTimeout(() => {
      if (!scrolled.current) {
        scrolled.current = true;
        onFocusConsumed?.();
        scrollToNode(sectionRef.current);
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, target]);

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
    const focused = target === inc || inc.id === landedId;
    return (
      <View
        key={inc.id}
        ref={focused ? targetRowRef : undefined}
        onLayout={focused ? () => onTargetLayout(inc) : undefined}
        testID={focused ? 'incident-focused' : undefined}
        style={[
          styles.incident,
          { borderLeftColor: accent },
          // Deep-link municipal: la fila tocada llega marcada — flash
          // de acento al aterrizar que se asienta en un velo suave
          focused && { backgroundColor: flash ? `${accent}26` : `${accent}10` },
        ]}
      >
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
    <View ref={sectionRef} style={styles.history}>
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

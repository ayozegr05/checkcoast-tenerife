import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  ImageBackground,
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  BeachStats,
  GeoFeature,
  MunicipalityIncident,
  fetchBeachStats,
  fetchMunicipalityIncidents,
} from '../lib/api';
import { displayBeachName } from '../lib/format';
import { colors, fonts } from '../lib/theme';
import Skeleton from './Skeleton';

type MuniStats = {
  municipality: string | null;
  name: string;
  beaches: number; // playas distintas (nombre base sin "PMx")
  points: number; // puntos de muestreo monitorizados
  closedNow: number;
  warningNow: number;
  incidents: number; // cierres + avisos históricos
  closuresLastYear: number;
  badSamples: number;
};

// Una playa extensa tiene varios puntos de muestreo (PM1, PM2...):
// para el conteo de playas agrupamos por nombre base
const baseName = (name: string) => name.replace(/\s+PM\d+$/, '');

type MuniAcc = Omit<MuniStats, 'beaches'> & { beachNames: Set<string> };

// Severidad: mandan las afectaciones activas (cierre pesa más que aviso);
// el histórico de incidentes y muestras no aptas desempata
const scoreOf = (m: MuniStats) =>
  m.closedNow * 100 + m.warningNow * 20 + m.incidents + m.badSamples;

const barColorOf = (m: MuniStats) =>
  m.closedNow > 0
    ? colors.status.closed
    : m.warningNow > 0
      ? colors.status.warning
      : colors.status.open;

// Círculo de posición: el podio usa el color de severidad del municipio
// (rojo = cierres ahora, naranja = avisos, azul = solo histórico) — el
// top 3 marca "los que peor están", no un premio. Neutro del 4º en adelante
const rankColorOf = (m: MuniStats, index: number) =>
  index < 3 ? barColorOf(m) : '#8fa3ad';

const fmtDate = (iso: string) => iso.split('-').reverse().join('/');

// Duración en días naturales incluyendo el día de apertura
const durationDays = (inc: MunicipalityIncident) => {
  const end = inc.closed_at ? new Date(inc.closed_at) : new Date();
  return Math.max(
    1,
    Math.round(
      (end.getTime() - new Date(inc.opened_at).getTime()) / 86400000,
    ) + 1,
  );
};

export default function MunicipalityStats({
  visible,
  beaches,
  onSelect,
  onSelectBeach,
  onClose,
}: {
  visible: boolean;
  beaches: GeoFeature[];
  onSelect: (municipality: string | null) => void;
  // Tocar un incidente de la línea temporal abre la ficha de su playa
  onSelectBeach?: (beachId: number) => void;
  onClose: () => void;
}) {
  const [stats, setStats] = useState<Map<number, BeachStats>>(new Map());
  const [detail, setDetail] = useState<MuniStats | null>(null);
  const [incidents, setIncidents] = useState<MunicipalityIncident[] | null>(
    null,
  );

  useEffect(() => {
    fetchBeachStats()
      .then((rows) => setStats(new Map(rows.map((s) => [s.beach_id, s]))))
      .catch(() => {});
  }, []);

  // Línea temporal de incidentes del municipio abierto; solo las playas
  // monitorizadas tienen incidentes, así que "Sin municipio" no tiene
  useEffect(() => {
    setIncidents(null);
    // "Sin municipio" no tiene incidentes oficiales pero puede tener
    // alertas de prensa (playas OSM): lista vacía, no skeleton eterno
    if (!detail?.municipality) {
      setIncidents([]);
      return;
    }
    fetchMunicipalityIncidents(detail.municipality)
      .then(setIncidents)
      .catch(() => setIncidents([]));
  }, [detail]);

  // Línea temporal del municipio abierto: el backend ya devuelve
  // incidentes oficiales + eventos reconstruidos (analítica/prensa).
  // Solo "Sin municipio" necesita síntesis en cliente: el endpoint
  // no puede filtrar por municipio NULL
  const detailRows = useMemo<MunicipalityIncident[]>(() => {
    if (!detail) return [];
    const official = incidents ?? [];
    if (detail.municipality) return official;
    const pressRows: MunicipalityIncident[] = beaches
      .filter(
        (f) =>
          (f.properties.municipality ?? 'Sin municipio') ===
            detail.name && f.properties.alert === true,
      )
      .map((f) => ({
        id: -f.id, // id negativo: no colisiona con incidentes reales
        beach_id: f.id,
        beach_name: f.properties.name,
        municipality: detail.municipality,
        kind:
          f.properties.status === 'warning'
            ? ('warning' as const)
            : ('closure' as const),
        opened_at: (f.properties.reported_at ?? '').slice(0, 10),
        closed_at: null,
        observations: 'Según prensa — sin incidente oficial en Náyade',
        via: 'press',
      }));
    return [...official, ...pressRows].sort((a, b) =>
      b.opened_at.localeCompare(a.opened_at),
    );
  }, [detail, incidents, beaches]);

  // Estado vivo por playa: un incidente abierto cuyo observations no
  // dice "prohibido" se clasifica como aviso, pero si la playa está
  // cerrada ahora mismo el badge debe decir "Cierre activo"
  const liveStatus = useMemo(
    () =>
      new Map(
        beaches.map((f) => [f.id, f.properties.status ?? 'unknown']),
      ),
    [beaches],
  );

  const rows = useMemo(() => {
    const byMuni = new Map<string, MuniAcc>();
    for (const f of beaches) {
      const municipality = f.properties.municipality ?? null;
      const name = municipality ?? 'Sin municipio';
      const m =
        byMuni.get(name) ?? {
          municipality,
          name,
          beachNames: new Set<string>(),
          points: 0,
          closedNow: 0,
          warningNow: 0,
          incidents: 0,
          closuresLastYear: 0,
          badSamples: 0,
        };
      // El conteo de playas incluye todas las catalogadas;
      // solo las monitorizadas tienen estado oficial ni stats
      m.beachNames.add(baseName(f.properties.name));
      // El estado vivo cuenta para TODAS las playas: una OSM cerrada
      // según prensa (Benijo) también es una afectación real. Los
      // puntos de muestreo y el histórico sí son solo de monitorizadas
      if (f.properties.status === 'closed') m.closedNow += 1;
      else if (f.properties.status === 'warning') m.warningNow += 1;
      if (f.properties.monitored !== false) {
        m.points += 1;
        const st = stats.get(f.id);
        if (st) {
          m.incidents += st.closures + st.warnings;
          m.closuresLastYear += st.closures_last_year;
          m.badSamples += st.bad_samples;
        }
      }
      // Los episodios reconstruidos (analítica sin incidencia, cierres
      // solo en prensa) cuentan como incidentes reales también en las
      // playas no monitorizadas — Benijo cerró de verdad
      const st = stats.get(f.id);
      if (st?.reconstructed) m.incidents += st.reconstructed;
      byMuni.set(name, m);
    }
    return [...byMuni.values()]
      .map(({ beachNames, ...m }): MuniStats => ({
        ...m,
        beaches: beachNames.size,
      }))
      .sort(
        (a, b) => scoreOf(b) - scoreOf(a) || a.name.localeCompare(b.name),
      );
  }, [beaches, stats]);

  const maxScore = Math.max(1, ...rows.map(scoreOf));

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={detail ? () => setDetail(null) : onClose}
    >
      <View style={styles.container}>
        {detail ? (
          <>
            <ImageBackground
              source={require('../assets/gradient-sea.png')}
              style={styles.headerBlock}
              resizeMode="cover"
            >
              <View style={styles.header}>
                <Pressable
                  onPress={() => setDetail(null)}
                  hitSlop={12}
                  style={styles.backBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Volver al ranking"
                >
                  <Text style={styles.backText}>‹</Text>
                </Pressable>
                <Text style={styles.title} numberOfLines={1}>
                  {detail.name}
                </Text>
                <Pressable
                  onPress={() => onSelect(detail.municipality)}
                  style={styles.listBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Ver playas del municipio"
                >
                  <Text style={styles.listBtnText}>Ver playas</Text>
                </Pressable>
              </View>
              <Text style={styles.subtitle}>
                Línea temporal de incidentes · más reciente primero
              </Text>
            </ImageBackground>

            <FlatList
              data={detailRows}
              keyExtractor={(inc) => String(inc.id)}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              renderItem={({ item: inc, index }) => {
                // Solo un incidente sin fecha de cierre está "activo":
                // el badge sólido se reserva a ese caso — los
                // históricos van en outline para no leerse como vivos
                const active = inc.closed_at === null;
                // "Sin Calificar" = Náyade abrió ficha por una muestra
                // pendiente de clasificar (p.ej. San Marcos por la
                // pérdida de arena): no es ni cierre ni aviso real
                const unclassified = /sin\s*calificar/i.test(
                  inc.observations ?? '',
                );
                // En incidentes vivos manda el estado actual de la
                // playa (p.ej. Gaviotas: incidencia "aviso" pero la
                // playa está cerrada por muestra no apta)
                const live = liveStatus.get(inc.beach_id);
                const kind =
                  active && (live === 'closed' || live === 'warning')
                    ? live === 'closed'
                      ? 'closure'
                      : 'warning'
                    : inc.kind;
                return (
                  <View style={styles.tlItem}>
                    <View style={styles.tlRail}>
                      <View
                        style={[
                          styles.tlDot,
                          !active && styles.tlDotEnded,
                          active && {
                            backgroundColor:
                              kind === 'closure'
                                ? colors.status.closed
                                : colors.status.warning,
                          },
                        ]}
                      />
                      {index < detailRows.length - 1 && (
                        <View style={styles.tlLine} />
                      )}
                    </View>
                    <Pressable
                      style={styles.tlBody}
                      onPress={() => onSelectBeach?.(inc.beach_id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Ver ficha de ${displayBeachName(
                        inc.beach_name,
                      )}`}
                    >
                      <View style={styles.tlHeader}>
                        <Text style={styles.tlBeach} numberOfLines={1}>
                          {displayBeachName(inc.beach_name)}
                        </Text>
                        <Text
                          style={[
                            styles.badge,
                            active
                              ? kind === 'closure'
                                ? styles.badgeClosed
                                : styles.badgeWarning
                              : styles.badgeEnded,
                          ]}
                        >
                          {unclassified
                            ? 'Pendiente'
                            : kind === 'closure'
                              ? 'Cierre'
                              : 'Aviso'}
                          {active && !unclassified ? ' activo' : ''}
                        </Text>
                        <Text style={styles.tlGo}>›</Text>
                      </View>
                      <Text style={styles.tlDates}>
                        {inc.opened_at ? fmtDate(inc.opened_at) : '—'}
                        {' → '}
                        {inc.closed_at
                          ? fmtDate(inc.closed_at)
                          : 'activo'}
                        {inc.opened_at
                          ? ` · ${durationDays(inc)} ${
                              durationDays(inc) === 1 ? 'día' : 'días'
                            }`
                          : ''}
                      </Text>
                      {inc.observations ? (
                        <Text style={styles.tlObs}>
                          {inc.observations}
                        </Text>
                      ) : null}
                    </Pressable>
                  </View>
                );
              }}
              ListEmptyComponent={
                incidents === null ? (
                  <View>
                    {[0, 1, 2].map((i) => (
                      <View key={i} style={styles.tlItem}>
                        <View style={styles.tlRail}>
                          <Skeleton style={styles.tlDotSkeleton} />
                          {i < 2 && <View style={styles.tlLine} />}
                        </View>
                        <View style={styles.tlBody}>
                          <Skeleton style={styles.tlSkeletonTitle} />
                          <Skeleton style={styles.tlSkeletonLine} />
                          <Skeleton style={styles.tlSkeletonLineShort} />
                        </View>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.empty}>
                    Sin incidentes registrados
                  </Text>
                )
              }
            />
          </>
        ) : (
          <>
        <ImageBackground
          source={require('../assets/gradient-sea.png')}
          style={styles.headerBlock}
          resizeMode="cover"
        >
          <View style={styles.header}>
            <Text style={styles.title}>Incidencias por municipio</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.subtitle}>
            Ranking por afectación actual e histórica · toca un municipio
            para ver su línea temporal
          </Text>
        </ImageBackground>

        <FlatList
          data={rows}
          keyExtractor={(m) => m.name}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          renderItem={({ item, index }) => (
            <Pressable
              style={styles.row}
              onPress={() => setDetail(item)}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, posición ${index + 1} de ${
                rows.length
              }, ${item.beaches} playas, ${item.incidents} incidentes`}
              accessibilityHint="Ver línea temporal de incidentes"
            >
              <View style={styles.rowHeader}>
                <View
                  style={[
                    styles.rank,
                    index < 3 && styles.rankPodium,
                    { backgroundColor: rankColorOf(item, index) },
                  ]}
                >
                  {index < 3 ? (
                    <Image
                      source={require('../assets/icons/icon-alert.png')}
                      style={styles.rankIcon}
                    />
                  ) : (
                    <Text style={styles.rankText}>{index + 1}</Text>
                  )}
                </View>
                <Text style={styles.rowName}>{item.name}</Text>
                <Text style={styles.rowBeaches}>
                  {item.beaches}{' '}
                  {item.beaches === 1 ? 'playa' : 'playas'}
                  {item.points > item.beaches
                    ? ` · ${item.points} PMs`
                    : ''}
                </Text>
              </View>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${(scoreOf(item) / maxScore) * 100}%`,
                      backgroundColor: barColorOf(item),
                    },
                  ]}
                />
              </View>
              <View style={styles.rowStats}>
                {item.closedNow > 0 && (
                  <Text style={[styles.badge, styles.badgeClosed]}>
                    {item.closedNow}{' '}
                    {item.closedNow === 1 ? 'cerrada' : 'cerradas'} ahora
                  </Text>
                )}
                {item.warningNow > 0 && (
                  <Text style={[styles.badge, styles.badgeWarning]}>
                    {item.warningNow}{' '}
                    {item.warningNow === 1 ? 'aviso' : 'avisos'} activo
                    {item.warningNow === 1 ? '' : 's'}
                  </Text>
                )}
              </View>
              <Text style={styles.rowSub}>
                {item.incidents}{' '}
                {item.incidents === 1 ? 'incidente' : 'incidentes'} (
                {item.closuresLastYear} últ. año) · {item.badSamples}{' '}
                {item.badSamples === 1 ? 'muestra' : 'muestras'} no apta
                {item.badSamples === 1 ? '' : 's'}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>Sin datos de municipios</Text>
          }
        />
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerBlock: {
    paddingTop:
      (Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 24) + 10,
    paddingBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 18,
    fontFamily: fonts.extrabold,
    color: '#fff',
  },
  close: {
    fontSize: 20,
    color: 'rgba(255,255,255,0.9)',
  },
  subtitle: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: 'rgba(255,255,255,0.85)',
    paddingHorizontal: 16,
    marginTop: 4,
  },
  list: {
    flex: 1,
    marginTop: 4,
  },
  listContent: {
    paddingBottom: Platform.OS === 'android' ? 34 : 8, // barra de gestos
  },
  row: {
    backgroundColor: colors.surface,
    marginHorizontal: 12,
    marginBottom: 6,
    borderRadius: 10,
    padding: 12,
    elevation: 1,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rank: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  rankPodium: {
    width: 26,
    height: 26,
    borderRadius: 13,
    elevation: 2,
  },
  rankText: {
    fontSize: 11,
    fontFamily: fonts.extrabold,
    color: '#fff',
  },
  rankIcon: {
    width: 14,
    height: 14,
  },
  rowName: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.text,
    flex: 1,
  },
  rowBeaches: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginLeft: 8,
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginTop: 8,
    overflow: 'hidden',
  },
  barFill: {
    height: 6,
    borderRadius: 3,
  },
  rowStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 11,
    fontFamily: fonts.bold,
    color: '#fff',
    overflow: 'hidden',
  },
  badgeClosed: {
    backgroundColor: colors.status.closed,
  },
  badgeWarning: {
    backgroundColor: colors.status.warning,
  },
  // Incidente histórico (ya cerrado): outline apagado — el sólido se
  // reserva a los activos para que no se lean como vigentes
  badgeEnded: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textMuted,
  },
  tlDotEnded: {
    backgroundColor: colors.textFaint,
  },
  tlGo: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.textFaint,
    marginLeft: 6,
    marginTop: -2,
  },
  rowSub: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 6,
  },
  empty: {
    textAlign: 'center',
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 40,
  },
  backBtn: {
    marginRight: 4,
  },
  backText: {
    fontSize: 26,
    fontFamily: fonts.semibold,
    color: '#fff',
    marginTop: -4,
  },
  listBtn: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginLeft: 8,
  },
  listBtnText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  tlItem: {
    flexDirection: 'row',
    marginHorizontal: 16,
  },
  tlRail: {
    width: 20,
    alignItems: 'center',
  },
  tlDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 14,
    borderWidth: 2,
    borderColor: '#fff',
    elevation: 1,
  },
  tlLine: {
    flex: 1,
    width: 2,
    backgroundColor: colors.border,
  },
  tlDotSkeleton: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 14,
  },
  tlSkeletonTitle: {
    width: '55%',
    height: 13,
  },
  tlSkeletonLine: {
    width: '85%',
    height: 10,
    marginTop: 9,
  },
  tlSkeletonLineShort: {
    width: '65%',
    height: 10,
    marginTop: 6,
  },
  tlBody: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 12,
    marginLeft: 6,
    marginBottom: 10,
    elevation: 1,
  },
  tlHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tlBeach: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.text,
    flex: 1,
    marginRight: 8,
  },
  tlDates: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
    marginTop: 4,
  },
  tlObs: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 4,
  },
});

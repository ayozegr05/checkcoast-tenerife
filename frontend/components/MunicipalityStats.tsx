import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
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

// Círculo de posición: medalla para el podio, neutro a partir del 4º.
// La severidad del municipio la sigue mostrando la barra, no el número
const MEDAL = ['#C9A227', '#9AA5B1', '#B5713A']; // oro, plata, bronce
const rankColorOf = (index: number) => MEDAL[index] ?? '#8fa3ad';

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
  beaches,
  onSelect,
  onClose,
}: {
  beaches: GeoFeature[];
  onSelect: (municipality: string | null) => void;
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
    if (!detail?.municipality) return;
    fetchMunicipalityIncidents(detail.municipality)
      .then(setIncidents)
      .catch(() => setIncidents([]));
  }, [detail]);

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
      if (f.properties.monitored !== false) {
        m.points += 1;
        if (f.properties.status === 'closed') m.closedNow += 1;
        else if (f.properties.status === 'warning') m.warningNow += 1;
        const st = stats.get(f.id);
        if (st) {
          m.incidents += st.closures + st.warnings;
          m.closuresLastYear += st.closures_last_year;
          m.badSamples += st.bad_samples;
        }
      }
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
              data={incidents ?? []}
              keyExtractor={(inc) => String(inc.id)}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              renderItem={({ item: inc, index }) => (
                <View style={styles.tlItem}>
                  <View style={styles.tlRail}>
                    <View
                      style={[
                        styles.tlDot,
                        {
                          backgroundColor:
                            inc.kind === 'closure'
                              ? colors.status.closed
                              : colors.status.warning,
                        },
                      ]}
                    />
                    {index < (incidents?.length ?? 0) - 1 && (
                      <View style={styles.tlLine} />
                    )}
                  </View>
                  <View style={styles.tlBody}>
                    <View style={styles.tlHeader}>
                      <Text style={styles.tlBeach} numberOfLines={1}>
                        {displayBeachName(inc.beach_name)}
                      </Text>
                      <Text
                        style={[
                          styles.badge,
                          inc.kind === 'closure'
                            ? styles.badgeClosed
                            : styles.badgeWarning,
                        ]}
                      >
                        {inc.kind === 'closure' ? 'Cierre' : 'Aviso'}
                      </Text>
                    </View>
                    <Text style={styles.tlDates}>
                      {fmtDate(inc.opened_at)}
                      {' → '}
                      {inc.closed_at ? fmtDate(inc.closed_at) : 'activo'}
                      {' · '}
                      {durationDays(inc)}{' '}
                      {durationDays(inc) === 1 ? 'día' : 'días'}
                    </Text>
                    {inc.observations ? (
                      <Text style={styles.tlObs}>{inc.observations}</Text>
                    ) : null}
                  </View>
                </View>
              )}
              ListEmptyComponent={
                <Text style={styles.empty}>
                  {incidents === null
                    ? 'Cargando incidentes...'
                    : 'Sin incidentes registrados'}
                </Text>
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
            >
              <View style={styles.rowHeader}>
                <View
                  style={[
                    styles.rank,
                    index < 3 && styles.rankPodium,
                    { backgroundColor: rankColorOf(index) },
                  ]}
                >
                  <Text style={styles.rankText}>{index + 1}</Text>
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

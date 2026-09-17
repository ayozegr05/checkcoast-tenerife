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

import { BeachStats, GeoFeature, fetchBeachStats } from '../lib/api';
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

  useEffect(() => {
    fetchBeachStats()
      .then((rows) => setStats(new Map(rows.map((s) => [s.beach_id, s]))))
      .catch(() => {});
  }, []);

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
    <Modal animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
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
            para ver sus playas
          </Text>
        </ImageBackground>

        <FlatList
          data={rows}
          keyExtractor={(m) => m.name}
          style={styles.list}
          renderItem={({ item, index }) => (
            <Pressable
              style={styles.row}
              onPress={() => onSelect(item.municipality)}
            >
              <View style={styles.rowHeader}>
                <View
                  style={[
                    styles.rank,
                    { backgroundColor: barColorOf(item) },
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
});

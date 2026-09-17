import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BeachStats, GeoFeature, fetchBeachStats } from '../lib/api';

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
  m.closedNow > 0 ? '#c62828' : m.warningNow > 0 ? '#e65100' : '#0288d1';

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
      // Las no monitorizadas no tienen estado oficial ni stats que agregar
      if (f.properties.monitored === false) continue;
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
      m.points += 1;
      m.beachNames.add(baseName(f.properties.name));
      if (f.properties.status === 'closed') m.closedNow += 1;
      else if (f.properties.status === 'warning') m.warningNow += 1;
      const st = stats.get(f.id);
      if (st) {
        m.incidents += st.closures + st.warnings;
        m.closuresLastYear += st.closures_last_year;
        m.badSamples += st.bad_samples;
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
        <View style={styles.header}>
          <Text style={styles.title}>Incidencias por municipio</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
        <Text style={styles.subtitle}>
          Ranking por afectación actual e histórica · toca un municipio para
          ver sus playas
        </Text>

        <FlatList
          data={rows}
          keyExtractor={(m) => m.name}
          style={styles.list}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => onSelect(item.municipality)}
            >
              <View style={styles.rowHeader}>
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
    backgroundColor: '#f7f7f7',
    paddingTop:
      (Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 24) + 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#222',
  },
  close: {
    fontSize: 20,
    color: '#666',
  },
  subtitle: {
    fontSize: 12,
    color: '#777',
    paddingHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
  },
  list: {
    flex: 1,
    marginTop: 4,
  },
  row: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginBottom: 6,
    borderRadius: 10,
    padding: 12,
    elevation: 1,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  rowName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#222',
    flex: 1,
  },
  rowBeaches: {
    fontSize: 12,
    color: '#777',
    marginLeft: 8,
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#e0e0e0',
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
    fontWeight: '700',
    color: '#fff',
    overflow: 'hidden',
  },
  badgeClosed: {
    backgroundColor: '#c62828',
  },
  badgeWarning: {
    backgroundColor: '#e65100',
  },
  rowSub: {
    fontSize: 12,
    color: '#777',
    marginTop: 6,
  },
  empty: {
    textAlign: 'center',
    color: '#888',
    marginTop: 40,
  },
});

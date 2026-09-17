import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { GeoFeature } from '../lib/api';

// Orden de prioridad: lo que necesita atención del bañista primero
const STATUS_ORDER: Record<string, number> = {
  closed: 0,
  warning: 1,
  unknown: 2,
  open: 3,
};

const STATUS_LABELS: Record<string, string> = {
  closed: 'Cerrada',
  warning: 'Aviso',
  unknown: 'Sin datos',
  open: 'Apta',
};

const STATUS_COLORS: Record<string, string> = {
  closed: '#c62828',
  warning: '#e65100',
  unknown: '#9e9e9e',
  open: '#2e7d32',
};

// "PLAYA ABADES (LOS ABRIGUITOS) PM1" -> "Playa Abades (Los Abriguitos)"
const displayName = (name: string) =>
  name
    .replace(/\s+PM\d+$/, '')
    .toLowerCase()
    .replace(/(^|[\s(-])([a-záéíóúñü])/g, (_m, pre: string, c: string) => pre + c.toUpperCase());

const statusOf = (f: GeoFeature) => f.properties.status ?? 'unknown';

export default function BeachList({
  beaches,
  onSelect,
  onClose,
}: {
  beaches: GeoFeature[];
  onSelect: (feature: GeoFeature) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [municipality, setMunicipality] = useState<string | null>(null);

  const municipalities = useMemo(
    () =>
      [...new Set(beaches.map((f) => f.properties.municipality).filter(Boolean))]
        .sort() as string[],
    [beaches],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return beaches
      .filter(
        (f) =>
          (!q || f.properties.name.toLowerCase().includes(q)) &&
          (!municipality || f.properties.municipality === municipality),
      )
      .sort(
        (a, b) =>
          (STATUS_ORDER[statusOf(a)] ?? 9) - (STATUS_ORDER[statusOf(b)] ?? 9) ||
          a.properties.name.localeCompare(b.properties.name),
      );
  }, [beaches, query, municipality]);

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Playas monitorizadas</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>

        <TextInput
          style={styles.search}
          placeholder="Buscar playa..."
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chips}
          contentContainerStyle={styles.chipsContent}
        >
          <Pressable
            style={[styles.chip, municipality === null && styles.chipActive]}
            onPress={() => setMunicipality(null)}
          >
            <Text
              style={[
                styles.chipText,
                municipality === null && styles.chipTextActive,
              ]}
            >
              Todos
            </Text>
          </Pressable>
          {municipalities.map((m) => (
            <Pressable
              key={m}
              style={[styles.chip, municipality === m && styles.chipActive]}
              onPress={() => setMunicipality(municipality === m ? null : m)}
            >
              <Text
                style={[
                  styles.chipText,
                  municipality === m && styles.chipTextActive,
                ]}
              >
                {m}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <FlatList
          data={visible}
          keyExtractor={(f) => String(f.id)}
          style={styles.list}
          renderItem={({ item }) => {
            const status = statusOf(item);
            return (
              <Pressable style={styles.row} onPress={() => onSelect(item)}>
                <View style={styles.rowText}>
                  <Text style={styles.rowName}>
                    {displayName(item.properties.name)}
                  </Text>
                  {item.properties.municipality ? (
                    <Text style={styles.rowSub}>
                      {item.properties.municipality}
                    </Text>
                  ) : null}
                </View>
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: STATUS_COLORS[status] },
                  ]}
                >
                  <Text style={styles.badgeText}>{STATUS_LABELS[status]}</Text>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text style={styles.empty}>Sin resultados</Text>
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
    paddingTop: (Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 24) + 8,
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
  search: {
    backgroundColor: '#fff',
    margin: 12,
    marginBottom: 8,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    elevation: 2,
  },
  chips: {
    flexGrow: 0,
  },
  chipsContent: {
    paddingHorizontal: 12,
    gap: 8,
    paddingBottom: 4,
  },
  chip: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    elevation: 1,
  },
  chipActive: {
    backgroundColor: '#0277bd',
  },
  chipText: {
    fontSize: 13,
    color: '#444',
  },
  chipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  list: {
    flex: 1,
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginBottom: 6,
    borderRadius: 10,
    padding: 12,
    elevation: 1,
  },
  rowText: {
    flex: 1,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#222',
  },
  rowSub: {
    fontSize: 12,
    color: '#777',
    marginTop: 2,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 8,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  empty: {
    textAlign: 'center',
    color: '#888',
    marginTop: 40,
  },
});

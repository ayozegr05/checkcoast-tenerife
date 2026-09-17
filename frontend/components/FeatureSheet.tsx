import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import BeachDetail from './BeachDetail';
import type { Selection } from './CoastMap';

const STATUS_LABELS: Record<string, string> = {
  legal: 'Autorizado',
  illegal: 'No autorizado',
  unknown: 'En trámite / sin datos',
};

const STATUS_COLORS: Record<string, string> = {
  legal: '#2e7d32',
  illegal: '#c62828',
  unknown: '#f9a825',
};

export default function FeatureSheet({
  selection,
  onClose,
}: {
  selection: Selection;
  onClose: () => void;
}) {
  const { feature } = selection;
  const p = feature.properties;
  const isBeach = selection.type === 'beach';

  const statusKey = p.status ?? 'unknown';

  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={2}>
          {p.name}
        </Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>

      {isBeach ? (
        <BeachDetail feature={feature} hasAlert={selection.hasAlert} />
      ) : (
        <View>
          <View
            style={[
              styles.chip,
              { backgroundColor: STATUS_COLORS[statusKey] ?? '#9e9e9e' },
            ]}
          >
            <Text style={styles.chipText}>
              {STATUS_LABELS[statusKey] ?? 'En trámite / sin datos'}
            </Text>
          </View>
          {p.kind ? <Text style={styles.row}>Tipo: {p.kind}</Text> : null}
          {p.municipality ? (
            <Text style={styles.row}>Municipio: {p.municipality}</Text>
          ) : null}
          <Text style={styles.row}>
            Fuente: Censo de Vertidos 2025 (Gob. Canarias)
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 24,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  close: {
    fontSize: 18,
    color: '#666',
  },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 8,
    marginBottom: 4,
  },
  chipText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  row: {
    fontSize: 13,
    color: '#444',
    marginTop: 4,
  },
});

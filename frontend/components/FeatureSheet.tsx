import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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

  const statusKey =
    selection.type === 'outfall'
      ? (p.status ?? 'unknown')
      : selection.hasAlert
        ? 'illegal'
        : 'legal';
  const statusText =
    selection.type === 'outfall'
      ? STATUS_LABELS[p.status ?? 'unknown']
      : selection.hasAlert
        ? 'Alerta de cierre activa'
        : 'Sin alertas activas';

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

      <View style={[styles.chip, { backgroundColor: STATUS_COLORS[statusKey] }]}>
        <Text style={styles.chipText}>{statusText}</Text>
      </View>

      {p.kind ? <Text style={styles.row}>Tipo: {p.kind}</Text> : null}
      {p.municipality ? (
        <Text style={styles.row}>Municipio: {p.municipality}</Text>
      ) : null}
      {selection.type === 'outfall' ? (
        <Text style={styles.row}>
          Fuente: Censo de Vertidos 2025 (Gob. Canarias)
        </Text>
      ) : (
        <Text style={styles.row}>
          Fuente: Censo Zonas de Baño 2025 (MITECO)
        </Text>
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

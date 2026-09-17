import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  BeachIncident,
  BeachMeasurement,
  fetchBeachIncidents,
  fetchBeachQuality,
} from '../lib/api';
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

// Estado de playa: usa properties.status (de /beaches + /alerts)
const BEACH_STATUS: Record<string, { label: string; color: string }> = {
  closed: { label: 'Cierre activo', color: '#c62828' },
  warning: { label: 'Aviso activo', color: '#e65100' },
  unknown: { label: 'Sin datos oficiales', color: '#9e9e9e' },
  open: { label: 'Sin alertas activas', color: '#0288d1' },
};

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
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
  const unmonitored = isBeach && p.monitored === false;

  const [incidents, setIncidents] = useState<BeachIncident[] | null>(null);
  const [quality, setQuality] = useState<BeachMeasurement[] | null>(null);

  useEffect(() => {
    setIncidents(null);
    setQuality(null);
    if (!isBeach || p.monitored === false) return; // sin datos oficiales
    fetchBeachIncidents(feature.id)
      .then(setIncidents)
      .catch(() => setIncidents([]));
    fetchBeachQuality(feature.id)
      .then(setQuality)
      .catch(() => setQuality([]));
  }, [isBeach, feature.id, p.monitored]);

  const beachKey =
    isBeach && selection.hasAlert && p.status === 'open'
      ? 'warning'
      : (p.status ?? 'unknown');
  const statusKey = isBeach ? beachKey : (p.status ?? 'unknown');
  const statusText = unmonitored
    ? 'Sin monitorización oficial'
    : isBeach
      ? (BEACH_STATUS[beachKey]?.label ?? 'Sin datos oficiales')
      : STATUS_LABELS[statusKey];
  const statusColor = unmonitored
    ? '#9e9e9e'
    : isBeach
      ? (BEACH_STATUS[beachKey]?.color ?? '#9e9e9e')
      : STATUS_COLORS[statusKey];

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

      <View style={[styles.chip, { backgroundColor: statusColor }]}>
        <Text style={styles.chipText}>{statusText}</Text>
      </View>

      {p.kind ? <Text style={styles.row}>Tipo: {p.kind}</Text> : null}
      {p.municipality ? (
        <Text style={styles.row}>Municipio: {p.municipality}</Text>
      ) : null}
      {unmonitored ? (
        <Text style={styles.row}>
          Playa sin controles sanitarios oficiales. Fuente: OpenStreetMap
          (© colaboradores OSM)
        </Text>
      ) : isBeach ? (
        <Text style={styles.row}>
          Fuente: Censo Zonas de Baño 2025 (MITECO) · Incidencias: Náyade
          (Min. Sanidad)
        </Text>
      ) : (
        <Text style={styles.row}>
          Fuente: Censo de Vertidos 2025 (Gob. Canarias)
        </Text>
      )}

      {isBeach && quality !== null && quality.length > 0 && (
        <View style={styles.history}>
          <Text style={styles.historyTitle}>
            Último análisis ({fmtDate(quality[0].sampled_at)})
          </Text>
          <Text style={styles.incidentObs}>
            E. coli: {quality[0].ecoli ?? '—'} · Enterococo:{' '}
            {quality[0].enterococci ?? '—'}
          </Text>
          {quality[0].evaluation ? (
            <Text style={styles.incidentObs}>
              Evaluación: {quality[0].evaluation}
            </Text>
          ) : null}
        </View>
      )}

      {isBeach && incidents !== null && incidents.length > 0 && (
        <View style={styles.history}>
          <Text style={styles.historyTitle}>
            Historial de incidencias ({incidents.length})
          </Text>
          <ScrollView style={styles.historyList} nestedScrollEnabled>
            {incidents.map((inc) => (
              <View key={inc.id} style={styles.incident}>
                <Text style={styles.incidentDates}>
                  {fmtDate(inc.opened_at)} →{' '}
                  {inc.closed_at ? fmtDate(inc.closed_at) : 'activo'}
                </Text>
                {inc.observations ? (
                  <Text style={styles.incidentObs}>{inc.observations}</Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
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
  history: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 8,
  },
  historyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#222',
    marginBottom: 4,
  },
  historyList: {
    maxHeight: 140,
  },
  incident: {
    paddingVertical: 4,
  },
  incidentDates: {
    fontSize: 12,
    fontWeight: '600',
    color: '#555',
  },
  incidentObs: {
    fontSize: 12,
    color: '#777',
  },
});

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { BeachMeasurement } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import {
  QUALITY_THRESHOLDS,
  classifyValue,
  type ChartPoint,
  type QualityParam,
  type SampleNote,
} from '../../lib/quality';
import { colors, fonts } from '../../lib/theme';
import QualityChart from './QualityChart';

type QualityCardProps = {
  quality: BeachMeasurement[];
  beachKey: string;
  sampleNote: SampleNote | null;
  chartData: ChartPoint[];
  chartParam: QualityParam;
  onChangeChartParam: (param: QualityParam) => void;
  chartW: number;
  onChartWidth: (width: number) => void;
  incidentRanges: { from: string; to: string }[];
};

// Última muestra (E. coli / enterococo frente al límite), notas de
// muestreo y gráfica de evolución
export default function QualityCard({
  quality,
  beachKey,
  sampleNote,
  chartData,
  chartParam,
  onChangeChartParam,
  chartW,
  onChartWidth,
  incidentRanges,
}: QualityCardProps) {
  return (
    <View style={styles.qualityCard}>
      <Text style={styles.historyTitle}>
        Calidad del agua · {fmtDate(quality[0].sampled_at)}
      </Text>
      {(['ecoli', 'enterococci'] as const).map((param) => {
        const raw = quality[0][param];
        const info = classifyValue(param, raw);
        return (
          <View key={param} style={styles.paramRow}>
            <Text style={styles.paramLabel}>
              {QUALITY_THRESHOLDS[param].label}
            </Text>
            <View style={styles.paramRight}>
              <Text style={styles.paramValue}>{raw ?? '—'}</Text>
              {info && (
                <>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          width: `${Math.min(info.pct, 100)}%`,
                          backgroundColor: info.color,
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.paramClass, { color: info.color }]}>
                    {info.cls} · {info.pct}% del límite
                  </Text>
                </>
              )}
            </View>
          </View>
        );
      })}
      {beachKey === 'open' &&
      /prohib|calificar/i.test(quality[0].evaluation ?? '') ? (
        <Text style={styles.staleNote}>
          El incidente oficial ya está cerrado · pendiente de nueva muestra
        </Text>
      ) : null}
      {sampleNote ? (
        <Text
          style={sampleNote.anomalous ? styles.gapNoteAnomaly : styles.gapNote}
        >
          {sampleNote.text}
        </Text>
      ) : null}

      {chartData.length >= 2 && (
        <QualityChart
          chartData={chartData}
          chartParam={chartParam}
          onChangeParam={onChangeChartParam}
          chartW={chartW}
          onChartWidth={onChartWidth}
          incidentRanges={incidentRanges}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  historyTitle: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: colors.text,
    marginBottom: 4,
  },
  qualityCard: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  paramRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 8,
  },
  paramLabel: {
    width: 86,
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
  },
  paramRight: {
    flex: 1,
  },
  paramValue: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  barTrack: {
    height: 5,
    backgroundColor: colors.border,
    borderRadius: 3,
    marginTop: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: 5,
    borderRadius: 3,
  },
  paramClass: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    marginTop: 1,
  },
  staleNote: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 4,
  },
  // Hueco de muestreo esperado (calendario de la playa): ámbar
  gapNote: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: colors.status.warning,
    marginTop: 4,
  },
  // Hueco anómalo (Sanidad dejó de medirla en periodo normal): rojo
  gapNoteAnomaly: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: colors.danger,
    marginTop: 4,
  },
});

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import {
  CHART_H,
  QUALITY_THRESHOLDS,
  barH,
  type ChartPoint,
  type QualityParam,
} from '../../lib/quality';
import { colors, fonts } from '../../lib/theme';
import ScrollChips from '../ScrollChips';

type QualityChartProps = {
  chartData: ChartPoint[];
  chartParam: QualityParam;
  onChangeParam: (param: QualityParam) => void;
  // Ancho medido de la card (0 hasta el primer onLayout)
  chartW: number;
  onChartWidth: (width: number) => void;
  incidentRanges: { from: string; to: string }[];
};

// Gráfica de evolución: barras log-escala por muestreo + límite
// normativo + marcas de incidentes
export default function QualityChart({
  chartData,
  chartParam,
  onChangeParam,
  chartW,
  onChartWidth,
  incidentRanges,
}: QualityChartProps) {
  // Ancho de columna: repartir el ancho de la card entre las muestras;
  // mínimo 8px — si hay muchas, sigue habiendo scroll horizontal
  const colW =
    chartW > 0 && chartData.length > 0
      ? Math.max(8, chartW / chartData.length)
      : 8;

  // Índice de la última etiqueta de año: siempre se muestra aunque su
  // año tenga pocas barras (no hay etiqueta siguiente con la que solape)
  const lastYearIdx = chartData.reduce(
    (acc, d, i) => (d.yearLabel ? i : acc),
    -1,
  );

  return (
    <View
      style={styles.chartBlock}
      onLayout={(e) => onChartWidth(e.nativeEvent.layout.width)}
    >
      <View style={styles.chartHead}>
        <View style={styles.secHead}>
          <Ionicons
            name="stats-chart"
            size={20}
            color="#7e57c2"
            style={[styles.secVectorIcon, { marginBottom: 4.6 }]}
          />
          <Text style={styles.secCardTitle}>Evolución</Text>
        </View>
        <View style={styles.chartToggle}>
          {(['ecoli', 'enterococci'] as const).map((param) => (
            <Pressable
              key={param}
              onPress={() => onChangeParam(param)}
              style={({ pressed }) => [
                styles.toggleChip,
                chartParam === param && styles.toggleChipOn,
                pressed && styles.pressFx,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Ver evolución de ${QUALITY_THRESHOLDS[param].label}`}
              accessibilityState={{
                selected: chartParam === param,
              }}
            >
              <Text
                style={[
                  styles.toggleChipText,
                  chartParam === param && styles.toggleChipTextOn,
                ]}
              >
                {QUALITY_THRESHOLDS[param].label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <ScrollChips fadeRgb="255, 255, 255" a11yLabel="la gráfica" anchorEnd>
        <View style={styles.chartInner}>
          <View style={styles.chartArea}>
            <View
              style={[
                styles.limitLine,
                {
                  bottom: barH(QUALITY_THRESHOLDS[chartParam].good),
                },
              ]}
            />
            {chartData.map((d, i) => {
              const t = QUALITY_THRESHOLDS[chartParam];
              const color =
                d.value <= t.excellent
                  ? colors.status.open
                  : d.value <= t.good
                    ? colors.outfall.unknown
                    : colors.status.closed;
              return (
                <View
                  key={i}
                  style={[styles.barCol, { width: colW, marginRight: 0 }]}
                >
                  <View
                    style={[
                      styles.bar,
                      {
                        height: barH(d.value),
                        width: Math.max(3, colW - 2),
                        backgroundColor: color,
                      },
                    ]}
                  />
                </View>
              );
            })}
            {(() => {
              const first = Date.parse(chartData[0].date);
              const last = Date.parse(chartData[chartData.length - 1].date);
              const span = Math.max(last - first, 1);
              return incidentRanges.map((r, i) => {
                const pos = Math.min(
                  1,
                  Math.max(0, (Date.parse(r.from) - first) / span),
                );
                return (
                  <View
                    key={i}
                    style={[
                      styles.incidentTick,
                      {
                        left: Math.round(pos * (chartData.length - 1) * colW),
                      },
                    ]}
                  />
                );
              });
            })()}
          </View>
          <View style={styles.yearRow}>
            {chartData.map((d, i) => (
              <View key={i} style={[styles.yearCol, { width: colW }]}>
                {d.yearLabel &&
                (d.yearSpan * colW >= 30 || i === lastYearIdx) ? (
                  <Text style={styles.yearText} numberOfLines={1}>
                    {d.yearLabel}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      </ScrollChips>
      <Text style={styles.chartFoot}>
        {chartData.length} muestreos · cada barra = un análisis oficial · línea
        azul = límite normativo ({QUALITY_THRESHOLDS[chartParam].good} UFC/100
        mL)
        {incidentRanges.length > 0 ? ' · línea roja = cierre/aviso' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Feedback táctil común: leve fundido al presionar
  pressFx: {
    opacity: 0.6,
  },
  secHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 7,
    marginBottom: 2,
  },
  // Misma corrección que secIcon para los Ionicons (no usan secIcon)
  secVectorIcon: {
    marginBottom: 3,
  },
  secCardTitle: {
    fontSize: 15,
    fontFamily: fonts.extrabold,
    color: colors.primaryDark,
  },
  chartBlock: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  chartHead: {
    alignItems: 'center',
  },
  chartToggle: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
    marginBottom: 4,
  },
  toggleChip: {
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  toggleChipOn: {
    backgroundColor: 'rgba(23,184,206,0.18)',
    borderColor: colors.accent,
  },
  toggleChipText: {
    fontSize: 10,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
  },
  toggleChipTextOn: {
    color: colors.primaryDark,
  },
  chartArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: CHART_H,
    marginTop: 4,
    paddingRight: 4,
  },
  limitLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.primaryDark,
    opacity: 0.85,
  },
  chartInner: {
    paddingLeft: 8,
  },
  yearRow: {
    flexDirection: 'row',
    marginTop: 2,
    height: 22,
    paddingRight: 34,
  },
  yearCol: {
    width: 8,
    alignItems: 'flex-start',
  },
  yearText: {
    position: 'absolute',
    left: 2,
    top: 0,
    width: 34,
    fontSize: 8,
    fontFamily: fonts.semibold,
    color: colors.textFaint,
    transform: [{ rotate: '45deg' }],
    transformOrigin: 'left top',
  },
  barCol: {
    justifyContent: 'flex-end',
    height: CHART_H,
    marginRight: 2,
  },
  bar: {
    width: 6,
    borderRadius: 2,
  },
  incidentTick: {
    position: 'absolute',
    top: 0,
    bottom: -5,
    width: 1.5,
    backgroundColor: colors.status.closed,
    opacity: 0.75,
  },
  chartFoot: {
    fontSize: 10,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 4,
  },
});

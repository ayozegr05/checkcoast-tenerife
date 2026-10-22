import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import {
  CHART_H,
  QUALITY_THRESHOLDS,
  barH,
  valueColor,
  type ChartPoint,
  type QualityParam,
  type SampleNote,
} from '../../lib/quality';
import { colors, fonts } from '../../lib/theme';
import { fmtDate } from '../../lib/format';
import ScrollChips from '../ScrollChips';

type QualityChartProps = {
  chartData: ChartPoint[];
  chartParam: QualityParam;
  onChangeParam: (param: QualityParam) => void;
  // Ancho medido de la card (0 hasta el primer onLayout)
  chartW: number;
  onChartWidth: (width: number) => void;
  incidentRanges: { from: string; to: string; label: string }[];
  // Nota de huecos de muestreo — va a pie de gráfica: explica los
  // tramos vacíos justo donde se ven
  sampleNote: SampleNote | null;
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
  sampleNote,
}: QualityChartProps) {
  // Franja seleccionada al tocar: muestra sus fechas bajo el eje —
  // el "tooltip" táctil. Toggle: mismo índice deselecciona
  const [sel, setSel] = useState<number | null>(null);
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
            {(() => {
              const first = Date.parse(chartData[0].date);
              const last = Date.parse(chartData[chartData.length - 1].date);
              const span = Math.max(last - first, 1);
              const toX = (pos: number) =>
                Math.round(pos * (chartData.length - 1) * colW);
              // Franja por incidente [from→to] antes de las barras:
              // queda de fondo y el tramo cerrado se lee de un vistazo
              // — también explica los huecos sin muestras. La caja
              // tocable es más ancha que la franja (hay tramos de 1-3px)
              return incidentRanges.map((r, i) => {
                const from = Math.min(
                  1,
                  Math.max(0, (Date.parse(r.from) - first) / span),
                );
                const to = Math.min(
                  1,
                  Math.max(0, (Date.parse(r.to) - first) / span),
                );
                // Fuera del rango de muestreo por completo → no dibujar
                // (un borde 3px inventaría un cierre en el eje)
                if (to <= 0 || from >= 1) return null;
                const w = Math.max(3, toX(to) - toX(from));
                return (
                  <Pressable
                    key={i}
                    onPress={() => setSel(sel === i ? null : i)}
                    style={[
                      styles.bandHit,
                      { left: toX(from) - 8, width: w + 16 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Episodio ${fmtDate(r.from)}`}
                  >
                    <View
                      style={[
                        styles.incidentBand,
                        { left: 8, width: w },
                        sel === i && styles.incidentBandSel,
                      ]}
                    />
                  </Pressable>
                );
              });
            })()}
            {chartData.map((d, i) => {
              const color = valueColor(chartParam, d.value);
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
            {/* Último: la línea del límite corona la gráfica — por
                encima de barras y franjas, discontinua como la web */}
            <View
              style={[
                styles.limitLine,
                {
                  bottom: barH(QUALITY_THRESHOLDS[chartParam].good),
                },
              ]}
            />
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
      {sel !== null && incidentRanges[sel]
        ? (() => {
            const r = incidentRanges[sel];
            const end =
              r.to === '9999-12-31'
                ? new Date().toISOString().slice(0, 10)
                : r.to;
            // Días inclusive: el episodio del 28/09 al 07/10 son 10
            const days =
              Math.round((Date.parse(end) - Date.parse(r.from)) / 86400000) + 1;
            return (
              <Text style={styles.bandCaption}>
                {fmtDate(r.from)} →{' '}
                {r.to === '9999-12-31' ? 'hoy' : fmtDate(r.to)} · {days}{' '}
                {days === 1 ? 'día' : 'días'} · {r.label}
              </Text>
            );
          })()
        : null}
      {sampleNote ? (
        <Text
          style={sampleNote.anomalous ? styles.gapNoteAnomaly : styles.gapNote}
        >
          {sampleNote.text}
        </Text>
      ) : null}
      <Text style={styles.chartFoot}>
        {chartData.length} muestreos · barras:{' '}
        <Text style={{ color: colors.status.open }}>■</Text> apta ·{' '}
        <Text style={{ color: colors.outfall.unknown }}>■</Text> al límite ·{' '}
        <Text style={{ color: colors.status.closed }}>■</Text> no apta ·{' '}
        <Text style={{ color: colors.primaryDark }}>┄</Text> límite normativo (
        {QUALITY_THRESHOLDS[chartParam].good} UFC/100 mL)
        {incidentRanges.length > 0 ? (
          <>
            {' · '}
            {/* Mismo rojo que la franja (velo al ~15%): el cuadrito
                sólido repetía el de "no apta" */}
            <Text style={{ color: `${colors.status.closed}26` }}>■</Text>
            {' franja = cierre/aviso'}
          </>
        ) : null}
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
    height: 0,
    borderTopWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.primaryDark,
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
  // Caja tocable: más ancha que la franja visible (hay tramos de
  // 1-3px intocables); dentro va la franja centrada (left:8)
  bandHit: {
    position: 'absolute',
    top: 0,
    bottom: -5,
  },
  incidentBand: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: 2,
    backgroundColor: colors.status.closed,
    // Velo tenue: cubre barras/huecos sin taparlos; dos franjas
    // solapadas se oscurecen entre sí, lo cual informa (solape real)
    opacity: 0.16,
  },
  incidentBandSel: {
    opacity: 0.4,
  },
  // "Tooltip" táctil: fechas de la franja tocada bajo el eje
  bandCaption: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: colors.text,
    marginTop: 6,
  },
  chartFoot: {
    // gris un punto más oscuro que el resto de notas: es leyenda,
    // no ruido de fondo
    fontSize: 10,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 4,
  },
  // Hueco de muestreo esperado (calendario de la playa): ámbar
  gapNote: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: colors.status.warning,
    marginTop: 6,
  },
  // Hueco anómalo (Sanidad dejó de medirla en periodo normal): rojo
  gapNoteAnomaly: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: colors.danger,
    marginTop: 6,
  },
});

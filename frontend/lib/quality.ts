import type { BeachMeasurement } from './api';
import { MONTHS_FULL, fmtPartialDate } from './format';
import { colors } from './theme';

export type QualityParam = 'ecoli' | 'enterococci';

// Umbrales RD 1341/2007 (aguas costeras), UFC/100 mL:
// [excelente, buena] — por encima de "buena" es insuficiente/mala
export const QUALITY_THRESHOLDS: Record<
  QualityParam,
  { excellent: number; good: number; label: string }
> = {
  ecoli: { excellent: 250, good: 500, label: 'E. coli' },
  enterococci: { excellent: 100, good: 200, label: 'Enterococo' },
};

export const classifyValue = (param: QualityParam, raw: string | null) => {
  const value = parseFloat(raw ?? '');
  if (Number.isNaN(value)) return null;
  const t = QUALITY_THRESHOLDS[param];
  const cls =
    value <= t.excellent
      ? 'Excelente'
      : value <= t.good
        ? 'Buena'
        : 'Insuficiente';
  const color =
    cls === 'Excelente'
      ? colors.status.open
      : cls === 'Buena'
        ? colors.outfall.unknown
        : colors.status.closed;
  const pct = Math.round((value / t.good) * 100);
  return { value, cls, color, pct };
};

// Valores tipo "<10" o ">24000 UFC/100 mL": quitar solo el prefijo no
// numérico y parseFloat se queda con el número (no quitar dígitos de la
// unidad "100 mL" — inflaría el valor ×1000)
export const numValue = (raw: string | null) => {
  const v = parseFloat((raw ?? '').replace(/^[^\d.]*/, ''));
  return Number.isNaN(v) ? null : v;
};

// Gráfica de evolución: barras log-escala (los valores van de <1 a
// >24000 UFC/100 mL) coloreadas por clase + línea del límite normativo
export const CHART_H = 88;
export const LOG_CAP = 100000;
export const barH = (v: number) =>
  Math.max(
    3,
    Math.round((CHART_H * Math.log10(Math.max(v, 1))) / Math.log10(LOG_CAP)),
  );

export type ChartPoint = {
  date: string;
  value: number;
  yearLabel: string | null;
  yearSpan: number;
};

// Serie temporal para la grafica: mas antigua primero, solo valores
// parseables (descarta "—" y filas sin medicion del parametro)
export function buildChartSeries(
  quality: BeachMeasurement[] | null,
  param: QualityParam,
): ChartPoint[] {
  if (!quality) return [];
  const rows = [...quality]
    .reverse()
    .map((m) => ({ date: m.sampled_at, value: numValue(m[param]) }))
    .filter((d): d is { date: string; value: number } => d.value !== null);
  // Etiqueta de año bajo la primera barra de cada año; yearSpan =
  // barras del año para decidir si la etiqueta cabe sin solaparse
  let lastYear = '';
  return rows.map((d, i) => {
    const year = d.date.slice(0, 4);
    const yearLabel = year !== lastYear ? year : null;
    lastYear = year;
    let yearSpan = 0;
    if (yearLabel) {
      for (let j = i; j < rows.length; j++) {
        if (rows[j].date.slice(0, 4) !== year) break;
        yearSpan++;
      }
    }
    return { ...d, yearLabel, yearSpan };
  });
}

export type SampleNote = { text: string; anomalous: boolean };

// Huecos de muestreo >45 días entre muestras consecutivas (o desde la
// última hasta hoy). Se distinguen dos casos:
//  - anómalo: el hueco cubre meses en los que la playa SÍ suele tener
//    muestras (Jardín jul-24→ene-25) → aviso ámbar
//  - parada anual: el hueco solo cubre meses que nunca se muestrean
//    (régimen estacional o parada navideña) → nota tenue declarando
//    el calendario real de Sanidad para esa playa
export function samplingNote(
  quality: BeachMeasurement[] | null,
  today: string = new Date().toISOString().slice(0, 10),
): SampleNote | null {
  if (!quality || quality.length < 2) return null;
  const dates = quality.map((m) => m.sampled_at).sort();
  const sampledMonths = new Set(dates.map((d) => Number(d.slice(5, 7))));
  const gaps: { a: string; b: string; open: boolean }[] = [];
  for (let i = 1; i < dates.length; i++) {
    if ((Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86400000 > 45) {
      gaps.push({ a: dates[i - 1], b: dates[i], open: false });
    }
  }
  const last = dates[dates.length - 1];
  if ((Date.parse(today) - Date.parse(last)) / 86400000 > 45) {
    gaps.push({ a: last, b: today, open: true });
  }
  if (!gaps.length) return null;
  // Meses estrictamente dentro del hueco (pueden envolver el año)
  const interiorMonths = (a: string, b: string) => {
    const res: number[] = [];
    let y = Number(a.slice(0, 4));
    let m = Number(a.slice(5, 7)) + 1;
    const by = Number(b.slice(0, 4));
    const bm = Number(b.slice(5, 7));
    if (m > 12) {
      m = 1;
      y += 1;
    }
    while (y < by || (y === by && m < bm)) {
      res.push(m);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return res;
  };
  const anomalous = gaps.filter((g) =>
    interiorMonths(g.a, g.b).some((m) => sampledMonths.has(m)),
  );
  if (anomalous.length) {
    // "jul 2024" (con espacio) en los huecos reales
    const my = (iso: string) =>
      fmtPartialDate(iso.slice(0, 7)).replace('-', ' ');
    const parts = anomalous.map((g) =>
      g.open ? `desde ${my(g.a)}` : `entre ${my(g.a)} y ${my(g.b)}`,
    );
    return {
      text: `Anomalía: sin muestras ${parts.join(' · ')}`,
      anomalous: true,
    };
  }
  const longest = gaps.reduce((x, y) =>
    Date.parse(y.b) - Date.parse(y.a) > Date.parse(x.b) - Date.parse(x.a)
      ? y
      : x,
  );
  return {
    text:
      `Sanidad deja de muestrearla cada año entre ` +
      `${MONTHS_FULL[Number(longest.a.slice(5, 7)) - 1]} y ` +
      MONTHS_FULL[Number(longest.b.slice(5, 7)) - 1],
    anomalous: false,
  };
}

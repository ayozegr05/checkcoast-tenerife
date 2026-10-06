// Resumen determinista del "por qué" según prensa (banner de la ficha
// y cabecera de la card "En la prensa"). Sin llamadas LLM: usa el
// agregado que ya calcula el backend en /beaches/{id}/news.

import type { BeachNewsSummary } from './api';
import { fmtDate, fmtPartialDate, formatDays } from './format';

// Línea-resumen: motivo primero, fecha del primer titular, atribución
// abajo — "Cerrada por riesgo de desprendimientos · desde el 03/06".
// Si el cierre ya pasó (oficial open o incidente con closed_at
// posterior = mismo episodio resuelto) se habla en pasado
const NEWS_EVENT_LINE: Record<string, [string, string, string]> = {
  closure: ['Cerrada', 'por', 'desde el'],
  reopening: ['Reapertura', 'tras', 'el'],
  warning: ['Aviso', 'por', 'desde el'],
  pollution: ['Contaminación', 'por', 'el'],
  other: ['Noticias', 'sobre', 'el'],
};

export const pressSummary = (
  s: BeachNewsSummary,
  opts: {
    stillClosed: boolean;
    reopenedAt: string | null;
    now?: Date;
    // El episodio es de un PM hermano del arenal ("PM4") — este
    // punto no registró cierre; el banner nombra al hermano en
    // lenguaje llano ("la zona 4")
    siblingPm?: string | null;
  },
) => {
  const [noun, prep, dmark] = NEWS_EVENT_LINE[s.event_type ?? 'other'] ?? [
    'Noticias',
    'sobre',
    'el',
  ];
  // "PM4" → "zona 4" — nunca exponemos la sigla interna
  const pmShort = opts.siblingPm
    ? `zona ${opts.siblingPm.replace(/^PM/i, '')}`
    : null;
  const medios =
    s.outlets_count === 1 ? '1 medio' : `${s.outlets_count} medios`;
  const isClosure = s.event_type === 'closure';
  // Reapertura reciente (≤7 días): el protagonista es la reapertura,
  // no el cierre — el usuario acaba de recibir el push de reapertura
  const reopenedDays =
    !opts.stillClosed && opts.reopenedAt
      ? ((opts.now?.getTime() ?? Date.now()) -
          new Date(`${opts.reopenedAt}T00:00:00Z`).getTime()) /
        86_400_000
      : null;
  if (isClosure && reopenedDays !== null && reopenedDays <= 7) {
    // "estuvo cerrada desde el 23/09/2026" — con closed_since
    // parcial es "desde jul-2024" / "desde 2024" (sin "el")
    const closedFor =
      s.closed_since && s.closed_since.length < 10
        ? `desde ${fmtPartialDate(s.closed_since)}`
        : s.closed_since || s.since
          ? `desde el ${fmtDate((s.closed_since || s.since!).slice(0, 10))}`
          : null;
    // Cuánto estuvo cerrada: con inicio parcial es aproximado ("~")
    const startRaw = s.closed_since || s.since;
    const startIso = startRaw
      ? startRaw.length === 4
        ? `${startRaw}-01-01`
        : startRaw.length === 7
          ? `${startRaw}-01`
          : startRaw.slice(0, 10)
      : null;
    const dur = startIso
      ? ` · ~${formatDays(Math.max(1, Math.round((Date.parse(opts.reopenedAt!.slice(0, 10)) - Date.parse(startIso)) / 86_400_000)))}`
      : '';
    return {
      main: pmShort
        ? `La ${pmShort} reabrió el ${fmtDate(opts.reopenedAt!.slice(0, 10))}`
        : `Reabierta el ${fmtDate(opts.reopenedAt!.slice(0, 10))}`,
      sub:
        `según prensa · ${medios}` +
        (closedFor ? ` · estuvo cerrada ${closedFor}${dur}` : ''),
      tone: 'reopened' as const,
    };
  }
  const shownNoun = isClosure && !opts.stillClosed ? 'Estuvo cerrada' : noun;
  // closed_since: inicio real afirmado por el texto ("cerrada desde
  // julio de 2024"), ISO parcial — gana a `since` (fecha de cobertura)
  // y se muestra con su precisión real: "desde jul-2024", "desde 2024"
  const sinceText = s.closed_since
    ? fmtPartialDate(s.closed_since)
    : s.since
      ? fmtDate(s.since.slice(0, 10))
      : null;
  const sinceIsPartial = !!s.closed_since && s.closed_since.length < 10;
  // Inicio del episodio como día ISO: con precisión parcial se asume
  // el día 1 y el conteo se marca con "~" (no inventamos día exacto)
  const startRaw = s.closed_since || s.since;
  const startIso = startRaw
    ? startRaw.length === 4
      ? `${startRaw}-01-01`
      : startRaw.length === 7
        ? `${startRaw}-01`
        : startRaw.slice(0, 10)
    : null;
  const daySpan = (a: string, b: string) =>
    Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000));
  const approx = sinceIsPartial ? '~' : '';
  const todayIso = (opts.now ?? new Date()).toISOString().slice(0, 10);

  // Cierre: el "cuánto duró" es parte del titular — rango completo +
  // días en una segunda línea; la atribución queda abajo
  if (isClosure) {
    // Episodio adjudicado a un punto hermano: el sujeto es él, no la
    // playa — "La zona 4 estuvo cerrada por…"
    const nounTxt = pmShort
      ? `La ${pmShort} ${opts.stillClosed ? 'sigue cerrada' : 'estuvo cerrada'}${s.cause ? ` ${prep} ${s.cause}` : ''}`
      : `${shownNoun}${s.cause ? ` ${prep} ${s.cause}` : ''}`;
    if (opts.stillClosed) {
      const line2 = startIso
        ? `desde ${sinceIsPartial ? '' : 'el '}${sinceText} · lleva ` +
          `${approx}${formatDays(daySpan(startIso, todayIso))}`
        : '';
      return {
        main: `${nounTxt}${line2 ? `\n${line2}` : ''}`,
        sub: `según prensa · ${medios}`,
        tone: 'default' as const,
      };
    }
    if (opts.reopenedAt && startIso) {
      const end = opts.reopenedAt.slice(0, 10);
      return {
        main:
          `${nounTxt}\n` +
          `del ${fmtDate(startIso)} al ${fmtDate(end)} · ` +
          `${approx}${formatDays(daySpan(startIso, end))}`,
        sub: `según prensa · ${medios}`,
        tone: 'default' as const,
      };
    }
    // Episodio caducado sin reapertura registrada: sin fin, sin días
    const date = sinceText
      ? ` · ${sinceIsPartial ? 'desde' : 'el'} ${sinceText}`
      : '';
    return {
      main: `${nounTxt}${date}`,
      sub: `según prensa · ${medios}`,
      tone: 'default' as const,
    };
  }
  const date = sinceText ? ` · ${dmark} ${sinceText}` : '';
  const genericMain = pmShort
    ? `${shownNoun} en la ${pmShort}${s.cause ? ` ${prep} ${s.cause}` : ''}`
    : `${shownNoun}${s.cause ? ` ${prep} ${s.cause}` : ''}`;
  return {
    main: `${genericMain}${date}`,
    sub: `según prensa · ${medios}`,
    tone: 'default' as const,
  };
};

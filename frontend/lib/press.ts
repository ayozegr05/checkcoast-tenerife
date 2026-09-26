// Resumen determinista del "por qué" según prensa (banner de la ficha
// y cabecera de la card "En la prensa"). Sin llamadas LLM: usa el
// agregado que ya calcula el backend en /beaches/{id}/news.

import type { BeachNewsSummary } from './api';
import { fmtDate, fmtPartialDate } from './format';

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
  opts: { stillClosed: boolean; reopenedAt: string | null; now?: Date },
) => {
  const [noun, prep, dmark] = NEWS_EVENT_LINE[s.event_type ?? 'other'] ?? [
    'Noticias',
    'sobre',
    'el',
  ];
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
    return {
      main: `Reabierta el ${fmtDate(opts.reopenedAt!.slice(0, 10))}`,
      sub:
        `según prensa · ${medios}` +
        (closedFor ? ` · estuvo cerrada ${closedFor}` : ''),
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
  const sinceIsPartial =
    !!s.closed_since && s.closed_since.length < 10;
  let date = '';
  if (isClosure && !opts.stillClosed) {
    // Pasado: "el 21/08" — fecha exacta; con precisión parcial sigue
    // siendo "desde jul-2024" ("el jul-2024" no se dice)
    date = sinceText
      ? ` · ${sinceIsPartial ? 'desde' : 'el'} ${sinceText}`
      : '';
  } else {
    date = sinceText
      ? ` · ${sinceIsPartial ? 'desde' : dmark} ${sinceText}`
      : '';
  }
  // Sanidad registró la reapertura de ese mismo episodio
  const reopen = opts.reopenedAt
    ? ` · Sanidad la reabrió el ${fmtDate(opts.reopenedAt)}`
    : '';
  return {
    main: `${shownNoun}${s.cause ? ` ${prep} ${s.cause}` : ''}${date}`,
    sub: `según prensa · ${medios}${reopen}`,
    tone: 'default' as const,
  };
};

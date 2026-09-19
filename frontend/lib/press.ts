// Resumen determinista del "por qué" según prensa (banner de la ficha
// y cabecera de la card "En la prensa"). Sin llamadas LLM: usa el
// agregado que ya calcula el backend en /beaches/{id}/news.

import type { BeachNewsSummary } from './api';
import { fmtDate } from './format';

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
  opts: { stillClosed: boolean; reopenedAt: string | null },
) => {
  const [noun, prep, dmark] = NEWS_EVENT_LINE[s.event_type ?? 'other'] ?? [
    'Noticias',
    'sobre',
    'el',
  ];
  const medios =
    s.outlets_count === 1 ? '1 medio' : `${s.outlets_count} medios`;
  const isClosure = s.event_type === 'closure';
  const shownNoun = isClosure && !opts.stillClosed ? 'Estuvo cerrada' : noun;
  let date = '';
  if (isClosure && !opts.stillClosed) {
    // Pasado: "el 21/08" (no "desde" — ya no está cerrada)
    date = s.since ? ` · el ${fmtDate(s.since.slice(0, 10))}` : '';
  } else {
    date = s.since ? ` · ${dmark} ${fmtDate(s.since.slice(0, 10))}` : '';
  }
  // Sanidad registró la reapertura de ese mismo episodio
  const reopen = opts.reopenedAt
    ? ` · Sanidad la reabrió el ${fmtDate(opts.reopenedAt)}`
    : '';
  return {
    main: `${shownNoun}${s.cause ? ` ${prep} ${s.cause}` : ''}${date}`,
    sub: `según prensa · ${medios}${reopen}`,
  };
};

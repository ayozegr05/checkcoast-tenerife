// Agrupado y etiquetado de titulares de prensa por fase del episodio
// (banner de la ficha e historial de incidencias). Puro: sin React.

import type { BeachNews } from './api';
import { colors } from './theme';

// Tipos de evento extraídos de prensa por el LLM (Hito 8.5)
export const NEWS_EVENT_LABELS: Record<string, string> = {
  closure: 'Cierre',
  reopening: 'Reapertura',
  warning: 'Aviso',
  pollution: 'Contaminación',
  other: 'Noticia',
};

// Fases de un episodio en orden narrativo: se cerró, hubo avisos o
// vertidos, y finalmente se reabrió
export const NEWS_GROUP_ORDER = [
  'closure',
  'warning',
  'pollution',
  'reopening',
  'other',
];

// Temas de la causa agrupados por familia. La especificidad decide la
// etiqueta del episodio: dentro de una familia gana el menor rank
// (parámetro nombrado > parámetro sin nombrar > fuente vaga o
// mecanismo) y a igual rank el más citado, desempatando por el
// titular más reciente. El orden del array fija la precedencia dentro
// de un mismo texto ("desprendimientos" tapa a "obras")
export const NEWS_TOPIC_PATTERNS: {
  key: string;
  family: string;
  rank: number;
  re: RegExp;
  phrase: string;
}[] = [
  {
    key: 'enterococos',
    family: 'bacterias',
    rank: 0,
    re: /enterococ/i,
    phrase: 'niveles elevados de enterococos',
  },
  {
    key: 'ecoli',
    family: 'bacterias',
    rank: 0,
    re: /e\.?\s?coli|escherichia/i,
    phrase: 'niveles elevados de E. coli',
  },
  {
    key: 'bacterias',
    family: 'bacterias',
    rank: 1,
    re: /bacteria|bacteriol|microbiolog/i,
    phrase: 'niveles bacteriológicos elevados',
  },
  {
    key: 'fecal',
    family: 'bacterias',
    rank: 2,
    re: /fecal|residual|depuradora|aguas?\s*sucias/i,
    phrase: 'vertido de aguas fecales',
  },
  {
    key: 'hidrocarburos',
    family: 'quimica',
    rank: 0,
    re: /gasoil|hidrocarbur|diésel|diesel|fuel|petr/i,
    phrase: 'vertido de hidrocarburos',
  },
  {
    key: 'algas',
    family: 'algas',
    rank: 0,
    re: /alga/i,
    phrase: 'presencia de algas',
  },
  {
    key: 'socavacion',
    family: 'fisica',
    rank: 0,
    re: /socav|cavidad|cueva|erosi|hundimiento|colapso/i,
    phrase: 'riesgo de colapso del terreno',
  },
  {
    key: 'desprendimientos',
    family: 'fisica',
    rank: 0,
    re: /desprend|derrumb|talud/i,
    phrase: 'desprendimientos',
  },
  {
    key: 'obras',
    family: 'fisica',
    rank: 1,
    re: /obra|dragado|acceso/i,
    phrase: 'obras',
  },
  {
    key: 'generico',
    family: 'generico',
    rank: 0,
    re: /vertido|contamin|calidad/i,
    phrase: 'mala calidad del agua',
  },
];

// Causas que no son causa (desencadenante del mar o mala extracción):
// nunca se muestran como etiqueta
export const NEWS_NON_CAUSE_RE = /mar agitado|avance del mar|oleaje|marejada/i;

// Claves que aporta un ítem: la primera coincidencia de cada familia —
// en un mismo texto pueden coexistir familias distintas (E. coli +
// gasoil), pero dentro de una familia solo cuenta la más específica
export const newsTopicKeys = (cause: string | null) => {
  if (!cause) return [];
  const seen = new Set<string>();
  return NEWS_TOPIC_PATTERNS.filter((t) => {
    if (seen.has(t.family) || !t.re.test(cause)) return false;
    seen.add(t.family);
    return true;
  });
};

// Frase ganadora del grupo de un episodio: un episodio real tiene una
// sola causa por familia — el resto son paráfrasis de los medios.
// Gana la más específica presente (parámetro > fuente > genérico);
// la mayoría de citas solo desempata al mismo nivel, y tras ella el
// titular más reciente (items llegan ordenados desc por fecha).
// Familias distintas combinan ("E. coli y vertido de hidrocarburos");
// enterococos + E. coli son parámetros hermanos → frase combinada
export const newsGroupPhrase = (
  type: string,
  items: BeachNews[],
): string | null => {
  if (type === 'reopening') return 'mejora la calidad del agua';
  const fams = new Map<
    string,
    Map<string, { count: number; firstIdx: number }>
  >();
  items.forEach((n, i) => {
    for (const t of newsTopicKeys(n.cause)) {
      const fam = fams.get(t.family) ?? new Map();
      const e = fam.get(t.key) ?? { count: 0, firstIdx: i };
      e.count += 1;
      fam.set(t.key, e);
      fams.set(t.family, fam);
    }
  });
  // Con cualquier específico presente, el genérico no compite
  if (fams.size > 1) fams.delete('generico');
  const topic = (key: string) =>
    NEWS_TOPIC_PATTERNS.find((t) => t.key === key)!;
  const phrases: { order: number; phrase: string }[] = [];
  for (const [family, votes] of fams) {
    if (family === 'generico') continue;
    // bacterias con los dos parámetros nombrados → frase combinada
    if (
      family === 'bacterias' &&
      votes.has('enterococos') &&
      votes.has('ecoli')
    ) {
      phrases.push({
        order: 0,
        phrase: 'niveles elevados de enterococos y E. coli',
      });
      continue;
    }
    const [winner] = [...votes.entries()].reduce((a, b) => {
      const [ta, tb] = [topic(a[0]), topic(b[0])];
      if (ta.rank !== tb.rank) return ta.rank < tb.rank ? a : b;
      if (a[1].count !== b[1].count) return a[1].count > b[1].count ? a : b;
      return a[1].firstIdx < b[1].firstIdx ? a : b;
    });
    const t = topic(winner);
    phrases.push({ order: NEWS_TOPIC_PATTERNS.indexOf(t), phrase: t.phrase });
  }
  if (phrases.length > 0) {
    phrases.sort((a, b) => a.order - b.order);
    const ps = phrases.map((p) => p.phrase);
    return ps.length === 1
      ? ps[0]
      : `${ps.slice(0, -1).join(', ')} y ${ps[ps.length - 1]}`;
  }
  if (fams.has('generico')) return 'mala calidad del agua';
  // Sin tema catalogado: la causa cruda más reciente informa mejor
  // que nada — salvo no-causas ("avance del mar" en Punta Larga)
  return (
    items.find((n) => n.cause && !NEWS_NON_CAUSE_RE.test(n.cause))?.cause ??
    null
  );
};

// Color por fase: cierre/contaminación rojo, aviso ámbar, reapertura
// verde — el borde y la flecha del titular siguen la fase
export const NEWS_PHASE_COLOR: Record<string, string> = {
  closure: colors.status.closed,
  pollution: colors.status.closed,
  warning: colors.status.warning,
  reopening: colors.status.open,
  other: colors.status.warning,
};

export type NewsGroup = {
  type: string;
  label: string;
  items: BeachNews[];
};

// Titulares agrupados por fase del episodio, una sola causa ganadora
// por fase ("Cierre · niveles elevados de enterococos"): el episodio
// real tiene una causa y el resto son paráfrasis de los medios
export function groupNewsItems(items: BeachNews[]): NewsGroup[] {
  const byType = new Map<string, BeachNews[]>();
  for (const n of items) {
    const type = n.event_type ?? 'other';
    const arr = byType.get(type) ?? [];
    arr.push(n);
    byType.set(type, arr);
  }
  return [...byType.entries()]
    .sort(
      (a, b) => NEWS_GROUP_ORDER.indexOf(a[0]) - NEWS_GROUP_ORDER.indexOf(b[0]),
    )
    .map(([type, groupItems]) => {
      const phrase = newsGroupPhrase(type, groupItems);
      return {
        type,
        label: `${NEWS_EVENT_LABELS[type] ?? 'Noticia'}${
          phrase ? ` · ${phrase}` : ''
        }`,
        items: groupItems,
      };
    });
}

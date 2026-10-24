import type {
  OutfallEpisodeBeach,
  OutfallEpisodes,
  OutfallInfraSummary,
  OutfallNearbyBeach,
  OutfallNewsItem,
} from './api';
import { beachBaseName, displayBeachName, fmtDate } from './format';
import { colors } from './theme';

// Texto y formato de la ficha de emisario: toda la lógica de "cómo
// se cuenta el dato del censo" sin React — testeable en puro.

export const OUTFALL_STATUS_LABELS: Record<string, string> = {
  legal: 'Autorizado',
  illegal: 'No autorizado',
  unknown: 'En trámite',
};

// Estado físico de la conducción: semáforo de 3 niveles — "Precario"
// es naranja fuerte (aviso), el rojo se reserva para "Malo"
export const CONDITION_COLORS: Record<string, string> = {
  Bueno: colors.outfall.legal,
  Precario: colors.status.warning,
  Malo: colors.outfall.illegal,
};

// Siglas del censo traducidas a lenguaje de ficha — el campo trae
// el nombre propio ("EBAR Callao Salvaje"), no solo la sigla.
// Siglas del censo traducidas — el campo puede combinar instalaciones
// ("EDAR + EDAM Adeje Arona"): se traduce cada una
// EBAR = bombeo de residuales (vierte sin tratar al desbordarse);
// EDAR/EDAS/ETAR = depuradoras (ya tratadas); EDAM = desaladora
// (vierte salmuera)
const originKindLabel = (t: string) =>
  t.startsWith('EBAR')
    ? 'bombeo de aguas residuales'
    : t.startsWith('EDAM')
      ? 'desaladora'
      : /^E[DT]A[RS]/.test(t)
        ? 'depuradora'
        : null;

// El nombre propio ("EDAR + EDAM Adeje Arona") ya lo dice la
// cabecera de la card — la traducción devuelve solo el tipo
export const originLabel = (s: string) => {
  const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
  if (s.includes('+')) {
    const labels = s.split('+').map((t) => originKindLabel(t.trim()));
    if (labels.every(Boolean)) return cap([...new Set(labels)].join(' + '));
  }
  const l = originKindLabel(s.trim());
  return l ? cap(l) : s;
};

// "ZEC Franja marina Teno - Rasca. nº ZEC 103_TF. Ref. ES7020017"
// → solo el nombre del espacio protegido (los códigos 103_TF /
// ES7020017 son identificadores de registro, no info de ficha)
export const protectedAreaName = (s: string) =>
  s
    .split(/\.\s*(?:n[ºú]|Ref\.?|ES\d)/i)[0]
    .trim()
    .replace(/^ZEC\s+/i, '')
    .replace(/\s+-\s+/g, '–')
    .replace(/\.$/, '');

// Por qué importa cada espacio protegido: nota ecológica breve para
// la caja ZEC (solo hay dos ZEC en el censo de Tenerife)
export const protectedAreaNote = (s: string) =>
  /Teno\s*-\s*Rasca/i.test(s)
    ? ', hogar de calderones tropicales y delfines mulares, con cachalotes y tortugas de paso'
    : /Sebadales/i.test(s)
      ? ', que protege praderas de sebada, fanerógamas marinas que sirven de criadero de peces'
      : '';

// EstadoFunc (¿opera hoy?) + ContinVert (régimen de DISEÑO) en una
// sola frase legible — evita la aparente contradicción "no activo
// pero vertido habitual"
// La conducción como frase: "Emisario submarino que vierte a 646 m
// de la orilla y a 24 m de profundidad" — los números van marcados
// (b) para la negrita. La distancia a la orilla (shore_m, derivada)
// es lo que importa — el largo del tubo puede empezar tierra
// adentro y despistar
export const conduitSegs = (
  kind: string | null | undefined,
  shore: number | null | undefined,
  length: number | null | undefined,
  depth: number | null | undefined,
): { t: string; b?: boolean }[] | null => {
  const segs: { t: string; b?: boolean }[] = [];
  if (kind) segs.push({ t: kind[0].toUpperCase() + kind.slice(1) });
  else if (shore != null || length != null || depth != null)
    segs.push({ t: 'La conducción' });
  if (!segs.length) return null;
  if (shore != null)
    segs.push(
      { t: ' que vierte a ' },
      { t: `${Math.round(shore)} m`, b: true },
      { t: ' de la orilla' },
    );
  else if (length != null)
    segs.push({ t: ' de ' }, { t: `${Math.round(length)} m`, b: true });
  if (depth != null)
    if (depth < 0)
      segs.push(
        { t: ' y a ' },
        { t: `${Math.abs(depth)} m`, b: true },
        { t: ' de profundidad' },
      );
    else
      segs.push({
        t:
          depth > 0
            ? ' y cae sobre la superficie del mar'
            : ' y sale a ras de mar',
      });
  segs.push({ t: '.' });
  return segs;
};

// KPI del dato hero (misma regla que la landing /o/{id}): orilla y
// profundidad como tiles escaneables junto al "vierte a:", en vez
// de enterradas en la frase. El vertido a ras de mar también lleva
// tile — "0 m / a ras de mar" lo dice sin fingir un número
export const kpiSegs = (
  kind: string | null | undefined,
  shore: number | null | undefined,
  depth: number | null | undefined,
): { lead: string; tiles: { v: string; l: string }[] } | null => {
  const tiles: { v: string; l: string }[] = [];
  if (shore != null)
    tiles.push({ v: `${Math.round(shore)} m`, l: 'de la orilla' });
  // depth === 0 ("a ras de mar") también lleva tile: "0 m / a ras
  // de mar" mantiene la gramática numérica sin fingir profundidad
  if (depth === 0) tiles.push({ v: '0 m', l: 'a ras de mar' });
  else if (depth != null)
    tiles.push({
      v: `${Math.abs(depth)} m`,
      l: depth < 0 ? 'de profundidad' : 'sobre el mar',
    });
  if (!tiles.length) return null;
  const label = kind ? kind[0].toUpperCase() + kind.slice(1) : 'La conducción';
  return { lead: `${label} vierte a:`, tiles };
};

// La descripción del censo mezcla frases completas ("El vertido se
// produce bajo el muro del paseo…") con fragmentos secos
// ("Escollera de protección."). Las frases se limpian del sujeto
// redundante ("El emisario submarino arranca…" → "Arranca…") y los
// fragmentos se convierten en frase: "El punto de vertido está en
// la escollera del paseo marítimo de Playa San Juan."
export const zoneText = (zd: string) => {
  let s = zd.trim().replace(/\s+/g, ' ').replace(/\.$/, '').trim();
  if (/^(?:el|la|los|las|se|este|esta)\b/i.test(s)) {
    s = s.replace(
      /^(?:el|la|los|las)\s+(?:emisario(?:\s+submarino)?|conducci[oó]n(?:\s+(?:submarina|de\s+(?:desag[üu]e|vertido)))?|canal|tuber[ií]a|instalaci[oó]n(?:\s+de\s+vertido)?)\s+/i,
      '',
    );
    return s[0].toUpperCase() + s.slice(1) + '.';
  }
  // "Situado en el lado oeste…" → el participio ya trae la "en"
  s = s.replace(/^situad[oa]\s+/i, '');
  if (/^en\b/i.test(s))
    return `El punto de vertido está ${s[0].toLowerCase() + s.slice(1)}.`;
  const fem =
    /^(escollera|rasa|playa|zona|parte|trasera|urbanizaci[oó]n|costa|peque[ñn]a|plaza|piscina|d[aá]rsena|desembocadura|proximidades|explanada|ensenada|caleta|colada)/i.test(
      s,
    );
  const masc =
    /^(paseo|muelle|muellito|puerto|entorno|acantilado|barranco|extremo|final|interior|espald[oó]n|dique|pozo|parque|lado)/i.test(
      s,
    );
  const body = fem
    ? `la ${s[0].toLowerCase() + s.slice(1)}`
    : masc
      ? `el ${s[0].toLowerCase() + s.slice(1)}`
      : s;
  return `El punto de vertido está en ${body}.`;
};

// El censo trae responsables en mayúsculas ("CLUB NAUTICO DE
// BAJAMAR") — solo reescribe si TODO viene en mayúsculas; los
// conectores van en minúscula y las siglas conocidas se conservan
// (CEPSA, EDAR, ETAR, PM1, romanos…)
export const smartTitle = (s: string): string => {
  if (!/[A-ZÁÉÍÓÚÑ]/.test(s) || /[a-záéíóúñ]/.test(s)) return s;
  const SMALL = new Set([
    'de',
    'del',
    'la',
    'el',
    'los',
    'las',
    'y',
    'en',
    'a',
    'al',
    'con',
    'por',
    'para',
  ]);
  const ACRONYM =
    /^(CEPSA|E[DTBA]A[RMS]I?|PM\d*|[IVXLCDM]+|S\.?A\.?|S\.?L\.?)$/i;
  return s
    .toLowerCase()
    .split(' ')
    .map((w, i) =>
      ACRONYM.test(w)
        ? w.toUpperCase()
        : i > 0 && SMALL.has(w)
          ? w
          : w[0].toUpperCase() + w.slice(1),
    )
    .join(' ')
    .replace(/-([a-záéíóúñ])/g, (_, c) => `-${c.toUpperCase()}`);
};

// Qué significa cada sustancia para el ciudadano: la naturaleza
// puede combinar ("Agua residual y salmuera") y el origen dice de
// qué instalación sale cada parte → una línea por apartado
// ("Depuradora — aguas fecales…", "Desaladora — salmuera…")
export const natureParts = (
  nature: string,
  origin: string | null | undefined,
  depth: number | null | undefined,
  zoneDesc: string | null | undefined,
): {
  label: string;
  desc: string | null;
  note: string | null;
  verdict: string | null;
  verdictBad: boolean;
  colon: boolean;
}[] => {
  const n = nature.toLowerCase();
  const o = (origin ?? '').toLowerCase();
  const zd = (zoneDesc ?? '').toLowerCase();
  // El censo delata a veces en la descripción que el emisario sale
  // de una estación de PRETRATAMIENTO (Punta Blanca): solo filtra
  // sólidos y grasas — no es depuración, hay que decirlo claro
  const pretreated = /pretratamiento/.test(o) || /pretratamiento/.test(zd);
  const parts: {
    src: string | null;
    name: string;
    // El "qué lleva" en una frase corta — va en negrita tras la
    // etiqueta ("Piscinas: con cloro y sal — impacto leve…")
    desc: string | null;
    note: string | null;
    // El veredicto del vertido ("el agua sale sin depurar") va en
    // línea propia coloreada — es la conclusión, no una nota gris
    verdict: string | null;
    verdictBad: boolean;
  }[] = [];
  const industrialOnly = n.includes('industrial') && !n.includes('urbana');
  // El veredicto de tratamiento va en la nota (casa natural del dato):
  // EDAR/ETAR/depuradora → sale depurada; red/bombeo/aliviadero → en
  // bruto. Misma regla que el índice de riesgo; sin origen claro la
  // nota se queda genérica, no se inventa el veredicto
  const treated =
    !pretreated &&
    /e[dt]a[rs]|depuradora|tratamiento/.test(o) &&
    !/ebar|bombeo|aliviadero|saneamiento|red/.test(o);
  const raw = !pretreated && /ebar|bombeo|aliviadero|saneamiento|red/.test(o);
  if (n.includes('residual'))
    parts.push({
      src: pretreated
        ? 'Estación de pretratamiento'
        : /e[dt]a[rs]|depuradora|tratamiento/.test(o)
          ? 'Depuradora'
          : /ebar|bombeo|saneamiento|aliviadero|red/.test(o)
            ? 'Red de saneamiento'
            : null,
      name: industrialOnly
        ? 'agua de procesos industriales'
        : n.includes('industrial')
          ? 'aguas fecales, domésticas e industriales'
          : 'aguas fecales y domésticas',
      desc: industrialOnly ? 'químicos, hidrocarburos o metales' : null,
      note: industrialOnly
        ? 'restos de la actividad de la planta — el impacto depende de la industria y su tratamiento.'
        : pretreated
          ? 'solo filtra lo grueso (sólidos, arenas y grasas).'
          : treated || raw
            ? null
            : 'el riesgo depende del tratamiento: depurada es leve, en bruto es contaminación fecal.',
      verdict: industrialOnly
        ? null
        : pretreated
          ? 'El agua sale sin depurar.'
          : treated
            ? 'Sale depurada: impacto leve sobre el agua.'
            : raw
              ? 'Vierte en bruto: puede llevar contaminación fecal.'
              : null,
      verdictBad: pretreated || raw,
    });
  if (n.includes('salmuera')) {
    // La profundidad solo se convierte en aviso cuando es contundente:
    // un vertido somero llega al fondo casi sin diluir pase lo que
    // pase; uno profundo NO garantiza buen diseño (caudal y difusor
    // mandan también) → silencio antes que falsa tranquilidad
    const shallow = depth != null && (depth >= 0 || Math.abs(depth) < 8);
    parts.push({
      src: /edam|desaladora|salina/.test(o) ? 'Desaladora' : null,
      name: 'salmuera',
      desc: 'concentrado de sal',
      note:
        'no lleva fecales, pero es más densa que el mar y puede formar una capa sobre el fondo que daña praderas y bentos.' +
        (shallow
          ? depth! >= 0
            ? ' Y aquí el vertido cae sobre la superficie del mar, así que esa capa salada llega al fondo casi sin diluirse.'
            : ` Y aquí vierte a solo ${Math.abs(depth!)} m de profundidad, así que esa capa salada llega al fondo casi sin diluirse.`
          : '') +
        ' El bañista apenas lo nota.',
      verdict: null,
      verdictBad: false,
    });
  }
  if (n.includes('piscina'))
    parts.push({
      src: /piscina|n[aá]utico|club/.test(o) ? 'Piscinas' : null,
      name: 'agua de piscinas',
      desc: 'con cloro y sal',
      note: 'impacto leve y puntual.',
      verdict: null,
      verdictBad: false,
    });
  if (n.includes('refrigeración'))
    parts.push({
      src: null,
      name: 'agua de refrigeración',
      // Agua de mar usada para enfriar la planta: vuelve más caliente
      desc: 'sale más caliente que el mar',
      note: 'impacto leve y puntual.',
      verdict: null,
      verdictBad: false,
    });
  if (n.includes('pluvial'))
    parts.push({
      src: /pluvial/.test(o) ? 'Red de pluviales' : null,
      name: 'agua de lluvia',
      desc: 'arrastra aceites, metales y suciedad de las calles',
      note: 'no es fecal, pero tras la sequía sale cargada.',
      verdict: null,
      verdictBad: false,
    });
  // Con varias sustancias la etiqueta nombra cada una entre
  // paréntesis ("Depuradora (aguas fecales…): el riesgo…"); con
  // una sola basta la instalación para no repetir el heroValue
  const multi = parts.length > 1;
  return parts.map((p) => ({
    label: multi && p.src ? `${p.src} (${p.name})` : (p.src ?? p.name),
    desc: p.desc,
    note: p.note,
    verdict: p.verdict,
    verdictBad: p.verdictBad,
    colon: multi || !!p.desc,
  }));
};

export const operationText = (
  active: boolean | null | undefined,
  continuity: string | null | undefined,
): string | null => {
  const habitual = continuity === 'Habitual';
  // "De excedencia-emergencia" del censo = válvula de escape que solo
  // abre cuando el sistema se desborda: lluvia fuerte, avería o
  // mantenimiento — no "emergencia" en sentido de catástrofe
  const overflow =
    'cuando el sistema se desborda: lluvia fuerte, avería o más caudal del que la depuradora puede tratar';
  if (active === true)
    return continuity == null
      ? 'En funcionamiento actualmente.'
      : habitual
        ? 'Funciona hoy: vierte de forma continua en uso normal.'
        : `Funciona hoy, pero solo debería verter ${overflow}.`;
  if (active === false)
    return continuity == null
      ? 'No opera ahora mismo.'
      : habitual
        ? 'No opera ahora mismo, aunque está pensado para verter a diario.'
        : `No opera ahora mismo; está pensado para abrir solo ${overflow}.`;
  return continuity == null
    ? null
    : habitual
      ? 'Pensado para vertido habitual.'
      : `Pensado para abrir solo ${overflow}.`;
};

// La celda "Funcionamiento" del strip de triaje: operationText
// comprimido a su titular (el matiz completo va en operationDetail)
export const operationShort = (
  active: boolean | null | undefined,
  continuity: string | null | undefined,
): string => {
  const habitual = continuity === 'Habitual';
  if (active === true)
    return continuity == null
      ? 'En funcionamiento'
      : habitual
        ? 'Vierte a diario'
        : 'Solo al desbordarse';
  if (active === false) return 'Ahora no vierte';
  return continuity == null
    ? 'Sin datos'
    : habitual
      ? 'Vertido habitual'
      : 'Solo al desbordarse';
};

// Detalle bajo el triaje: la frase completa solo cuando añade algo
// que la celda no dice — "Vierte a diario"/"En funcionamiento" ya
// la cuentan; los desbordes, las paradas y el régimen sin estado
// sí aportan (explican qué es un aliviadero o que ahora está parado)
export const operationDetail = (
  active: boolean | null | undefined,
  continuity: string | null | undefined,
): string | null =>
  active === true && (continuity == null || continuity === 'Habitual')
    ? null
    : operationText(active, continuity);

// Una fila por playa, no por PM: "Porís de Abona PM1/PM2" son la
// misma playa — dedup por nombre base conservando la más cercana
export const nearbyUniqueBeaches = (list: OutfallNearbyBeach[]) =>
  list.filter(
    (n, i) =>
      list.findIndex(
        (m) => beachBaseName(m.beach_name) === beachBaseName(n.beach_name),
      ) === i,
  );

// --- Prensa de infraestructura de vertido (Hito 11.2) ---

export const OUTFALL_NEWS_TITLE = 'En la prensa';
// Etiqueta obligatoria: es contexto de prensa, y la proximidad o la
// coincidencia temporal nunca implican causalidad
export const OUTFALL_NEWS_NOTE =
  'Según prensa — coincidencia geográfica, no implica causalidad';
export const OUTFALL_NEWS_NAMED = 'De este emisario';
export const OUTFALL_NEWS_ZONE = 'En la zona';

// Línea meta bajo el hecho/titular: medio · fecha · playa a la que
// va casada la noticia (es noticia DE la playa, no del punto). Con
// `withDate:false` la fecha se omite — la fila con lead de hecho ya
// la lleva junto al hecho y no se escribe dos veces
export const outfallNewsMeta = (n: OutfallNewsItem, withDate = true): string =>
  [
    n.source,
    withDate && n.published_at ? fmtDate(n.published_at.slice(0, 10)) : null,
    n.beach_name ? displayBeachName(beachBaseName(n.beach_name)) : null,
  ]
    .filter(Boolean)
    .join(' · ');

// Resumen "de este punto" (resumen C): qué cuentan las noticias que
// nombran el punto — "rotura del emisario · vertido de aguas
// residuales — 3 noticias lo nombran"
export const outfallInfraSummary = (s: OutfallInfraSummary): string =>
  [
    s.causes.join(' · ') || null,
    s.named_count === 1
      ? '1 noticia lo nombra'
      : `${s.named_count} noticias lo nombran`,
  ]
    .filter(Boolean)
    .join(' — ');

// --- Episodios de contaminación del entorno (Hito 11.3) ---

export const OUTFALL_EPISODES_TITLE = 'Episodios de contaminación cercanos';
// Misma regla editorial que la prensa: la proximidad es contexto,
// nunca acusación — no toca estados ni alertas
export const OUTFALL_EPISODES_NOTE =
  'Últimos 5 años en playas a menos de 2 km — estar cerca no implica causar';

// Línea resumen: "12 episodios (9 cierres) · el más reciente en
// oct 2025" — cierres solo si los hay, fecha solo si existe
export const outfallEpisodesSummary = (e: OutfallEpisodes): string =>
  [
    `${e.total} episodio${e.total === 1 ? '' : 's'}${
      e.closures ? ` (${e.closures} cierre${e.closures === 1 ? '' : 's'})` : ''
    }`,
    e.last ? `el más reciente empezó el ${fmtDate(e.last)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

// Fila por playa: "Playa Jardín — 9 episodios · últ. 09/10/2025"
export const outfallEpisodeBeachLine = (b: OutfallEpisodeBeach): string =>
  [
    b.name ? displayBeachName(b.name) : 'Playa',
    `${b.episodes} episodio${b.episodes === 1 ? '' : 's'}`,
    b.last ? `últ. ${fmtDate(b.last)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

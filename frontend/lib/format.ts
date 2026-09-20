// Formato de nombres para UI. Los nombres del censo vienen en
// mayúsculas y con el artículo en paréntesis al final:
// "PLAYA GAVIOTAS (LAS)"          -> "Playa de las Gaviotas"
// "PLAYA BOBO (EL)"               -> "Playa del Bobo"
// "PLAYA MEDANO (EL)-CHICA"       -> "Playa del Médano-Chica"
// "PLAYA ABADES (LOS ABRIGUITOS)" -> "Playa Abades (Los Abriguitos)"
//   (el paréntesis solo se mueve si es un artículo suelto; un alias
//   como "Los Abriguitos" se queda donde está)

const CONNECTORS = new Set(['de', 'del', 'y', 'e', 'en', 'a', 'o', 'u']);
const ARTICLES = new Set(['el', 'la', 'los', 'las']);
// Números romanos de nombres compuestos ("Troya II", "Américas I"):
// siempre en mayúsculas, no "Ii".
const ROMANS = new Set(['i', 'ii', 'iii', 'iv', 'v', 'vi']);

// La fuente omite acentos en mayúsculas; los restauramos en los
// topónimos conocidos al capitalizar.
const ACCENTS: Record<string, string> = {
  medano: 'médano',
  guios: 'guíos',
  guimar: 'güímar',
  americas: 'américas',
  camison: 'camisón',
  jaquita: 'jaquita',
  almaciga: 'almáciga',
  // variantes con el carácter corrupto de la fuente ya eliminado
  amricas: 'américas',
  camisn: 'camisón',
  gimar: 'güímar',
};

// Capitaliza estilo español: "Playa de las Gaviotas", "Paseo de las
// Palmeras". Los conectores van en minúscula y los artículos solo en
// minúscula tras "de" ("de la Arena" sí, "El Cabezo" no).
export const capName = (name: string) => {
  let prev = '';
  return name
    .toLowerCase()
    .replace(/�/g, '')
    .split(/([a-záéíóúñü]+)/i)
    .map((p) => {
      if (!/^[a-záéíóúñü]+$/i.test(p)) return p;
      const w = ACCENTS[p] ?? p;
      if (ROMANS.has(w)) {
        prev = w;
        return w.toUpperCase();
      }
      const lower = prev !== '' && (CONNECTORS.has(w) || (ARTICLES.has(w) && prev === 'de'));
      const out = lower ? w : w[0].toUpperCase() + w.slice(1);
      prev = w;
      return out;
    })
    .join('');
};

// "2026-09-14" -> "14/09/2026"
export const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const ARTICLE_PAREN = /\s*\((EL|LA|LOS|LAS)\)/i;
const DE_FORMS: Record<string, string> = {
  el: 'del',
  la: 'de la',
  los: 'de los',
  las: 'de las',
};

export const displayBeachName = (name: string) => {
  const m = name.match(ARTICLE_PAREN);
  if (!m) return capName(name);
  const base = name.replace(ARTICLE_PAREN, '').replace(/ -(?=\S)/g, '-');
  if (/^PLAYA\s/i.test(base)) {
    return capName(base.replace(/^PLAYA\s+/i, `PLAYA ${DE_FORMS[m[1].toLowerCase()]} `));
  }
  return capName(`${m[1]} ${base}`);
};

// Nombre base de agrupación: una playa extensa tiene varios puntos de
// muestreo oficiales (PM1, PM2...) y variantes con romano (Troya I/II
// son un único arenal). Lista y mapa agrupan por esta clave.
// "PLAYA TROYA I (AMÉRICAS I) PM3" -> "PLAYA TROYA (AMÉRICAS)"
export const beachBaseName = (name: string) =>
  name
    .replace(/\s+PM\d+$/, '')
    .replace(/\s+(I|II|III|IV)\s*(?=\))/, '')
    .replace(/\s+(I|II|III|IV)(?=\s*\(|\s*$)/, '');

// Clave de agrupación insensible a artículos/preposiciones y acentos:
// "PLAYA DE LA HORNILLA" ≡ "PLAYA LA HORNILLA" (OSM duplica arenales
// con variantes de nombre). SOLO para la clave de grupo — el nombre
// visible sigue saliendo de beachBaseName/displayBeachName
export const beachGroupKey = (name: string) =>
  beachBaseName(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\b(DE LA|DE LOS|DE LAS|DEL|DE|EL|LA|LOS|LAS)\b/g, ' ')
    .replace(/^PLAYA\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();

// Etiqueta del punto de muestreo dentro de su playa: "PM3"; si la
// playa se subdivide por romano (Troya I/II) se antepone: "II · PM3"
export const beachPointLabel = (name: string) => {
  const pm = name.match(/\s+(PM\d+)$/)?.[1];
  const roman = name
    .replace(/\s+PM\d+$/, '')
    .split('(')[0]
    .trimEnd()
    .match(/\s+(I|II|III|IV)$/)?.[1];
  const label = [roman, pm].filter(Boolean).join(' · ');
  return label || null;
};

// Versión legible para el usuario: "PM3" -> "Punto de muestreo 3";
// "II · PM3" -> "II · punto de muestreo 3". "PM" solo lo entiende
// quien conoce el censo de Náyade
export const pointLongLabel = (name: string) => {
  const l = beachPointLabel(name);
  return l ? l.replace(/PM(\d+)/, 'punto de muestreo $1') : null;
};

// Calas con nombre propio dentro de complejos multi-PM — espejo del
// mapa curado en backend/app/news_zones.py. Náyade solo conoce PMs
// ("PLAYA JARDIN PM4") pero la prensa y los bandos hablan de calas:
// el usuario dice "la de Charcón", no "la zona 5"
import { PM_SUFFIX, pmTagOf } from './pm';

// Arenaales cuyos puntos llevan nombre propio en el censo (espejo
// de ARENAL_BASES en backend/app/names.py): las tres zonas del
// Médano comparten arenal — Chica y Leocadio Machado son PM1 las
// dos, se distinguen por el sufijo del nombre. Curado, NO una regla
// por guion: "Valleseco-El Bloque" es playa aparte
const ARENAL_BASES: Record<string, string> = {
  'PLAYA MEDANO (EL)-CHICA': 'PLAYA MEDANO (EL)',
  'PLAYA MEDANO (EL)-LEOCADIO MACHADO': 'PLAYA MEDANO (EL)',
};

const ZONE_NAMES: Record<string, Record<string, string>> = {
  // Playa Jardín (Puerto de la Cruz) — este → oeste
  'PLAYA JARDIN': {
    PM1: 'El Castillo',
    PM5: 'El Charcón',
    PM4: 'Punta Brava',
  },
  // Valleseco (Santa Cruz): el tramo de Los Charcos — su PM hermano
  // "Valleseco-El Bloque" es otra playa base, no compite en el grupo
  'PLAYA VALLESECO': {
    PM1: 'Los Charcos',
  },
  'PLAYA VALLESECO- EL BLOQUE': {
    PM1: 'El Bloque',
  },
  // El Médano (Granadilla): tres zonas del mismo arenal — se indexan
  // por sufijo porque Chica y Leocadio Machado comparten el PM1
  'PLAYA MEDANO (EL)': {
    PM3: 'Playa central',
    CHICA: 'Playa Chica',
    'LEOCADIO MACHADO': 'Leocadio Machado',
  },
};

// Referencia narrativa cuando el nombre a secas no lee bien:
// "cala Punta Brava" vale, pero nadie dice "cala Chica" — la gente
// dice "la playa Chica". Sin artículo: la frase aporta el suyo
// ("En la {ref}", "La {ref} sigue cerrada")
const ZONE_REFS: Record<string, Record<string, string>> = {
  'PLAYA MEDANO (EL)': {
    PM3: 'playa central',
    CHICA: 'playa Chica',
    'LEOCADIO MACHADO': 'playa de Leocadio Machado',
  },
};

const normBase = (name: string) =>
  name
    .replace(PM_SUFFIX, '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .trim();

// Base del complejo con el alias de arenal aplicado:
// "PLAYA MEDANO (EL)-CHICA" → "PLAYA MEDANO (EL)"
export const arenalBase = (name: string) =>
  ARENAL_BASES[normBase(name)] ?? normBase(name);

// Alias curado o null — para consumidores que conservan el nombre
// original cuando no hay alias (acentos, case del censo)
export const arenalAlias = (name: string): string | null =>
  ARENAL_BASES[normBase(name)] ?? null;

// Token que distingue al punto dentro de su complejo: el sufijo de
// nombre propio si lo tiene ("CHICA"), si no la etiqueta PM ("PM4").
// Dos calas pueden compartir número de PM — Chica y Leocadio
// Machado son ambas PM1 — el número solo no basta
export const zoneTagOf = (name: string): string | null => {
  const core = normBase(name);
  const base = ARENAL_BASES[core] ?? core;
  const suffix = core.startsWith(base)
    ? core.slice(base.length).replace(/^[-\s]+/, '')
    : '';
  return suffix || pmTagOf(name);
};

// Nombre común de la cala de un PM ("Punta Brava" para Jardín PM4).
// `tag` consulta una zona hermana (attributed_pm: "PM4" o "CHICA")
// del mismo complejo que `beachName`; sin `tag` se usa el token del
// propio nombre
export const zoneName = (beachName: string, tag?: string | null) => {
  const group = ZONE_NAMES[arenalBase(beachName)];
  if (!group) return null;
  const label = (tag ?? zoneTagOf(beachName) ?? '').toUpperCase();
  return group[label] ?? null;
};

// Referencia legible a la zona hermana en textos narrativos:
// "cala Punta Brava" / "playa Chica" / "zona 4" (sin mapa)
export const siblingZoneRef = (beachName: string, tag: string) => {
  const ref = ZONE_REFS[arenalBase(beachName)]?.[tag.toUpperCase()];
  if (ref) return ref;
  const z = zoneName(beachName, tag);
  if (z) return `cala ${z}`;
  const pretty = tag.charAt(0) + tag.slice(1).toLowerCase();
  return /^PM/i.test(tag)
    ? `zona ${tag.replace(/^PM/i, '')}`
    : `cala ${pretty}`;
};

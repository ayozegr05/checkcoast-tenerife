// Calas con nombre propio dentro de complejos multi-PM — espejo del
// mapa curado en backend/app/news_zones.py. Náyade solo conoce PMs
// ("PLAYA JARDIN PM4") pero la prensa y los bandos hablan de calas:
// el usuario dice "la de Charcón", no "la zona 5"
const ZONE_NAMES: Record<string, Record<string, string>> = {
  // Playa Jardín (Puerto de la Cruz) — este → oeste
  'PLAYA JARDIN': {
    PM1: 'El Castillo',
    PM5: 'El Charcón',
    PM4: 'Punta Brava',
  },
};

const normBase = (name: string) =>
  name
    .replace(/\s+PM\d+\s*$/i, '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .trim();

// Nombre común de la cala de un PM ("Punta Brava" para Jardín PM4).
// `pm` consulta un PM hermano (attributed_pm) del mismo complejo que
// `beachName`; sin `pm` se usa el sufijo del propio nombre
export const zoneName = (beachName: string, pm?: string | null) => {
  const group = ZONE_NAMES[normBase(beachName)];
  if (!group) return null;
  const label = (
    pm ??
    beachName.match(/\s+(PM\d+)\s*$/i)?.[1] ??
    ''
  ).toUpperCase();
  return group[label] ?? null;
};

// Referencia legible al PM hermano en textos narrativos:
// "la cala Punta Brava" / "la zona 4" (sin mapa)
export const siblingZoneRef = (beachName: string, pm: string) => {
  const z = zoneName(beachName, pm);
  return z ? `cala ${z}` : `zona ${pm.replace(/^PM/i, '')}`;
};

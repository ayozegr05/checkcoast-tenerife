// Formato de nombres para UI. Los nombres del censo vienen en
// mayúsculas y con el artículo en paréntesis al final:
// "PLAYA GAVIOTAS (LAS)"          -> "Playa Las Gaviotas"
// "PLAYA MEDANO (EL)-LEOCADIO M1" -> "Playa El Médano-Leocadio M1"
// "PLAYA ABADES (LOS ABRIGUITOS)" -> "Playa Abades (Los Abriguitos)"
//   (el paréntesis solo se mueve si es un artículo suelto; un alias
//   como "Los Abriguitos" se queda donde está)

// "PLAYA ABADES (LOS ABRIGUITOS)" -> "Playa Abades (Los Abriguitos)"
export const capName = (name: string) =>
  name
    .toLowerCase()
    .replace(
      /(^|[\s(-])([a-záéíóúñü])/g,
      (_m, pre: string, c: string) => pre + c.toUpperCase(),
    );

const ARTICLE_ONLY = /^(EL|LA|LOS|LAS)$/i;

export const displayBeachName = (name: string) => {
  const m = name.match(/^(.*?)\s*\(([^)]*)\)\s*(.*)$/);
  if (m && ARTICLE_ONLY.test(m[2].trim())) {
    const tail = m[3].trim();
    const base = tail
      ? `${m[1].trim()}${tail.startsWith('-') ? '' : ' '}${tail}`
      : m[1].trim();
    return capName(`${m[2].trim()} ${base}`);
  }
  return capName(name);
};

// Sufijo de punto de muestreo del censo Náyade ("PM1", "PM4") al
// final del nombre oficial. Una playa extensa tiene varios PMs
// (Jardín PM1..PM5); los regex canónicos viven aquí para no
// duplicarlos en cada consumidor.
export const PM_SUFFIX = /\s+PM\d+\s*$/i;

// Extrae la etiqueta "PM3" del nombre oficial (null si no es un PM)
export const pmTagOf = (name: string): string | null =>
  name.match(/\s+(PM\d+)\s*$/i)?.[1] ?? null;

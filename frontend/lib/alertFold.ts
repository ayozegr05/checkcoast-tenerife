// Plegado de la sección "Cierre estructural" del banner de alertas:
// son cierres largos que apenas cambian y empujaban fuera de pantalla
// lo que sí es noticia (contaminación, reabiertas). Se muestran los
// más recientes y el resto queda tras una fila "N más".
export const FOLD_PREVIEW = 3;
// Con pocos no se pliega: una fila "1 más" ocupa lo mismo que la playa
export const FOLD_MIN = 5;
// Un cierre estructural reciente siempre queda a la vista
export const FOLD_RECENT_DAYS = 7;

type Alerted = { alerted_at?: string | null; reported_at?: string | null };

// `items` ordenados del más reciente al más antiguo. Devuelve cuántos
// mostrar plegado (el resto va tras la fila "N más")
export function foldCount<T extends Alerted>(
  items: T[],
  now: Date = new Date(),
): number {
  if (items.length < FOLD_MIN) return items.length;
  const limit = new Date(now.getTime() - FOLD_RECENT_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);
  const recent = items.filter(
    (i) => (i.alerted_at ?? i.reported_at ?? '').slice(0, 10) >= limit,
  ).length;
  const shown = Math.max(FOLD_PREVIEW, recent);
  // Si solo quedaría 1 oculto, se muestran todos
  return items.length - shown <= 1 ? items.length : shown;
}

// "Garachico, La Guancha…": municipios únicos de las ocultas
export function foldSummary(
  municipalities: (string | null | undefined)[],
  max = 2,
): string {
  const uniq = [...new Set(municipalities.filter(Boolean) as string[])];
  return uniq.length > max
    ? `${uniq.slice(0, max).join(', ')}…`
    : uniq.join(', ');
}

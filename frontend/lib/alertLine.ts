// Texto del banner de alertas del mapa: desglose de cierres por
// causa ("2 contaminación · 1 desprendimientos") en vez de un genérico
// "3 cerradas" — un cierre por vertido y uno por talud no son el mismo
// problema. Las causas ya llegan normalizadas a categoría corta en
// `alert_cause` (queries.py: Contaminación, Desprendimientos, Obras,
// Mar agitado); los cierres sin causa quedan como "cerrada(s)".

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export const alertLine = (
  closedCauses: (string | null | undefined)[],
  warningCount: number,
): string => {
  const parts: string[] = [];
  const byCause = new globalThis.Map<string, number>();
  let generic = 0;
  for (const c of closedCauses) {
    if (c) byCause.set(c, (byCause.get(c) ?? 0) + 1);
    else generic += 1;
  }
  const causes = [...byCause.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  for (const [cause, n] of causes) parts.push(`${n} ${lower(cause)}`);
  // Cierres sin causa conocida: genérico al final del grupo de cierres
  if (generic)
    parts.push(`${generic} ${generic === 1 ? 'cerrada' : 'cerradas'}`);
  if (warningCount)
    parts.push(`${warningCount} ${warningCount === 1 ? 'aviso' : 'avisos'}`);
  return parts.join(' · ');
};

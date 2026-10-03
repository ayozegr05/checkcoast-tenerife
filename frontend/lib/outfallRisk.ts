import { GeoFeature } from './api';

// Índice de riesgo del vertido (bañista y ecosistema) — calculado
// sobre datos del censo, no una opinión. Ordena la lista de
// emisarios y alimenta la banda "Riesgo:" de la ficha.

export type RiskLevel = 'alto' | 'medio' | 'bajo';

export type OutfallRisk = {
  score: number;
  level: RiskLevel;
  // Las 2-3 razones que más pesan, en lenguaje de ficha
  reasons: string[];
};

export function outfallRisk(
  p: GeoFeature['properties'],
): OutfallRisk {
  const n = (p.nature ?? '').toLowerCase();
  const o = (p.origin ?? '').toLowerCase();
  const weighted: [number, string][] = [];

  // Sustancia: lo que cae es lo que más importa. Residual depurada
  // (EDAR/ETAR) no es lo mismo que en bruto (EBAR/aliviadero/red)
  let substance = 0;
  if (n.includes('residual')) {
    const urban = n.includes('urbana') || n.includes('doméstica');
    const industrial = n.includes('industrial');
    if (industrial && !urban) {
      // Industrial pura (refinería, separador de hidrocarburos):
      // tóxicos, no fecales — no decir "potencial fecal"
      substance = 2;
      weighted.push([2, 'vertido industrial (químicos o hidrocarburos)']);
    } else {
      // El censo delata el pretratamiento en la descripción: filtrar
      // sólidos NO es depurar — puntúa como en bruto y se dice claro
      const pretreated = /pretratamiento/.test(
        `${o} ${(p.zone_desc ?? '').toLowerCase()}`,
      );
      const treated =
        !pretreated &&
        /e[dt]a[rs]|depuradora|tratamiento/.test(o) &&
        !/ebar|bombeo|aliviadero|saneamiento|red/.test(o);
      substance =
        (treated ? 1 : 2) + (industrial ? 0.5 : 0);
      weighted.push([
        substance,
        pretreated
          ? 'solo pretratada (sin depurar)'
          : treated
            ? 'vierte depurada'
            : 'vierte con potencial fecal',
      ]);
    }
  } else if (n.includes('salmuera')) {
    substance = 1;
    weighted.push([1, 'salmuera (afecta al fondo marino)']);
  } else if (n.includes('pluvial')) {
    substance = 1;
    weighted.push([1, 'riada urbana cargada']);
  } else if (n.includes('piscina')) {
    substance = 0.5;
    weighted.push([0.5, 'cloro y sal de piscina']);
  } else if (n.includes('refrigeración')) {
    // Agua usada para enfriar la planta: sale más caliente que el mar
    substance = 0.5;
    weighted.push([0.5, 'vierte agua caliente']);
  }

  // Régimen: verter a diario solo pesa si lo que cae importa
  if (p.is_active === true && p.continuity === 'Habitual') {
    const w = substance >= 1 ? 2 : 0.5;
    weighted.push([w, 'vierte a diario']);
  } else if (p.is_active === true) {
    weighted.push([1, 'sigue en funcionamiento']);
  }

  if (p.status === 'illegal') weighted.push([1, 'sin autorización']);
  if (p.protected_area) weighted.push([1, 'en zona protegida']);

  // En la orilla / somero: sin columna de agua que diluya. Pero el
  // sitio solo pesa si la sustancia puede hacer daño ahí — fecal
  // (patógenos al bañista), salmuera (capa sobre el fondo), pluvial
  // (riada sucia a la playa). Cloro o temperatura se disipan en
  // nada: una piscina en la orilla no es más riesgo que en el mar
  const d = p.outfall_depth;
  const shallow =
    (d != null && (d >= 0 || Math.abs(d) < 8)) ||
    (p.kind ?? '').includes('DPMT') ||
    (p.shore_m != null && p.shore_m < 50);
  if (shallow && substance >= 1)
    weighted.push([1, 'vierte en la orilla']);

  if (p.condition === 'Malo') weighted.push([1, 'estado malo']);
  else if (p.condition === 'Precario')
    weighted.push([0.5, 'estado precario']);

  const score = weighted.reduce((s, [w]) => s + w, 0);
  const level: RiskLevel =
    score >= 5 ? 'alto' : score >= 3 ? 'medio' : 'bajo';
  const reasons = weighted
    .sort((a, b) => b[0] - a[0])
    .slice(0, 3)
    .map(([, r]) => r);
  return { score, level, reasons };
}

export const RISK_LABEL: Record<RiskLevel, string> = {
  alto: 'Riesgo alto',
  medio: 'Riesgo medio',
  bajo: 'Riesgo bajo',
};

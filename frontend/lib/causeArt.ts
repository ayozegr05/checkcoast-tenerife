// Arte del circulito de causa — compartido por el banner de alertas
// (filas) y la ficha de playa (junto al chip de estado). Las etiquetas
// son las canónicas del backend (queries.py); el estructural tiene
// arte propio (rockfall) porque lo marca el flag, no la causa

import type { BeachIncident } from './api';

const CAUSE_ART: Record<string, number> = {
  Algas: require('../assets/icons/algas-art.png'),
  Medusas: require('../assets/icons/medusas-art.png'),
  Hidrocarburos: require('../assets/icons/gasoil-art.png'),
};

const ROCKFALL_ART = require('../assets/icons/rockfall-art.png');
const CONTAM_ART = require('../assets/icons/contam-art.png');

export function causeArt(
  cause: string | null | undefined,
  structural: boolean,
): number {
  if (structural) return ROCKFALL_ART;
  return CAUSE_ART[cause ?? ''] ?? CONTAM_ART;
}

// Texto libre de causa → arte, en el orden de _CAUSE_RULES del
// backend: lo estructural primero (es lo más específico), luego
// fauna/hidrocarburos/algas; lo demás cae en contaminación
const CAUSE_BADGE_RULES: [RegExp, number][] = [
  [/desprend|derrumbe|colapso|acantilado|talud/i, ROCKFALL_ART],
  [/medusa|carabela|fauna/i, CAUSE_ART.Medusas],
  [/gasoil|hidrocarbur|diesel|fuel/i, CAUSE_ART.Hidrocarburos],
  [/alga/i, CAUSE_ART.Algas],
];

// Badges de causa de una fila del historial: se agregan las causas
// de todos los titulares del episodio (Valleseco: hidrocarburos +
// algas). Sin causa categorizada cae en contaminación — Náyade solo
// vigila E. coli/enterococos y el resto suele ser bacteriológico
export function incidentBadges(inc: BeachIncident): number[] {
  const out: number[] = [];
  for (const p of inc.press_items ?? []) {
    const hit = CAUSE_BADGE_RULES.find(([re]) => re.test(p.cause ?? ''));
    const art = hit ? hit[1] : null;
    if (art && !out.includes(art)) out.push(art);
  }
  if (!out.length) out.push(CONTAM_ART);
  return out.slice(0, 3);
}

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

// Texto libre de causa → etiqueta canónica + arte, en el orden de
// _CAUSE_RULES del backend: lo estructural primero (es lo más
// específico), luego fauna/hidrocarburos/algas; lo demás cae en
// contaminación
const CAUSE_LABEL_RULES: [RegExp, string][] = [
  [/desprend|derrumbe|colapso|acantilado|talud/i, 'Desprendimientos'],
  [/medusa|carabela|fauna/i, 'Medusas'],
  [/gasoil|hidrocarbur|diesel|fuel/i, 'Hidrocarburos'],
  [/alga/i, 'Algas'],
  [/\bobras?\b/i, 'Obras'],
];

// Causas de una fila del historial: se agregan las de todos los
// titulares del episodio (Valleseco: hidrocarburos + algas).
// Sin causa categorizada devuelve [] — quien pinta decide el
// fallback ("Contaminación" salvo "Sin calificar", que no tiene causa)
export function incidentCauses(inc: BeachIncident): string[] {
  const out: string[] = [];
  for (const p of inc.press_items ?? []) {
    const hit = CAUSE_LABEL_RULES.find(([re]) => re.test(p.cause ?? ''));
    if (hit && !out.includes(hit[1])) out.push(hit[1]);
  }
  return out.slice(0, 3);
}

// Familia estructural: granate como el pin/chip de cierre
// estructural, no el rojo de contaminación
export const STRUCT_CAUSES = new Set([
  'Desprendimientos',
  'Colapso del terreno',
  'Obras',
]);

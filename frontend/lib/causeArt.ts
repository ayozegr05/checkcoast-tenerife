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
// Badge de la familia bacteriana (E. coli / enterococos /
// contaminación fecal): indicadores de aguas residuales — un solo
// arte para los tres, distinguirlos por parámetro era ruido a 27px
const BACTERIA_ART = require('../assets/icons/bacteria-art.png');

// Familia bacteriana: estos episodios se narran con DOS badges —
// el emisario (la fuente: hubo vertido) + la bacteria (la evidencia:
// el laboratorio la midió). El E. coli no viene del espíritu santo
const BACTERIAL_LABELS = new Set([
  'E. coli',
  'Enterococos',
  'Contaminación fecal',
]);

// Un parámetro bacteriano implica episodio de contaminación: la
// cadena causal se cuenta emisario (fuente) → bacteria (evidencia)
const withSource = (arts: number[], bacterial: boolean) => {
  if (bacterial && !arts.includes(CONTAM_ART)) arts.unshift(CONTAM_ART);
  return arts;
};
// Tubo + triángulo de aviso: episodio de laboratorio mudo — la
// analítica dijo "prohibido" y nadie demostró cierre
export const LAB_ART = require('../assets/icons/lab-art.png');

export function causeArt(
  cause: string | null | undefined,
  structural: boolean,
): number {
  if (structural) return ROCKFALL_ART;
  // En contextos de un solo badge (chip de estado, banner) el arte
  // bacteriano informa más que el emisario genérico
  if (cause && BACTERIAL_LABELS.has(cause)) return BACTERIA_ART;
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
  [/coli|escherichia/i, 'E. coli'],
  [/enterococo|enterococcus/i, 'Enterococos'],
  [/fecal|residual|bacteria|depuradora/i, 'Contaminación fecal'],
  [/contamin|vertido|calidad del agua/i, 'Contaminación'],
];

const WATER_PARAMS = new Set(['E. coli', 'Enterococos']);

// Causas de una fila del historial: se agregan las de todos los
// titulares del episodio (Valleseco: hidrocarburos + algas), con la
// jerarquía del backend — si se nombra el parámetro las genéricas no
// aportan ("Contaminación fecal · Enterococos · Contaminación ·
// E. coli" decía lo mismo cuatro veces).
// Sin causa categorizada devuelve [] — quien pinta decide el
// fallback ("Contaminación" salvo "Sin calificar", que no tiene causa)
export function incidentCauses(inc: BeachIncident): string[] {
  let out: string[] = [];
  for (const p of inc.press_items ?? []) {
    const hit = CAUSE_LABEL_RULES.find(([re]) => re.test(p.cause ?? ''));
    if (hit && !out.includes(hit[1])) out.push(hit[1]);
  }
  if (out.some((c) => WATER_PARAMS.has(c)))
    out = out.filter((c) => c !== 'Contaminación fecal');
  if (out.length > 1) out = out.filter((c) => c !== 'Contaminación');
  return out.slice(0, 3);
}

// Familia estructural: granate como el pin/chip de cierre
// estructural, no el rojo de contaminación
export const STRUCT_CAUSES = new Set([
  'Desprendimientos',
  'Colapso del terreno',
  'Obras',
]);

// Etiqueta canónica → arte del badge (espejo de _CAUSE_ART del
// backend); lo bacteriológico y lo no categorizado cae en contam —
// Náyade solo vigila E. coli/enterococos
const CAUSE_ART_BY_LABEL: Record<string, number> = {
  Algas: CAUSE_ART.Algas,
  Medusas: CAUSE_ART.Medusas,
  Hidrocarburos: CAUSE_ART.Hidrocarburos,
  Desprendimientos: ROCKFALL_ART,
  'Colapso del terreno': ROCKFALL_ART,
  Obras: ROCKFALL_ART,
  'E. coli': BACTERIA_ART,
  Enterococos: BACTERIA_ART,
  'Contaminación fecal': BACTERIA_ART,
};

// Arte de UNA etiqueta de causa normalizada — la línea temporal
// municipal solo conoce la causa agregada del episodio, no las de
// cada titular: un solo badge
export function causeLabelArt(label: string | null | undefined): number {
  return CAUSE_ART_BY_LABEL[label ?? ''] ?? CONTAM_ART;
}

// Causa agregada del episodio → artes: cada etiqueta aporta su badge
// (causa mixta → tantos como haya) y la familia bacteriana suma el
// emisario como fuente. Lookup insensible a mayúsculas
// ("enterococos"); sin etiqueta categorizada cae en contaminación
export function causeLabelArts(label: string | null | undefined): number[] {
  const arts: number[] = [];
  let bacterial = false;
  for (const l of (label ?? '').split(' y ')) {
    const key = Object.keys(CAUSE_ART_BY_LABEL).find(
      (k) => k.toLowerCase() === l.trim().toLowerCase(),
    );
    if (!key) continue;
    const art = CAUSE_ART_BY_LABEL[key];
    if (!arts.includes(art)) arts.push(art);
    if (BACTERIAL_LABELS.has(key)) bacterial = true;
  }
  return withSource(arts, bacterial).length
    ? withSource(arts, bacterial)
    : [CONTAM_ART];
}

// Badges de una fila de cierre del historial: uno por causa
// distinta del episodio (Valleseco: hidrocarburos + algas), en
// contaminación si ninguna categoriza
export function incidentBadgeArts(inc: BeachIncident): number[] {
  const causes = incidentCauses(inc);
  const arts = [
    ...new Set(
      causes.map((c) => CAUSE_ART_BY_LABEL[c]).filter((a): a is number => !!a),
    ),
  ];
  const out = withSource(
    arts,
    causes.some((c) => BACTERIAL_LABELS.has(c)),
  );
  return out.length ? out : [CONTAM_ART];
}

// Arte del circulito de causa — compartido por el banner de alertas
// (filas) y la ficha de playa (junto al chip de estado). Las etiquetas
// son las canónicas del backend (queries.py); el estructural tiene
// arte propio (rockfall) porque lo marca el flag, no la causa

const CAUSE_ART: Record<string, number> = {
  Algas: require('../assets/icons/algas-art.png'),
  Medusas: require('../assets/icons/medusas-art.png'),
  Hidrocarburos: require('../assets/icons/gasoil-art.png'),
};

export function causeArt(
  cause: string | null | undefined,
  structural: boolean,
): number {
  if (structural) return require('../assets/icons/rockfall-art.png');
  return CAUSE_ART[cause ?? ''] ?? require('../assets/icons/contam-art.png');
}

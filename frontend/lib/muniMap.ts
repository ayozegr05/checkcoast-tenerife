// Mini-mapas de municipio para la sección Municipios — PNGs
// generados por backend/scripts/build_muni_map.py desde los límites
// oficiales del Cabildo de Tenerife (datos.tenerife.es, CC-BY).
// Cada imagen es la isla completa con un municipio resaltado.

// 'San Cristóbal de La Laguna' → 'la-laguna' (acentos fuera,
// espacios a guiones). El dataset del Cabildo usa nombres cortos
// para un par de municipios → alias sobre el nombre ya normalizado
const ALIAS: Record<string, string> = {
  'san-cristobal-de-la-laguna': 'la-laguna',
};

export function muniMapSlug(name: string | null | undefined): string | null {
  if (!name) return null;
  const base = name
    .normalize('NFD')
    .replace(/[́-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-');
  return ALIAS[base] ?? base;
}

// requires estáticos — Metro no resuelve requires dinámicos
const MUNI_MAPS: Record<string, number> = {
  adeje: require('../assets/muni-maps/adeje.png'),
  arafo: require('../assets/muni-maps/arafo.png'),
  arico: require('../assets/muni-maps/arico.png'),
  arona: require('../assets/muni-maps/arona.png'),
  'buenavista-del-norte': require('../assets/muni-maps/buenavista-del-norte.png'),
  candelaria: require('../assets/muni-maps/candelaria.png'),
  'el-rosario': require('../assets/muni-maps/el-rosario.png'),
  'el-sauzal': require('../assets/muni-maps/el-sauzal.png'),
  'el-tanque': require('../assets/muni-maps/el-tanque.png'),
  fasnia: require('../assets/muni-maps/fasnia.png'),
  garachico: require('../assets/muni-maps/garachico.png'),
  'granadilla-de-abona': require('../assets/muni-maps/granadilla-de-abona.png'),
  'guia-de-isora': require('../assets/muni-maps/guia-de-isora.png'),
  guimar: require('../assets/muni-maps/guimar.png'),
  'icod-de-los-vinos': require('../assets/muni-maps/icod-de-los-vinos.png'),
  'la-guancha': require('../assets/muni-maps/la-guancha.png'),
  'la-laguna': require('../assets/muni-maps/la-laguna.png'),
  'la-matanza-de-acentejo': require('../assets/muni-maps/la-matanza-de-acentejo.png'),
  'la-orotava': require('../assets/muni-maps/la-orotava.png'),
  'la-victoria-de-acentejo': require('../assets/muni-maps/la-victoria-de-acentejo.png'),
  'los-realejos': require('../assets/muni-maps/los-realejos.png'),
  'los-silos': require('../assets/muni-maps/los-silos.png'),
  'puerto-de-la-cruz': require('../assets/muni-maps/puerto-de-la-cruz.png'),
  'san-juan-de-la-rambla': require('../assets/muni-maps/san-juan-de-la-rambla.png'),
  'san-miguel-de-abona': require('../assets/muni-maps/san-miguel-de-abona.png'),
  'santa-cruz-de-tenerife': require('../assets/muni-maps/santa-cruz-de-tenerife.png'),
  'santa-ursula': require('../assets/muni-maps/santa-ursula.png'),
  'santiago-del-teide': require('../assets/muni-maps/santiago-del-teide.png'),
  tacoronte: require('../assets/muni-maps/tacoronte.png'),
  tegueste: require('../assets/muni-maps/tegueste.png'),
  vilaflor: require('../assets/muni-maps/vilaflor.png'),
};

export function muniMapImage(name: string | null | undefined) {
  const s = muniMapSlug(name);
  return s ? (MUNI_MAPS[s] ?? null) : null;
}

// Paleta oceánica de la app — única fuente de color
export const colors = {
  // Marca
  primary: '#086b96', // azul mar (botones, acentos)
  primaryDark: '#075276', // mar profundo (headers, splash)
  accent: '#17b8ce', // turquesa
  sand: '#f6ead4',

  // Superficies
  background: '#f2f7f8',
  surface: '#ffffff',
  border: '#dfeef1',

  // Texto
  text: '#16323f',
  textMuted: '#5c7a89',
  textFaint: '#8fa3ad',
  // Texto/iconos blancos sobre superficie de color (chips, botones)
  onColor: '#ffffff',

  // Estado de playa — el mismo color en mapa, lista y detalle
  status: {
    open: '#0d9488', // verde mar = apta
    warning: '#e65100',
    closed: '#d50000',
    // Granate del pin estructural: cerrada crónica, no urgente —
    // solo lo usa el banner; en la ficha cerrada sigue siendo rojo
    structural: '#8c322a',
    // Añil de fauna marina: cerrada transitoria que no contamina el
    // agua (medusas/carabelas) — el tono sale de medusas-art
    fauna: '#4f6ab8',
    // Ámbar de episodio de laboratorio mudo: dato de analítica sin
    // cierre demostrado — ni rojo de cierre ni naranja de aviso.
    // Mismo #f9a825 que la ficha web (share_context._is_mute)
    lab: '#f9a825',
    unknown: '#8fa3ad',
    unmonitored: '#8fa3ad',
  } as Record<string, string>,

  // Emisarios (censo de vertidos — dominio aparte)
  outfall: {
    legal: '#2e7d32',
    illegal: '#d50000',
    unknown: '#f9a825',
  } as Record<string, string>,

  // Banda de riesgo por proximidad a emisario (outfallRisk.ts)
  risk: {
    alto: '#d84315',
    medio: '#f9a825',
    bajo: '#0d9488',
  },

  danger: '#c62828',
  on: '#2e7d32',
  off: '#bdbdbd',

  // Skeleton de carga — "sea-glass", hijo claro del océano del mapa
  skeleton: '#c3e3ea',

  // Sombras de tarjetas y asa de la hoja arrastrable
  shadow: '#000000',

  // Tintes de banners contextuales (no son estado de playa)
  tintPress: '#fff3e0', // ámbar suave — "según prensa"
  tintReopen: '#e6f4f1', // verdoso suave — reapertura
  tintNotice: '#fff8e6', // aviso informativo en ayuda
  noticeBorder: '#f0b429',
  cardBorder: '#b9d3dd', // separa la card flotante del mapa
  link: '#1a7f96',
};

// Familias Nunito cargadas en App.tsx con useFonts
export const fonts = {
  regular: 'Nunito_400Regular',
  semibold: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
  extrabold: 'Nunito_800ExtraBold',
};

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

  // Estado de playa — el mismo color en mapa, lista y detalle
  status: {
    open: '#0d9488', // verde mar = apta
    warning: '#e65100',
    closed: '#c62828',
    unknown: '#8fa3ad',
    unmonitored: '#8fa3ad',
  } as Record<string, string>,

  // Emisarios (censo de vertidos — dominio aparte)
  outfall: {
    legal: '#2e7d32',
    illegal: '#c62828',
    unknown: '#f9a825',
  } as Record<string, string>,

  danger: '#c62828',
  on: '#2e7d32',
  off: '#bdbdbd',

  // Skeleton de carga — "sea-glass", hijo claro del océano del mapa
  skeleton: '#c3e3ea',
};

// Familias Nunito cargadas en App.tsx con useFonts
export const fonts = {
  regular: 'Nunito_400Regular',
  semibold: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
  extrabold: 'Nunito_800ExtraBold',
};

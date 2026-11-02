import { Platform, StatusBar, StyleSheet } from 'react-native';

import { colors, fonts } from '../../lib/theme';

// Hoja de estilos compartida por MunicipalityStats y sus subcomponentes
// en components/stats/ — las filas, badges y chips mantienen el mismo
// lenguaje visual en las tres vistas del panel
export const styles = StyleSheet.create({
  // Feedback táctil común: leve fundido al presionar
  pressFx: {
    opacity: 0.6,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerBlock: {
    paddingTop:
      (Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 24) + 10,
    paddingBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 18,
    fontFamily: fonts.extrabold,
    color: colors.onColor,
  },
  close: {
    fontSize: 20,
    fontFamily: fonts.extrabold,
    color: 'rgba(255,255,255,0.9)',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  subtitle: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: 'rgba(255,255,255,0.85)',
    paddingHorizontal: 16,
    marginTop: 16,
  },
  // Cabecera del detalle municipal: mini-mapa de la isla
  // centrado como pieza visual y línea de contexto debajo
  headerSplit: {
    alignItems: 'center',
    marginTop: 10,
  },
  // Línea de contexto del detalle ("4 episodios · 2/15 playas ›")
  subtitleCount: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 6,
  },
  // Mini-conmutador de ámbito en el detalle (año ↔ histórico)
  scopeTabs: {
    flexDirection: 'row',
    marginTop: 8,
    // 10px: el vocabulario de esquinas de la app vive en 8-12 —
    // a 14 el toggle era una cápsula y chirriaba con las facetas
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
    overflow: 'hidden',
  },
  scopeTab: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  scopeTabActive: { backgroundColor: 'rgba(255,255,255,0.95)' },
  // › rotado del selector de año — mismo idioma que las facetas
  scopeTabChevron: {
    fontSize: 14,
    fontFamily: fonts.semibold,
    color: 'rgba(255,255,255,0.85)',
    transform: [{ rotate: '90deg' }],
    marginLeft: 4,
  },
  scopeTabChevronOpen: { transform: [{ rotate: '-90deg' }] },
  scopeTabText: {
    fontSize: 11,
    fontFamily: fonts.bold,
    color: 'rgba(255,255,255,0.85)',
  },
  scopeTabTextActive: { color: colors.primaryDark },
  // Selector de año plegable bajo el conmutador de ámbito
  yearRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 8,
    maxWidth: 280,
  },
  yearOption: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    // 8px: mismo radio absoluto que el toggle se lee más curvo en
    // un elemento más bajo — compensación óptica, y casa con los
    // filterTab del ranking (misma familia de elemento)
    borderRadius: 8,
    marginHorizontal: 3,
    marginVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  yearOptionActive: { backgroundColor: 'rgba(255,255,255,0.95)' },
  yearOptionText: {
    fontSize: 11,
    fontFamily: fonts.bold,
    color: 'rgba(255,255,255,0.85)',
  },
  yearOptionTextActive: { color: colors.primaryDark },
  // Pie del selector: explica por qué la suma de chips puede
  // superar el total histórico (episodios que cruzan años)
  yearNote: {
    fontSize: 9.5,
    fontFamily: fonts.regular,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 5,
    textAlign: 'center',
  },
  // Segmento-enlace dentro del contador ("2/15 playas ›")
  muniLinkPart: {
    color: 'rgba(255,255,255,0.95)',
    textDecorationLine: 'underline',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: 12,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 10,
    paddingHorizontal: 14,
    elevation: 2,
  },
  searchIcon: {
    width: 16,
    height: 16,
    tintColor: colors.textFaint,
  },
  // Titular del ámbito activo — la "noticia" de la pantalla antes
  // del desglose por municipio
  scopeNote: {
    fontSize: 11.5,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'left',
    paddingHorizontal: 16,
    marginTop: 6,
    marginBottom: 2,
  },
  search: {
    flex: 1,
    paddingVertical: 10,
    paddingLeft: 8,
    fontSize: 15,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  list: {
    flex: 1,
    marginTop: 4,
  },
  // Cabecera de mes en las cronologías — marca el ritmo temporal;
  // fondo opaco porque es sticky mientras se hace scroll
  monthHeader: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    backgroundColor: colors.background,
  },
  listContent: {
    // Aire entre la cabecera del municipio y la primera tarjeta —
    // el resto del espaciado lo hace marginBottom de cada fila
    paddingTop: 10,
    paddingBottom: Platform.OS === 'android' ? 34 : 8, // barra de gestos
  },
  row: {
    backgroundColor: colors.surface,
    marginHorizontal: 12,
    marginBottom: 6,
    borderRadius: 10,
    padding: 12,
    elevation: 1,
  },
  // Miniatura de silueta municipal + contenido — la forma da
  // identidad a cada fila sin repetir la isla entera
  rowBody: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  rowShape: {
    width: 50,
    height: 50,
  },
  rowContent: {
    flex: 1,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowName: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.text,
    flex: 1,
  },
  rowBeaches: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginLeft: 8,
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginTop: 8,
    overflow: 'hidden',
  },
  barFill: {
    height: 6,
    borderRadius: 3,
  },
  rowStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 11,
    fontFamily: fonts.bold,
    color: colors.onColor,
    overflow: 'hidden',
  },
  // Badge al final de una cabecera de fila: no se aplasta y deja
  // aire al nombre truncado
  badgeTail: {
    flexShrink: 0,
    marginLeft: 8,
  },
  // Fila de episodio: miniatura satélite a la izquierda (mismo tamaño
  // que el thumb de BeachList — 52 px) + cuerpo que se estira
  epMain: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  epThumb: {
    width: 52,
    height: 52,
    borderRadius: 8,
    marginRight: 10,
    backgroundColor: colors.border,
  },
  epBody: {
    flex: 1,
  },
  badgeClosed: {
    backgroundColor: colors.status.closed,
  },
  badgeStructural: {
    backgroundColor: colors.status.structural,
  },
  badgeFauna: {
    backgroundColor: colors.status.fauna,
  },
  badgeWarning: {
    backgroundColor: colors.status.warning,
  },

  viewToggle: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 10,
    backgroundColor: colors.border,
    borderRadius: 8,
    padding: 2,
  },
  viewTab: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
  },
  viewTabOn: {
    backgroundColor: colors.surface,
  },
  viewTabText: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
  },
  viewTabTextOn: {
    color: colors.primaryDark,
  },
  // Pestañas-faceta del acordeón — mismo lenguaje que las barras de
  // filtros de Emisarios/Playas: label pequeño + valor + contador,
  // chevron que gira al abrir. Solo puede haber un panel abierto
  filterTabs: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  filterTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(8,107,150,0.14)',
  },
  filterTabOpen: {
    backgroundColor: colors.accent,
    borderColor: 'transparent',
  },
  filterTabText: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  filterTabLabel: {
    fontSize: 10,
    fontFamily: fonts.semibold,
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  filterTabValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  filterTabValue: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: colors.text,
    textAlign: 'center',
    flexShrink: 1,
  },
  // Contador aparte del valor: nunca se corta — el nombre largo se
  // trunca ("Riesgo estructu…") pero "(4)" sobrevive
  filterTabCount: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: colors.text,
    flexShrink: 0,
  },
  filterTabChevron: {
    fontSize: 15,
    fontFamily: fonts.semibold,
    color: colors.primaryDark,
    transform: [{ rotate: '90deg' }],
    marginLeft: 3,
  },
  filterTabChevronOpen: {
    transform: [{ rotate: '-90deg' }],
    color: colors.text,
  },
  // Separador entre la fila de pestañas y el panel de chips abierto
  filterBarDivider: {
    height: 1,
    backgroundColor: 'rgba(8,107,150,0.18)',
    marginHorizontal: 10,
    marginTop: 6,
  },
  // Chips-filtro de la vista Temporada (cierres/avisos/activas) —
  // tocando uno se filtra la lista a ese tipo de episodio
  // Barra segmentada de Tipo en las cronologías — mismo idioma que
  // el conmutador de ámbito del detalle pero sobre fondo claro.
  // Selector PRIMARIO de la lista: la distinción con las chips de
  // faceta (plegables) es el punto — dos controles no comparten piel
  tipoSeg: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  tipoSegTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 7,
  },
  tipoSegTabOn: {
    backgroundColor: colors.accent,
  },
  tipoSegText: {
    fontSize: 11.5,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
  },
  tipoSegTextOn: {
    color: colors.onColor,
  },
  seasonChipsWrap: {
    marginTop: 10,
  },
  seasonChips: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
  },
  seasonChip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  seasonChipOn: {
    backgroundColor: colors.accent,
  },
  seasonChipText: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  seasonChipTextOn: {
    color: colors.text,
    fontFamily: fonts.extrabold,
  },
  // Incidente histórico (ya cerrado): outline apagado — el sólido se
  // reserva a los activos para que no se lean como vigentes
  badgeEnded: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textMuted,
  },
  tlDotEnded: {
    backgroundColor: colors.textFaint,
  },
  rowSub: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 6,
  },
  // La fracción «2 de 15 playas afectadas» va en su propia línea y
  // un pelín más marcada — es el dato clave de la fila; los nombres
  // cuelgan debajo en tono subordinado
  rowSubStrong: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.text,
    marginTop: 6,
  },
  rowSubNames: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 1,
  },
  empty: {
    textAlign: 'center',
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 40,
  },
  emptyWrap: {
    marginTop: 40,
    alignItems: 'center',
  },
  emptyNote: {
    fontFamily: fonts.regular,
    color: colors.textFaint,
    textAlign: 'center',
  },
  emptyCta: {
    marginTop: 12,
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: colors.primary,
  },
  emptyCtaText: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: colors.onColor,
  },
  backBtn: {
    marginRight: 4,
  },
  backText: {
    fontSize: 26,
    fontFamily: fonts.semibold,
    color: colors.onColor,
    marginTop: -4,
  },
  listBtn: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginLeft: 8,
  },
  listBtnText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  tlItem: {
    flexDirection: 'row',
    marginHorizontal: 16,
  },
  tlRail: {
    width: 20,
    alignItems: 'center',
  },
  tlDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.surface,
    elevation: 1,
  },
  tlLine: {
    flex: 1,
    width: 2,
    backgroundColor: colors.border,
  },
  // Extremos del rail (antes del primer punto y tras el último):
  // línea invisible que conserva el centrado del nodo
  tlLineStub: {
    backgroundColor: 'transparent',
  },
  // Puente dot→tarjeta: el dot está centrado verticalmente sobre
  // la tarjeta y empieza 6px más allá del rail — el tick cruza ese
  // hueco a la altura del centro del nodo
  tlTick: {
    position: 'absolute',
    top: '50%',
    marginTop: -1,
    right: -6,
    width: 10,
    height: 1.5,
    borderRadius: 1,
  },
  tlDotSkeleton: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 14,
  },
  tlSkeletonTitle: {
    width: '55%',
    height: 13,
  },
  tlSkeletonLine: {
    width: '85%',
    height: 10,
    marginTop: 9,
  },
  tlSkeletonLineShort: {
    width: '65%',
    height: 10,
    marginTop: 6,
  },
  tlBody: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 12,
    marginLeft: 6,
    marginBottom: 10,
    elevation: 1,
    // Raya de acento por causa como las filas de Episodios de la
    // ficha — el color se inyecta en línea
    borderLeftWidth: 3,
  },
  // Dos columnas: contenido a la izquierda y el chevron › como
  // columna hermana — centrado vertical sobre TODO el alto de la
  // tarjeta vía alignSelf, no sobre la primera línea
  tlWrap: {
    flexDirection: 'row',
  },
  tlContent: {
    flex: 1,
  },
  // Dos columnas bajo el título: fechas/fuente a la izquierda,
  // badge de causa (o etiqueta de estado) + causa a la derecha
  tlRow: {
    flexDirection: 'row',
    marginTop: 5,
    // wrap: los titulares desplegados bajan a línea propia a ancho
    // completo, debajo de las dos columnas (como la ficha)
    flexWrap: 'wrap',
  },
  tlMain: {
    flex: 1,
  },
  tlSide: {
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    flexShrink: 0,
    paddingLeft: 8,
    marginTop: 4,
    gap: 1,
  },
  // Badges de causa en fila — uno por parámetro en causas
  // compuestas, mismo idioma que incidentBadges de la ficha
  tlBadges: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 2,
  },
  tlBadge: {
    width: 27,
    height: 27,
  },
  tlState: {
    fontSize: 11,
    fontFamily: fonts.bold,
  },
  tlActive: {
    fontSize: 10,
    fontFamily: fonts.semibold,
  },
  tlHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tlBeach: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.text,
    textAlign: 'center',
  },
  // Sufijo de cala dentro del nombre ("Playa del Médano · Leocadio
  // Machado"): mismo tamaño, sin negrita — matiz dentro del título
  tlZone: {
    fontFamily: fonts.semibold,
    color: colors.textMuted,
  },
  tlDates: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
    marginTop: 4,
  },
  tlObs: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 4,
  },
  // La causa es el "por qué" del episodio: negrita y casi negro,
  // mismo tratamiento que incidentCause en la ficha
  tlCause: {
    fontSize: 11.5,
    fontFamily: fonts.bold,
    color: colors.text,
    marginTop: 2,
    textAlign: 'right',
  },
  // Indicador de que la fila navega — el chevron › de las listas
  // nativas, centrado en el borde derecho (mismo idioma que
  // pmChevron del selector de zonas). Decorativo: la tarjeta entera
  // es el gesto
  tlChevron: {
    // Columna propia: centra sobre el alto completo de la tarjeta
    // (contenido + línea de titulares + titulares desplegados)
    alignSelf: 'center',
    // Aire real respecto al badge y su subtítulo — el carril es la
    // columna misma, no hace falta padding extra en la tarjeta
    paddingLeft: 18,
    paddingRight: 2,
    fontSize: 32,
    fontFamily: fonts.semibold,
    lineHeight: 36,
    // Sin el padding de fuente de Android el glyph no centra bien
    includeFontPadding: false,
  },
  // "Ver titulares" dentro de la columna de texto — margen mínimo:
  // el aire de separación ya lo da la altura de la fila
  tlActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
  // Toggle de titulares — mismo tono que newsToggle en la ficha:
  // color de acento del episodio inyectado en línea
  tlNewsToggle: {
    fontSize: 12,
    fontFamily: fonts.semibold,
  },
  tlTitles: {
    width: '100%',
  },
});

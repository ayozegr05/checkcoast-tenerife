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
    marginTop: 23,
  },
  // Cifra de contexto bajo el subtítulo ("4 episodios · 2 playas")
  subtitleCount: {
    fontSize: 12.5,
    fontFamily: fonts.bold,
    color: 'rgba(255,255,255,0.75)',
    paddingHorizontal: 16,
    marginTop: 3,
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
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rank: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  rankPodium: {
    width: 26,
    height: 26,
    borderRadius: 13,
    elevation: 2,
  },
  rankText: {
    fontSize: 11,
    fontFamily: fonts.extrabold,
    color: colors.onColor,
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
  badgeClosed: {
    backgroundColor: colors.status.closed,
  },
  badgeWarning: {
    backgroundColor: colors.status.warning,
  },
  // Episodio resuelto en la vista Temporada: verde mar
  badgeOpen: {
    backgroundColor: colors.status.open,
  },
  yearLine: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: colors.onColor,
    paddingHorizontal: 16,
    marginTop: 6,
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
  // Chips-filtro de la vista Temporada (cierres/avisos/activas) —
  // tocando uno se filtra la lista a ese tipo de episodio
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
    borderRadius: 12,
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
    marginTop: 14,
    borderWidth: 2,
    borderColor: colors.surface,
    elevation: 1,
  },
  tlLine: {
    flex: 1,
    width: 2,
    backgroundColor: colors.border,
  },
  // Puente dot→tarjeta: el dot está centrado en el rail (20px) y la
  // tarjeta empieza 6px más allá — el tick cruza ese hueco a la
  // altura del centro del dot (marginTop 14 + radio 6 = 20)
  tlTick: {
    position: 'absolute',
    top: 19,
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
  // Cuerpo en dos columnas como la fila de Episodios de la ficha:
  // identidad/fechas/obs a la izquierda, badge de causa (o
  // etiqueta de estado) + causa a la derecha
  tlRow: {
    flexDirection: 'row',
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
    flex: 1,
    marginRight: 8,
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
  // Línea de acciones de la fila: "Ver titulares ▾" a la izquierda
  tlActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
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

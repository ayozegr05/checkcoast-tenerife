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
    color: '#fff',
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
    color: '#fff',
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
    color: '#fff',
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
    color: '#fff',
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
    backgroundColor: '#fff',
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
  tlGo: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.textFaint,
    marginLeft: 6,
    marginTop: -2,
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
    color: '#fff',
  },
  backBtn: {
    marginRight: 4,
  },
  backText: {
    fontSize: 26,
    fontFamily: fonts.semibold,
    color: '#fff',
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
    borderColor: '#fff',
    elevation: 1,
  },
  tlLine: {
    flex: 1,
    width: 2,
    backgroundColor: colors.border,
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
});

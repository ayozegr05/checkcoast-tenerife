import React, { useEffect, useState } from 'react';
import {
  Image,
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import type { GeoFeature, MunicipalityIncident } from '../../lib/api';
import { foldCount, foldSummary } from '../../lib/alertFold';
import { episodeDays } from '../../lib/episodes';
import { beachBaseName, displayBeachName, fmtDate } from '../../lib/format';
import { STRUCTURAL_SECTION, type AlertSection } from '../../lib/mapData';
import { colors, fonts } from '../../lib/theme';

type AlertsBannerProps = {
  closedCount: number;
  warningCount: number;
  alertsOpen: boolean;
  // Total de playas en alerta (cabecera "Activas ahora")
  alertCount: number;
  alertSections: AlertSection[];
  resueltas: MunicipalityIncident[];
  onPress: () => void;
  onOpenAlertBeach: (f: GeoFeature) => void;
  onOpenEpisodeBeach: (beachId: number) => void;
  onOpenTemporada?: () => void;
};

// Pill de estado bajo la topbar + desplegable de playas en alerta
// (contaminación / cierre estructural plegable / avisos) y reabiertas
export default function AlertsBanner({
  closedCount,
  warningCount,
  alertsOpen,
  alertCount,
  alertSections,
  resueltas,
  onPress,
  onOpenAlertBeach,
  onOpenEpisodeBeach,
  onOpenTemporada,
}: AlertsBannerProps) {
  const { height: winH } = useWindowDimensions();
  const hasAlerts = closedCount + warningCount > 0;
  // "N más" de la sección estructural; vuelve a plegarse al cerrar
  const [structuralOpen, setStructuralOpen] = useState(false);
  useEffect(() => {
    if (!alertsOpen) setStructuralOpen(false);
  }, [alertsOpen]);

  return (
    <>
      <Pressable
        style={({ pressed }) => [
          styles.banner,
          {
            backgroundColor: closedCount
              ? colors.status.closed
              : warningCount
                ? colors.status.warning
                : colors.status.open,
          },
          pressed && styles.pressFx,
        ]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Resumen del estado de las playas"
        accessibilityState={{ expanded: alertsOpen }}
      >
        {(closedCount > 0 || warningCount > 0) && (
          <Image
            source={require('../../assets/icons/icon-alert.png')}
            style={styles.bannerIcon}
          />
        )}
        <Text style={styles.bannerText}>
          {closedCount || warningCount
            ? [
                closedCount
                  ? `${closedCount} ${closedCount === 1 ? 'cerrada' : 'cerradas'}`
                  : null,
                warningCount
                  ? `${warningCount} ${warningCount === 1 ? 'aviso' : 'avisos'}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : 'Todas las playas sin incidencias'}
          {hasAlerts ? (alertsOpen ? ' ▴' : ' ▾') : ''}
        </Text>
      </Pressable>
      {alertsOpen && hasAlerts && (
        // Card acotada: sin maxHeight una ola de alertas desbordaba
        // hasta la barra nativa; la lista scrollea y el botón de
        // episodios queda fijo abajo (fuera del ScrollView)
        <View style={[styles.alertList, { maxHeight: winH * 0.62 }]}>
          <ScrollView
            style={styles.alertListScroll}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.alertSection, styles.alertSectionActive]}>
              Activas ahora · {alertCount}
            </Text>
            {alertSections.map(([sectionLabel, features]) => {
              if (features.length === 0) return null;
              const foldable = sectionLabel === STRUCTURAL_SECTION;
              const preview = foldable
                ? foldCount(features.map((f) => f.properties))
                : features.length;
              const hidden = features.slice(preview);
              const shown =
                structuralOpen || !foldable
                  ? features
                  : features.slice(0, preview);
              return (
                <View key={sectionLabel}>
                  {alertSections.length > 1 && (
                    <Text style={styles.alertSubsection}>
                      {sectionLabel} · {features.length}
                    </Text>
                  )}
                  {shown.map((f) => {
                    const s =
                      f.properties.status === 'closed' ? 'closed' : 'warning';
                    return (
                      <Pressable
                        key={
                          (f.properties as { groupKey?: string }).groupKey ??
                          f.id
                        }
                        style={({ pressed }) => [
                          styles.alertRow,
                          pressed && styles.pressFx,
                        ]}
                        onPress={() => onOpenAlertBeach(f)}
                        accessibilityRole="button"
                        accessibilityLabel={`${displayBeachName(
                          beachBaseName(f.properties.name),
                        )}, ${s === 'closed' ? 'cerrada' : 'aviso'}`}
                      >
                        <View
                          style={[
                            styles.alertDot,
                            { backgroundColor: colors.status[s] },
                          ]}
                        />
                        <View style={styles.alertText}>
                          <Text style={styles.alertName} numberOfLines={1}>
                            {displayBeachName(beachBaseName(f.properties.name))}
                          </Text>
                          <Text style={styles.alertSub} numberOfLines={1}>
                            {f.properties.municipality ?? ''}
                          </Text>
                        </View>
                        <View style={styles.alertStateCol}>
                          <Text
                            style={[
                              styles.alertState,
                              { color: colors.status[s] },
                            ]}
                          >
                            {s === 'closed' ? 'Cerrada' : 'Aviso'}
                          </Text>
                          {f.properties.alert_cause ? (
                            <Text style={styles.alertCause} numberOfLines={1}>
                              {f.properties.alert_cause}
                            </Text>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                  {hidden.length > 0 && (
                    <Pressable
                      style={({ pressed }) => [
                        styles.alertRow,
                        pressed && styles.pressFx,
                      ]}
                      onPress={() => {
                        LayoutAnimation.configureNext(
                          LayoutAnimation.Presets.easeInEaseOut,
                        );
                        setStructuralOpen((o) => !o);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: structuralOpen }}
                      accessibilityLabel={
                        structuralOpen
                          ? 'Ver menos cierres estructurales'
                          : `Ver ${hidden.length} cierres estructurales más`
                      }
                    >
                      {structuralOpen ? (
                        <View style={styles.alertDotsSpacer} />
                      ) : (
                        <View style={styles.alertDots}>
                          {[0, 1, 2].map((i) => (
                            <View
                              key={i}
                              style={[
                                styles.alertDotSmall,
                                i > 0 && styles.alertDotStacked,
                                { zIndex: 3 - i },
                              ]}
                            />
                          ))}
                        </View>
                      )}
                      <View style={styles.alertText}>
                        <Text style={styles.alertFoldName}>
                          {structuralOpen
                            ? 'Ver menos'
                            : `${hidden.length} más`}
                        </Text>
                        {!structuralOpen && (
                          <Text style={styles.alertSub} numberOfLines={1}>
                            {foldSummary(
                              hidden.map((f) => f.properties.municipality),
                            )}
                          </Text>
                        )}
                      </View>
                      <Text style={styles.alertFoldChevron}>
                        {structuralOpen ? '▴' : '▾'}
                      </Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
            {resueltas.length > 0 && (
              <Text style={[styles.alertSection, styles.alertSectionResolved]}>
                Reabiertas recientemente · {resueltas.length}
              </Text>
            )}
            {resueltas.map((ep) => (
              <Pressable
                key={`res-${ep.id}-${ep.beach_id}`}
                style={({ pressed }) => [
                  styles.alertRow,
                  pressed && styles.pressFx,
                ]}
                onPress={() => onOpenEpisodeBeach(ep.beach_id)}
                accessibilityRole="button"
                accessibilityLabel={`${displayBeachName(
                  ep.beach_name,
                )}, reabierta`}
              >
                <View
                  style={[
                    styles.alertDot,
                    { backgroundColor: colors.status.open },
                  ]}
                />
                <View style={styles.alertText}>
                  <Text style={styles.alertName} numberOfLines={1}>
                    {displayBeachName(ep.beach_name)}
                  </Text>
                  <Text style={styles.alertSub} numberOfLines={1}>
                    {ep.municipality ?? ''}
                  </Text>
                </View>
                <View style={styles.alertStateCol}>
                  <Text
                    style={[styles.alertState, { color: colors.status.open }]}
                  >
                    Reabierta
                  </Text>
                  <Text style={styles.alertCause} numberOfLines={1}>
                    {ep.closed_at ? fmtDate(ep.closed_at) : ''} ·{' '}
                    {episodeDays(ep)} {episodeDays(ep) === 1 ? 'día' : 'días'}{' '}
                    cerrada
                  </Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
          {onOpenTemporada && (
            <Pressable
              style={({ pressed }) => [
                styles.alertMore,
                pressed && styles.pressFx,
              ]}
              onPress={onOpenTemporada}
              accessibilityRole="button"
              accessibilityLabel="Ver todos los episodios del verano"
            >
              <Text style={styles.alertMoreText}>
                Todos los episodios del verano ›
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  // Feedback táctil común: leve fundido al presionar
  pressFx: {
    opacity: 0.6,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.75)',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  bannerIcon: {
    width: 15,
    height: 15,
    marginRight: 7,
  },
  bannerText: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 17,
    fontFamily: fonts.bold,
  },
  alertList: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 12,
    paddingVertical: 4,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  alertListScroll: {
    // Cede altura al botón fijo de abajo cuando la lista crece
    flexShrink: 1,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 10,
  },
  alertDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  alertText: {
    flex: 1,
  },
  // Fila "N más": misma rejilla que una playa, con 3 puntos apilados
  // en el hueco del punto de estado
  alertDots: {
    width: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertDotsSpacer: {
    width: 10,
  },
  alertDotSmall: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.status.closed,
    borderWidth: 1,
    borderColor: '#fff',
  },
  alertDotStacked: {
    marginLeft: -5,
    opacity: 0.7,
  },
  alertFoldName: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  alertFoldChevron: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  alertName: {
    fontSize: 14,
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  alertSub: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 1,
  },
  alertStateCol: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  alertState: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fonts.bold,
  },
  // Causa bajo "Cerrada": "Contaminación", "Desprendimientos"...
  alertCause: {
    fontSize: 10,
    lineHeight: 13,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
    marginTop: 1,
  },
  // Separador de sección: banda rellena a todo lo ancho — se distingue
  // a primera vista de los hairlines de cada fila
  alertSection: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fonts.extrabold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  // Subsección dentro de "Activas ahora" (contaminación vs cierre
  // estructural): más discreta que la banda de sección
  alertSubsection: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fonts.extrabold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 4,
  },
  // Activa = peligro suave; resuelta = alivio
  alertSectionActive: {
    backgroundColor: 'rgba(198,40,40,0.10)',
    color: colors.status.closed,
  },
  alertSectionResolved: {
    backgroundColor: 'rgba(13,148,136,0.10)',
    color: colors.status.open,
  },
  alertMore: {
    marginHorizontal: 12,
    marginVertical: 10,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.status.closed,
    alignItems: 'center',
    elevation: 2,
  },
  alertMoreText: {
    fontSize: 15,
    fontFamily: fonts.extrabold,
    color: '#fff',
  },
});

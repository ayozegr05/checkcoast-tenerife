import React, { useState } from 'react';
import {
  Image,
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import ScrollChips from '../ScrollChips';
import { SortMode } from '../../lib/beachGroups';
import { BEACH_STATE_LABEL } from '../../lib/structural';
import { colors, fonts } from '../../lib/theme';

const STATUS_LABELS = BEACH_STATE_LABEL;

// Versión corta para la cara de la pestaña (≈100 px + contador):
// "Cerrada · estructural" → "Estructural". El resto conserva el
// label completo y se trunca donde haga falta — el contador va
// aparte y siempre sobrevive
const STATUS_TAB_LABELS: Record<string, string> = {
  ...STATUS_LABELS,
  structural: 'Estructural',
};

const STATUS_COLORS = colors.status;

const SORT_LABELS: Record<SortMode, string> = {
  // 'estado' se nombra por su efecto visible (como sus hermanos):
  // las cerradas encabezan la lista, luego avisos, aptas y sin
  // monitorizar — es el orden con el que abre la app
  estado: 'Cerradas primero',
  aptas: 'Aptas primero',
  cierres: 'Más cierres',
  calidad: 'Peor calidad del agua',
};

export type FilterTab = 'muni' | 'estado' | 'orden';

// Buscador + barra de filtros (acordeón Municipio/Estado/Orden) de la
// lista de playas. Toda la selección vive en el padre (alimenta
// buildGroups); aquí solo queda el estado visual del acordeón y los
// conteos ya calculados por opción.
export default function SearchHeader({
  query,
  onQueryChange,
  municipality,
  onMunicipalityChange,
  statusFilter,
  onStatusFilterChange,
  sortMode,
  onSortModeChange,
  resultCount,
  municipalities,
  muniCounts,
  allCount,
  hasUnassigned,
  presentStatuses,
  statusCounts,
  impecablesCount,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  // undefined = sin filtro (Todos); null = "Sin municipio"
  municipality: string | null | undefined;
  onMunicipalityChange: (m: string | null | undefined) => void;
  statusFilter: string | undefined;
  onStatusFilterChange: (s: string | undefined) => void;
  sortMode: SortMode;
  onSortModeChange: (m: SortMode) => void;
  resultCount: number;
  municipalities: string[];
  muniCounts: Map<string | null, number>;
  allCount: number;
  hasUnassigned: boolean;
  presentStatuses: string[];
  statusCounts: Map<string, number>;
  impecablesCount: number;
}) {
  // Barra de filtros en modo acordeón: tres botones (Municipio /
  // Estado / Orden) muestran la selección actual; solo se despliega
  // la fila de chips de la categoría abierta
  const [openFilter, setOpenFilter] = useState<FilterTab | null>(null);

  return (
    <>
      <View style={styles.searchWrap}>
        <Image
          source={require('../../assets/icons/icon-search.png')}
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.search}
          placeholder="Busca tu playa…"
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={onQueryChange}
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel="Buscar playa por nombre"
        />
      </View>

      <ImageBackground
        source={require('../../assets/gradient-filter.png')}
        style={styles.filterBar}
        imageStyle={styles.filterBarImg}
      >
        {/* Tres desplegables (una fila en vez de tres): cada
            botón enseña su categoría + selección actual y abre
            su propia fila de chips — acordeón, una a la vez */}
        <View style={styles.filterTabs}>
          {(
            [
              {
                key: 'muni' as const,
                label: 'Municipio',
                value:
                  municipality === undefined
                    ? 'Todos'
                    : (municipality ?? 'Sin municipio'),
                count: municipality === undefined ? null : resultCount,
              },
              {
                key: 'estado' as const,
                label: 'Estado',
                // «Todas» concuerda con las opciones femeninas
                // (Apta/Cerrada — hablan de playas); no «todos
                // los estados»
                value:
                  statusFilter === undefined
                    ? 'Todas'
                    : statusFilter === 'impecables'
                      ? 'Agua siempre apta'
                      : STATUS_TAB_LABELS[statusFilter],
                count: statusFilter === undefined ? null : resultCount,
              },
              {
                key: 'orden' as const,
                label: 'Ordenar',
                // En la cara va el rol («Por defecto» cabe sin
                // truncar); el chip dentro dice el criterio real
                // («Cerradas primero»)
                value:
                  sortMode === 'estado' ? 'Por defecto' : SORT_LABELS[sortMode],
                count: null,
              },
            ] as const
          ).map((t) => {
            const open = openFilter === t.key;
            return (
              <Pressable
                key={t.key}
                style={({ pressed }) => [
                  styles.filterTab,
                  open && styles.filterTabOpen,
                  pressed && styles.pressFx,
                ]}
                onPress={() => setOpenFilter(open ? null : t.key)}
                accessibilityRole="button"
                accessibilityLabel={`${t.label}: ${t.value}${
                  t.count != null ? ` (${t.count})` : ''
                }`}
                accessibilityState={{ expanded: open }}
              >
                <View style={styles.filterTabText}>
                  <Text style={styles.filterTabLabel}>{t.label}</Text>
                  <View style={styles.filterTabValueRow}>
                    {t.key === 'estado' &&
                      statusFilter !== undefined &&
                      statusFilter !== 'impecables' && (
                        <View
                          style={[
                            styles.filterTabDot,
                            {
                              backgroundColor: STATUS_COLORS[statusFilter],
                            },
                          ]}
                        />
                      )}
                    <Text style={styles.filterTabValue} numberOfLines={1}>
                      {t.value}
                    </Text>
                    {t.count != null && (
                      <Text style={styles.filterTabCount}>
                        {` (${t.count})`}
                      </Text>
                    )}
                  </View>
                </View>
                <Text
                  style={[
                    styles.filterTabChevron,
                    open && styles.filterTabChevronOpen,
                  ]}
                >
                  ›
                </Text>
              </Pressable>
            );
          })}
        </View>
        {openFilter !== null && <View style={styles.filterBarDivider} />}
        {openFilter === 'muni' && (
          <ScrollChips
            style={styles.chips}
            contentContainerStyle={styles.chipsContent}
            fadeRgbLeft="140,216,230"
            fadeRgbRight="242,251,253"
            a11yLabel="municipios"
          >
            <Pressable
              style={({ pressed }) => [
                styles.chip,
                municipality === undefined && styles.chipActive,
                pressed && styles.pressFx,
              ]}
              onPress={() => onMunicipalityChange(undefined)}
              accessibilityRole="button"
              accessibilityLabel="Mostrar todas las playas"
              accessibilityState={{ selected: municipality === undefined }}
            >
              <Text
                style={[
                  styles.chipText,
                  municipality === undefined && styles.chipTextActive,
                ]}
              >
                {`Todos (${allCount})`}
              </Text>
            </Pressable>
            {municipalities.map((m) => (
              <Pressable
                key={m}
                style={({ pressed }) => [
                  styles.chip,
                  municipality === m && styles.chipActive,
                  pressed && styles.pressFx,
                ]}
                onPress={() =>
                  onMunicipalityChange(municipality === m ? undefined : m)
                }
                accessibilityRole="button"
                accessibilityLabel={`Filtrar por municipio ${m}`}
                accessibilityState={{ selected: municipality === m }}
              >
                <Text
                  style={[
                    styles.chipText,
                    municipality === m && styles.chipTextActive,
                  ]}
                >
                  {`${m} (${muniCounts.get(m) ?? 0})`}
                </Text>
              </Pressable>
            ))}
            {hasUnassigned && (
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  municipality === null && styles.chipActive,
                  pressed && styles.pressFx,
                ]}
                onPress={() =>
                  onMunicipalityChange(municipality === null ? undefined : null)
                }
                accessibilityRole="button"
                accessibilityLabel="Filtrar por playas sin municipio"
                accessibilityState={{ selected: municipality === null }}
              >
                <Text
                  style={[
                    styles.chipText,
                    municipality === null && styles.chipTextActive,
                  ]}
                >
                  {`Sin municipio (${muniCounts.get(null) ?? 0})`}
                </Text>
              </Pressable>
            )}
          </ScrollChips>
        )}
        {openFilter === 'estado' && (
          <ScrollChips
            style={styles.chips}
            contentContainerStyle={styles.chipsContent}
            fadeRgbLeft="140,216,230"
            fadeRgbRight="242,251,253"
            a11yLabel="filtros de estado"
          >
            {presentStatuses.map((s) => (
              <Pressable
                key={s}
                style={({ pressed }) => [
                  styles.chip,
                  styles.chipStatus,
                  statusFilter === s && styles.chipActive,
                  pressed && styles.pressFx,
                ]}
                onPress={() =>
                  onStatusFilterChange(statusFilter === s ? undefined : s)
                }
                accessibilityRole="button"
                accessibilityLabel={`Filtrar por estado ${STATUS_LABELS[s]}`}
                accessibilityState={{ selected: statusFilter === s }}
              >
                <View
                  style={[
                    styles.chipDot,
                    { backgroundColor: STATUS_COLORS[s] },
                  ]}
                />
                <Text
                  style={[
                    styles.chipText,
                    statusFilter === s && styles.chipTextActive,
                  ]}
                >
                  {`${STATUS_LABELS[s]} (${statusCounts.get(s) ?? 0})`}
                </Text>
              </Pressable>
            ))}
            {/* «Agua siempre apta» es un filtro de estado (récord
              limpio), no un orden: vive en este panel aunque su
              activación también fije el orden interno a Estado */}
            <Pressable
              style={({ pressed }) => [
                styles.chip,
                statusFilter === 'impecables' && styles.chipActive,
                pressed && styles.pressFx,
              ]}
              onPress={() => {
                if (statusFilter === 'impecables') return;
                onStatusFilterChange('impecables');
                onSortModeChange('estado');
              }}
              accessibilityRole="button"
              accessibilityLabel="Filtrar por playas que nunca tuvieron un problema de agua"
              accessibilityState={{
                selected: statusFilter === 'impecables',
              }}
            >
              <Text
                style={[
                  styles.chipText,
                  statusFilter === 'impecables' && styles.chipTextActive,
                ]}
              >
                {`Agua siempre apta (${impecablesCount})`}
              </Text>
            </Pressable>
          </ScrollChips>
        )}
        {openFilter === 'orden' && (
          /* Ordenar (radio puro): el orden siempre es uno. Con «Agua
        siempre apta» activo el orden interno es Estado pero el
        chip no se marca — solo un chip activo a la vez */
          <ScrollChips
            style={styles.chips}
            contentContainerStyle={styles.chipsContent}
            fadeRgbLeft="140,216,230"
            fadeRgbRight="242,251,253"
            a11yLabel="ordenar"
          >
            {(['estado', 'aptas', 'cierres', 'calidad'] as const).map(
              (item) => (
                <Pressable
                  key={item}
                  style={({ pressed }) => [
                    styles.chip,
                    sortMode === item &&
                      statusFilter !== 'impecables' &&
                      styles.chipActive,
                    pressed && styles.pressFx,
                  ]}
                  onPress={() => {
                    onSortModeChange(item);
                    // Elegir un orden sale del modo "Agua siempre apta"
                    if (statusFilter === 'impecables')
                      onStatusFilterChange(undefined);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Ordenar: ${SORT_LABELS[item]}`}
                  accessibilityState={{
                    selected:
                      sortMode === item && statusFilter !== 'impecables',
                  }}
                >
                  <Text
                    style={[
                      styles.chipText,
                      sortMode === item &&
                        statusFilter !== 'impecables' &&
                        styles.chipTextActive,
                    ]}
                  >
                    {SORT_LABELS[item]}
                  </Text>
                </Pressable>
              ),
            )}
          </ScrollChips>
        )}
      </ImageBackground>

      {statusFilter === 'impecables' && (
        <Text style={styles.impecablesNote}>
          Solo playas monitorizadas por Sanidad: cero muestras no aptas y cero
          episodios de contaminación
        </Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    margin: 12,
    marginBottom: 8,
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
  // Barra única que contiene las dos filas de filtros sobre una
  // aguada del degradado mar (40%: misma familia que la cabecera
  // pero sin competir con ella); la divisoria separa "dónde"
  // (municipios) de "cómo/cuál" (orden + estado)
  filterBar: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    marginHorizontal: 12,
    marginBottom: 4,
    overflow: 'hidden',
    elevation: 2,
  },
  filterBarImg: {
    borderRadius: 10,
  },
  filterBarDivider: {
    height: 1,
    backgroundColor: 'rgba(8,107,150,0.18)',
    marginHorizontal: 10,
  },
  // Pestañas desplegables: una sola fila resume las 3 categorías —
  // cada una muestra qué hay seleccionado sin ocupar filas de chips
  filterTabs: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
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
    color: colors.text, // navy como el valor: jerarquía por tamaño, no por gris lavado
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
  // Dot del color de estado en la pestaña cerrada: el lenguaje
  // visual de los chips sobrevive al acordeón
  filterTabDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  filterTabValue: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: colors.text,
    textAlign: 'center',
    flexShrink: 1,
  },
  // Contador aparte del valor: nunca se corta — el nombre largo se
  // trunca ("Buenavista del N…") pero "(9)" sobrevive
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
  chips: {
    flexGrow: 0,
  },
  chipsContent: {
    paddingHorizontal: 8,
    gap: 4,
    paddingVertical: 6,
  },
  // Nota aclaratoria del filtro "Agua siempre apta": solo cuenta
  // playas vigiladas (las OSM sin vigilancia no tienen muestras)
  impecablesNote: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  // Segmentos de la barra: transparentes (no son botones sueltos) —
  // la presencia la da el texto navy, no un relleno
  chip: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipActive: {
    backgroundColor: colors.accent,
  },
  chipText: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: colors.text, // navy: presencia sin relleno de boton
  },
  chipTextActive: {
    color: colors.text, // navy: mas contraste que blanco sobre turquesa
    fontFamily: fonts.extrabold,
  },
  chipStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pressFx: {
    opacity: 0.6,
  },
});

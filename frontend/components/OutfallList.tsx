import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  ImageBackground,
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import ScrollChips from './ScrollChips';
import { GeoFeature } from '../lib/api';
import { searchNorm } from '../lib/format';
import { outfallRisk, RISK_LABEL } from '../lib/outfallRisk';
import { colors, fonts } from '../lib/theme';

// El censo de vertidos clasifica por situación administrativa:
// los no autorizados primero — son los que interesa ver al bañista
const STATUS_ORDER: Record<string, number> = {
  illegal: 0,
  unknown: 1,
  legal: 2,
};

const STATUS_LABELS: Record<string, string> = {
  illegal: 'No autorizado',
  unknown: 'En trámite',
  legal: 'Autorizado',
};

const STATUS_PLURALS: Record<string, string> = {
  illegal: 'No autorizados',
  unknown: 'En trámite',
  legal: 'Autorizados',
};

const STATUS_COLORS = colors.outfall;

// Nivel de preocupación → color de la píldora de la fila
const RISK_COLORS: Record<string, string> = {
  alto: '#d84315',
  medio: '#f9a825',
  bajo: '#0d9488',
};

// Grupo de sustancia para los chips de filtro — el censo junta
// "residual urbana e industrial" y "residual industrial" aparte
const natureGroup = (n?: string | null) => {
  const s = (n ?? '').toLowerCase();
  if (s.includes('residual') && s.includes('industrial'))
    return 'industrial';
  if (s.includes('residual')) return 'fecal';
  if (s.includes('salmuera')) return 'salmuera';
  if (s.includes('pluvial')) return 'pluvial';
  if (s.includes('piscina')) return 'piscinas';
  if (s.includes('refrigeración')) return 'refrigeración';
  return 'otra';
};

// Orden de izquierda a derecha por preocupación: lo que más importa
// al bañista primero; la lluvia (impacto más leve) cierra la fila
const NATURE_FILTERS: { key: string; label: string }[] = [
  { key: 'fecal', label: 'Fecales' },
  { key: 'zec', label: 'En zona protegida' },
  { key: 'orilla', label: 'En la orilla' },
  { key: 'industrial', label: 'Industrial' },
  { key: 'salmuera', label: 'Salmuera' },
  { key: 'piscinas', label: 'Piscinas' },
  { key: 'pluvial', label: 'Lluvia' },
];

const capName = (name: string) =>
  name
    .toLowerCase()
    .replace(
      /(^|[\s(-])([a-záéíóúñü])/g,
      (_m, pre: string, c: string) => pre + c.toUpperCase(),
    );

type StatusFilter = string | undefined; // undefined = Todos

export default function OutfallList({
  outfalls,
  visible,
  onSelect,
  onClose,
}: {
  outfalls: GeoFeature[];
  visible: boolean;
  onSelect: (feature: GeoFeature) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>(undefined);
  const [municipality, setMunicipality] = useState<string | undefined>(
    undefined,
  );
  const [natureF, setNatureF] = useState<string | undefined>(undefined);
  // Orden por defecto: los que más deberían preocupar arriba
  const [sortMode, setSortMode] = useState<'risk' | 'status'>('risk');

  const municipalities = useMemo(
    () =>
      [
        ...new Set(
          outfalls.map((f) => f.properties.municipality).filter(Boolean),
        ),
      ].sort() as string[],
    [outfalls],
  );

  // Conteos por estado — acotados al municipio activo cuando hay filtro
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of outfalls) {
      if (
        municipality !== undefined &&
        f.properties.municipality !== municipality
      )
        continue;
      const s = f.properties.status ?? 'unknown';
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [outfalls, municipality]);

  // Total por municipio — va en el chip de cada uno
  const muniCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of outfalls) {
      const m = f.properties.municipality;
      if (m) c[m] = (c[m] ?? 0) + 1;
    }
    return c;
  }, [outfalls]);

  // Conteos de la tercera fila — mismo ámbito que los de estado:
  // se acotan al municipio activo cuando hay filtro
  const natureCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of outfalls) {
      if (
        municipality !== undefined &&
        f.properties.municipality !== municipality
      )
        continue;
      const g = natureGroup(f.properties.nature);
      c[g] = (c[g] ?? 0) + 1;
      if (f.properties.protected_area) c.zec = (c.zec ?? 0) + 1;
      const s = f.properties.shore_m;
      if (s != null && s < 50) c.orilla = (c.orilla ?? 0) + 1;
    }
    return c;
  }, [outfalls, municipality]);

  const scopedTotal =
    (counts.illegal ?? 0) + (counts.legal ?? 0) + (counts.unknown ?? 0);

  // Resumen de cabecera: cuántos en zona protegida y de alta
  // preocupación (índice compartido con la ficha)
  const { zecTotal, highTotal } = useMemo(() => {
    let z = 0,
      h = 0;
    for (const f of outfalls) {
      if (f.properties.protected_area) z += 1;
      if (outfallRisk(f.properties).level === 'alto') h += 1;
    }
    return { zecTotal: z, highTotal: h };
  }, [outfalls]);

  const rows = useMemo(() => {
    const q = searchNorm(query);
    return outfalls
      .filter((f) => {
        if (q && !searchNorm(f.properties.name).includes(q))
          return false;
        if (
          status !== undefined &&
          (f.properties.status ?? 'unknown') !== status
        )
          return false;
        if (
          municipality !== undefined &&
          f.properties.municipality !== municipality
        )
          return false;
        if (natureF === 'zec') return !!f.properties.protected_area;
        if (natureF === 'orilla') {
          const s = f.properties.shore_m;
          return s != null && s < 50;
        }
        if (natureF !== undefined)
          return natureGroup(f.properties.nature) === natureF;
        return true;
      })
      .sort((a, b) =>
        sortMode === 'risk'
          ? outfallRisk(b.properties).score -
              outfallRisk(a.properties).score ||
            a.properties.name.localeCompare(b.properties.name)
          : (STATUS_ORDER[a.properties.status ?? 'unknown'] ?? 9) -
              (STATUS_ORDER[b.properties.status ?? 'unknown'] ?? 9) ||
            (a.properties.municipality ?? '').localeCompare(
              b.properties.municipality ?? '',
            ) ||
            a.properties.name.localeCompare(b.properties.name),
      );
  }, [outfalls, query, status, municipality, natureF, sortMode]);

  return (
    <Modal
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <ImageBackground
          source={require('../assets/gradient-sea.png')}
          style={styles.header}
          resizeMode="cover"
        >
          <View style={styles.headerRow}>
            <Text style={[styles.title, { flex: 1, textAlign: 'center' }]}>
              Emisarios al mar
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={({ pressed }) => [
                styles.closeBtn,
                pressed && styles.pressFx,
              ]}
            >
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.subtitle}>
            {municipality
              ? `${municipality} · ${counts.illegal ?? 0} no autorizados · ${counts.legal ?? 0} autorizados · ${counts.unknown ?? 0} en trámite`
              : `${outfalls.length} puntos de vertido · ${
                  (counts.illegal ?? 0) + (counts.unknown ?? 0)
                } sin autorizar · ${zecTotal} en zona protegida · ${highTotal} de alta preocupación`}
          </Text>
          {!municipality && (
            <Text style={styles.source}>Censo Tierra-Mar 2025 (Gob. Canarias)</Text>
          )}
        </ImageBackground>

        <View style={styles.searchWrap}>
          <Image
            source={require('../assets/icons/icon-search.png')}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.search}
            placeholder="Busca tu emisario…"
            placeholderTextColor={colors.textFaint}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            clearButtonMode="while-editing"
            accessibilityLabel="Buscar emisario por nombre"
          />
        </View>

        <ImageBackground
          source={require('../assets/gradient-filter.png')}
          style={styles.filterBar}
          imageStyle={styles.filterBarImg}
        >
        <ScrollChips
          style={styles.chips}
          contentContainerStyle={styles.chipsContent}
          fadeRgbLeft="140,216,230"
          fadeRgbRight="242,251,253"
        >
          <Pressable
            style={({ pressed }) => [
              styles.chip,
              status === undefined && styles.chipActive,
              pressed && styles.pressFx,
            ]}
            onPress={() => setStatus(undefined)}
          >
            <Text
              style={[
                styles.chipText,
                status === undefined && styles.chipTextActive,
              ]}
            >
              Todos ({scopedTotal})
            </Text>
          </Pressable>
          {(['illegal', 'unknown', 'legal'] as const).map((s) => (
            <Pressable
              key={s}
              style={({ pressed }) => [
                styles.chip,
                status === s && styles.chipActive,
                pressed && styles.pressFx,
              ]}
              onPress={() => setStatus(status === s ? undefined : s)}
            >
              <Text
                style={[
                  styles.chipText,
                  status === s && styles.chipTextActive,
                ]}
              >
                {STATUS_PLURALS[s]} ({counts[s] ?? 0})
              </Text>
            </Pressable>
          ))}
        </ScrollChips>
        <View style={styles.filterBarDivider} />
        <ScrollChips
          style={styles.chips}
          contentContainerStyle={styles.chipsContent}
          fadeRgbLeft="140,216,230"
          fadeRgbRight="242,251,253"
        >
          <Pressable
            style={({ pressed }) => [
              styles.chip,
              municipality === undefined && styles.chipActive,
              pressed && styles.pressFx,
            ]}
            onPress={() => setMunicipality(undefined)}
          >
            <Text
              style={[
                styles.chipText,
                municipality === undefined && styles.chipTextActive,
              ]}
            >
              Todos los municipios
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
                setMunicipality(municipality === m ? undefined : m)
              }
            >
              <Text
                style={[
                  styles.chipText,
                  municipality === m && styles.chipTextActive,
                ]}
              >
                {m} ({muniCounts[m] ?? 0})
              </Text>
            </Pressable>
          ))}
        </ScrollChips>
        <View style={styles.filterBarDivider} />
        {/* Tercera fila: qué se vierte + cómo ordenar (preocupación
            por defecto — los vertidos que importan arriba) */}
        <ScrollChips
          style={styles.chips}
          contentContainerStyle={styles.chipsContent}
          fadeRgbLeft="140,216,230"
          fadeRgbRight="242,251,253"
        >
          {NATURE_FILTERS.map((nf) => (
            <Pressable
              key={nf.key}
              style={({ pressed }) => [
                styles.chip,
                natureF === nf.key && styles.chipActive,
                pressed && styles.pressFx,
              ]}
              onPress={() =>
                setNatureF(natureF === nf.key ? undefined : nf.key)
              }
            >
              <Text
                style={[
                  styles.chipText,
                  natureF === nf.key && styles.chipTextActive,
                ]}
              >
                {nf.label} ({natureCounts[nf.key] ?? 0})
              </Text>
            </Pressable>
          ))}
          <Pressable
            style={({ pressed }) => [
              styles.chip,
              styles.chipSort,
              pressed && styles.pressFx,
            ]}
            onPress={() =>
              setSortMode((m) => (m === 'risk' ? 'status' : 'risk'))
            }
          >
            <Text style={styles.chipText}>
              {sortMode === 'risk'
                ? 'Orden: preocupación ↓'
                : 'Orden: estado legal'}
            </Text>
          </Pressable>
        </ScrollChips>
        </ImageBackground>

        <FlatList
          data={rows}
          keyExtractor={(f) => String(f.id)}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          renderItem={({ item: f }) => {
            const s = f.properties.status ?? 'unknown';
            const risk = outfallRisk(f.properties);
            const p = f.properties;
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.row,
                  pressed && styles.pressFx,
                ]}
                onPress={() => onSelect(f)}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowName}>
                    {capName(f.properties.name)}
                  </Text>
                  <Text style={styles.rowSub}>
                    {f.properties.municipality ?? 'Sin municipio'}
                    {f.properties.nature
                      ? ` · ${f.properties.nature}`
                      : ''}
                  </Text>
                  {/* Minibadges escaneables: avisos sin abrir la
                      ficha */}
                  <View style={styles.rowBadges}>
                    {p.protected_area ? (
                      <Text style={styles.miniBadge}>🛡 ZEC</Text>
                    ) : null}
                    {p.condition === 'Malo' ||
                    p.condition === 'Precario' ? (
                      <Text
                        style={[
                          styles.miniBadge,
                          {
                            color:
                              p.condition === 'Malo'
                                ? colors.outfall.illegal
                                : colors.status.warning,
                          },
                        ]}
                      >
                        ⚠ {p.condition.toLowerCase()}
                      </Text>
                    ) : null}
                    {p.start_lat != null ? (
                      <Text style={styles.miniBadge}>⤴ trazado</Text>
                    ) : null}
                  </View>
                </View>
                <View style={styles.rowBadgeCol}>
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: STATUS_COLORS[s] },
                    ]}
                  >
                    <Text style={styles.badgeText}>
                      {STATUS_LABELS[s]}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.badge,
                      styles.riskBadge,
                      { backgroundColor: RISK_COLORS[risk.level] },
                    ]}
                  >
                    <Text style={styles.badgeText}>
                      {RISK_LABEL[risk.level]}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text style={styles.empty}>Sin resultados</Text>
          }
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Feedback táctil común: leve fundido al presionar
  pressFx: {
    opacity: 0.6,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingTop:
      (Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 24) +
      10,
    paddingBottom: 12,
  },
  headerRow: {
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
  subtitle: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: 'rgba(255,255,255,0.85)',
    paddingHorizontal: 16,
    marginTop: 23,
  },
  source: {
    fontSize: 10,
    fontFamily: fonts.regular,
    color: 'rgba(255,255,255,0.55)',
    paddingHorizontal: 16,
    marginTop: 2,
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
  // Barra única sobre la misma aguada del degradado mar que en la
  // lista de playas, con las dos filas separadas por divisoria
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
  chips: {
    flexGrow: 0,
  },
  chipsContent: {
    paddingHorizontal: 8,
    gap: 4,
    paddingVertical: 6,
  },
  // Segmentos transparentes: la presencia la da el texto navy
  chip: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipActive: {
    backgroundColor: colors.accent,
  },
  chipText: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.text, // navy sobre la aguada marina
  },
  chipTextActive: {
    color: colors.text, // navy sobre turquesa
    fontFamily: fonts.extrabold,
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
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 1,
  },
  rowText: {
    flex: 1,
    marginRight: 8,
  },
  rowName: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  rowSub: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 2,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  rowBadgeCol: {
    alignItems: 'flex-end',
    gap: 4,
  },
  // Píldora de preocupación bajo el badge legal — mismo tamaño para
  // que la columna quede ordenada
  riskBadge: {
    opacity: 0.92,
  },
  rowBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  miniBadge: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
  },
  chipSort: {
    marginLeft: 8,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(8,107,150,0.18)',
    borderRadius: 0,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: fonts.bold,
    color: '#fff',
  },
  empty: {
    textAlign: 'center',
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 40,
  },
});

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
import { capName, searchNorm } from '../lib/format';
import {
  outfallRisk,
  isShallowDischarge,
  RISK_LABEL,
  RISK_COLORS,
  RiskLevel,
} from '../lib/outfallRisk';
import { colors, fonts } from '../lib/theme';

const STATUS_PLURALS: Record<string, string> = {
  illegal: 'No autorizados',
  unknown: 'En trámite',
  legal: 'Autorizados',
};

const STATUS_COLORS = colors.outfall;

// 'alto' → 'Alto' para chips y cara de pestaña (RISK_LABEL trae
// la forma con prefijo 'Riesgo alto')
const RISK_SHORT: Record<RiskLevel, string> = {
  alto: 'Alto',
  medio: 'Medio',
  bajo: 'Bajo',
};

// 'alto' → 'Alto' ya cubierto por RISK_SHORT — la cara del chip
// combobox muestra el valor completo ('No autorizados')

// Grupo de sustancia para los chips de filtro — el censo junta
// "residual urbana e industrial" y "residual industrial" aparte
const natureGroup = (n?: string | null) => {
  const s = (n ?? '').toLowerCase();
  if (s.includes('residual') && s.includes('industrial')) return 'industrial';
  if (s.includes('residual')) return 'fecal';
  if (s.includes('salmuera')) return 'salmuera';
  if (s.includes('pluvial')) return 'pluvial';
  if (s.includes('piscina')) return 'piscinas';
  if (s.includes('refrigeración')) return 'refrigeración';
  return 'otra';
};

const NATURE_FILTERS: { key: string; label: string }[] = [
  { key: 'fecal', label: 'Fecales' },
  { key: 'industrial', label: 'Industrial' },
  { key: 'salmuera', label: 'Salmuera' },
  { key: 'piscinas', label: 'Piscinas' },
  { key: 'pluvial', label: 'Lluvia' },
];

// Estados físicos del censo para el cajón Conducción
const COND_FILTERS = ['Malo', 'Precario', 'Bueno'] as const;

type StatusFilter = string | undefined; // undefined = Todos

// Predicados de la fila + contadores: cada chip cuenta cuántas
// filas daría elegirlo respetando los OTROS filtros activos (regla
// de Playas) — extraídos para compartirlos filas y conteos
const matchesNature = (f: GeoFeature, nf: string | undefined) =>
  nf === undefined || natureGroup(f.properties.nature) === nf;

const matchesCond = (f: GeoFeature, c: string | undefined) =>
  c === undefined || f.properties.condition === c;

// ZEC y orilla son toggles acumulables del cajón Entorno — "orilla"
// usa la misma definición que el índice de riesgo (isShallowDischarge)
const matchesFlags = (f: GeoFeature, zec: boolean, orilla: boolean) => {
  if (zec && !f.properties.protected_area) return false;
  if (orilla && !isShallowDischarge(f.properties)) return false;
  return true;
};

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
  const [condF, setCondF] = useState<string | undefined>(undefined);
  const [zecF, setZecF] = useState(false);
  const [orillaF, setOrillaF] = useState(false);
  const [riskF, setRiskF] = useState<RiskLevel | undefined>(undefined);
  // Fila avanzada: los cajones secundarios solo aparecen al pedirlos
  const [advOpen, setAdvOpen] = useState(false);
  // Barra de filtros en modo acordeón (mismo patrón que Playas):
  // cada pestaña muestra la selección actual y solo se despliega
  // la fila de chips de la categoría abierta
  const [openFilter, setOpenFilter] = useState<
    'estado' | 'riesgo' | 'muni' | 'vertido' | 'conduccion' | 'entorno' | null
  >(null);

  const municipalities = useMemo(
    () =>
      [
        ...new Set(
          outfalls.map((f) => f.properties.municipality).filter(Boolean),
        ),
      ].sort() as string[],
    [outfalls],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of outfalls) {
      if (
        municipality !== undefined &&
        f.properties.municipality !== municipality
      )
        continue;
      if (!matchesNature(f, natureF)) continue;
      if (!matchesCond(f, condF)) continue;
      if (!matchesFlags(f, zecF, orillaF)) continue;
      if (riskF !== undefined && outfallRisk(f.properties).level !== riskF)
        continue;
      const s = f.properties.status ?? 'unknown';
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [outfalls, municipality, natureF, condF, zecF, orillaF, riskF]);

  const muniCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of outfalls) {
      if (status !== undefined && (f.properties.status ?? 'unknown') !== status)
        continue;
      if (!matchesNature(f, natureF)) continue;
      if (!matchesCond(f, condF)) continue;
      if (!matchesFlags(f, zecF, orillaF)) continue;
      if (riskF !== undefined && outfallRisk(f.properties).level !== riskF)
        continue;
      const m = f.properties.municipality;
      if (m) c[m] = (c[m] ?? 0) + 1;
    }
    return c;
  }, [outfalls, status, natureF, condF, zecF, orillaF, riskF]);

  const riskCounts = useMemo(() => {
    const c: Partial<Record<RiskLevel, number>> = {};
    for (const f of outfalls) {
      if (
        municipality !== undefined &&
        f.properties.municipality !== municipality
      )
        continue;
      if (status !== undefined && (f.properties.status ?? 'unknown') !== status)
        continue;
      if (!matchesNature(f, natureF)) continue;
      if (!matchesCond(f, condF)) continue;
      if (!matchesFlags(f, zecF, orillaF)) continue;
      const r = outfallRisk(f.properties).level;
      c[r] = (c[r] ?? 0) + 1;
    }
    return c;
  }, [outfalls, municipality, status, natureF, condF, zecF, orillaF]);

  const natureCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of outfalls) {
      if (
        municipality !== undefined &&
        f.properties.municipality !== municipality
      )
        continue;
      if (status !== undefined && (f.properties.status ?? 'unknown') !== status)
        continue;
      if (!matchesCond(f, condF)) continue;
      if (!matchesFlags(f, zecF, orillaF)) continue;
      if (riskF !== undefined && outfallRisk(f.properties).level !== riskF)
        continue;
      const g = natureGroup(f.properties.nature);
      c[g] = (c[g] ?? 0) + 1;
    }
    return c;
  }, [outfalls, municipality, status, condF, zecF, orillaF, riskF]);

  const condCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of outfalls) {
      if (
        municipality !== undefined &&
        f.properties.municipality !== municipality
      )
        continue;
      if (status !== undefined && (f.properties.status ?? 'unknown') !== status)
        continue;
      if (!matchesNature(f, natureF)) continue;
      if (!matchesFlags(f, zecF, orillaF)) continue;
      if (riskF !== undefined && outfallRisk(f.properties).level !== riskF)
        continue;
      const cond = f.properties.condition;
      if (cond) c[cond] = (c[cond] ?? 0) + 1;
    }
    return c;
  }, [outfalls, municipality, status, natureF, zecF, orillaF, riskF]);

  // Conteos de los flags de Entorno: ZEC respeta orilla activa y
  // viceversa, además del resto de filtros
  const flagCounts = useMemo(() => {
    const c = { zec: 0, orilla: 0 };
    for (const f of outfalls) {
      if (
        municipality !== undefined &&
        f.properties.municipality !== municipality
      )
        continue;
      if (status !== undefined && (f.properties.status ?? 'unknown') !== status)
        continue;
      if (!matchesNature(f, natureF)) continue;
      if (!matchesCond(f, condF)) continue;
      if (riskF !== undefined && outfallRisk(f.properties).level !== riskF)
        continue;
      if (matchesFlags(f, false, orillaF) && f.properties.protected_area)
        c.zec += 1;
      if (matchesFlags(f, zecF, false) && isShallowDischarge(f.properties))
        c.orilla += 1;
    }
    return c;
  }, [outfalls, municipality, status, natureF, condF, riskF, zecF, orillaF]);

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
    return (
      outfalls
        .filter((f) => {
          if (q && !searchNorm(f.properties.name).includes(q)) return false;
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
          if (!matchesNature(f, natureF)) return false;
          if (!matchesCond(f, condF)) return false;
          if (!matchesFlags(f, zecF, orillaF)) return false;
          if (riskF !== undefined && outfallRisk(f.properties).level !== riskF)
            return false;
          return true;
        })
        // De más preocupante a menos — índice compartido con la ficha
        .sort(
          (a, b) =>
            outfallRisk(b.properties).score - outfallRisk(a.properties).score ||
            a.properties.name.localeCompare(b.properties.name),
        )
    );
  }, [
    outfalls,
    query,
    status,
    municipality,
    natureF,
    condF,
    zecF,
    orillaF,
    riskF,
  ]);

  // El panel se pega a la pestaña que lo abrió: principales entre
  // fila 1 y fila 2, avanzados debajo de la fila 2
  const isMainOpen =
    openFilter === 'estado' || openFilter === 'riesgo' || openFilter === 'muni';
  const isAdvFilterOpen =
    openFilter === 'vertido' ||
    openFilter === 'conduccion' ||
    openFilter === 'entorno';

  // Single-select: elegir cierra el panel — la acción terminó y el
  // feedback es la lista filtrada (los conteos ya se ven al scrollear
  // los chips). Entorno no lo usa: es multi-toggle, cada tap suma
  const pick = <T,>(set: (v: T) => void, v: T) => {
    set(v);
    setOpenFilter(null);
  };

  return (
    <Modal animationType="slide" visible={visible} onRequestClose={onClose}>
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
                } sin autorizar · ${zecTotal} en zona protegida · ${highTotal} de riesgo alto`}
          </Text>
          {!municipality && (
            <Text style={styles.source}>
              Censo Tierra-Mar 2025 (Gob. Canarias)
            </Text>
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
          {/* Tres desplegables — mismo acordeón que Playas: cada
              pestaña enseña categoría + selección actual y abre su
              fila de chips; solo una abierta a la vez */}
          <View style={styles.filterTabs}>
            {(
              [
                {
                  key: 'estado' as const,
                  label: 'Estado',
                  value:
                    status === undefined ? 'Todos' : STATUS_PLURALS[status],
                  count: status === undefined ? null : rows.length,
                  dot: status === undefined ? null : STATUS_COLORS[status],
                },
                {
                  key: 'riesgo' as const,
                  label: 'Riesgo',
                  value: riskF === undefined ? 'Todos' : RISK_SHORT[riskF],
                  count: riskF === undefined ? null : rows.length,
                  dot: riskF === undefined ? null : RISK_COLORS[riskF],
                },
                {
                  key: 'muni' as const,
                  label: 'Municipio',
                  value: municipality ?? 'Todos',
                  count: municipality === undefined ? null : rows.length,
                  dot: null,
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
                      {t.dot && (
                        <View
                          style={[
                            styles.filterTabDot,
                            { backgroundColor: t.dot },
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
            {/* Botón compacto que despliega la fila avanzada
                (Vertido · Conducción · Entorno) — Más/Menos */}
            <Pressable
              style={({ pressed }) => [
                styles.moreTab,
                advOpen && styles.filterTabOpen,
                pressed && styles.pressFx,
              ]}
              onPress={() => {
                setAdvOpen(!advOpen);
                setOpenFilter(null);
              }}
              accessibilityRole="button"
              accessibilityLabel={advOpen ? 'Menos filtros' : 'Más filtros'}
              accessibilityState={{ expanded: advOpen }}
            >
              <Text style={styles.moreTabText}>{advOpen ? '−' : '＋'}</Text>
            </Pressable>
          </View>
          {isMainOpen && <View style={styles.filterBarDivider} />}
          {openFilter === 'estado' && (
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
                onPress={() => pick(setStatus, undefined)}
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
                  onPress={() => pick(setStatus, status === s ? undefined : s)}
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
          )}
          {openFilter === 'riesgo' && (
            <ScrollChips
              style={styles.chips}
              contentContainerStyle={styles.chipsContent}
              fadeRgbLeft="140,216,230"
              fadeRgbRight="242,251,253"
            >
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  riskF === undefined && styles.chipActive,
                  pressed && styles.pressFx,
                ]}
                onPress={() => pick(setRiskF, undefined)}
              >
                <Text
                  style={[
                    styles.chipText,
                    riskF === undefined && styles.chipTextActive,
                  ]}
                >
                  {`Todos (${
                    (riskCounts.alto ?? 0) +
                    (riskCounts.medio ?? 0) +
                    (riskCounts.bajo ?? 0)
                  })`}
                </Text>
              </Pressable>
              {(['alto', 'medio', 'bajo'] as const).map((r) => (
                <Pressable
                  key={r}
                  style={({ pressed }) => [
                    styles.chip,
                    riskF === r && styles.chipActive,
                    pressed && styles.pressFx,
                  ]}
                  onPress={() => pick(setRiskF, riskF === r ? undefined : r)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      riskF === r && styles.chipTextActive,
                    ]}
                  >
                    {`${RISK_SHORT[r]} (${riskCounts[r] ?? 0})`}
                  </Text>
                </Pressable>
              ))}
            </ScrollChips>
          )}
          {openFilter === 'muni' && (
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
                onPress={() => pick(setMunicipality, undefined)}
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
                    pick(setMunicipality, municipality === m ? undefined : m)
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
          )}
          {advOpen && (
            <View style={[styles.filterTabs, styles.filterTabsAdv]}>
              {(
                [
                  {
                    key: 'vertido' as const,
                    label: 'Vertido',
                    value:
                      natureF === undefined
                        ? 'Todos'
                        : (NATURE_FILTERS.find((nf) => nf.key === natureF)
                            ?.label ?? 'Todos'),
                    count: natureF === undefined ? null : rows.length,
                  },
                  {
                    key: 'conduccion' as const,
                    label: 'Conducción',
                    value: condF ?? 'Todos',
                    count: condF === undefined ? null : rows.length,
                  },
                  {
                    key: 'entorno' as const,
                    label: 'Entorno',
                    value:
                      [zecF ? 'ZEC' : null, orillaF ? 'Orilla' : null]
                        .filter(Boolean)
                        .join(' · ') || 'Todos',
                    count: !zecF && !orillaF ? null : rows.length,
                  },
                ] as const
              ).map((t) => {
                const open = openFilter === t.key;
                return (
                  <Pressable
                    key={t.key}
                    style={({ pressed }) => [
                      styles.filterTab,
                      // Peso dinámico: la pestaña con filtro crece a
                      // costa de las que están en 'Todos' — el valor
                      // largo solo existe cuando filtra (los conteos
                      // cruzados bajan al combinar)
                      t.count != null && styles.filterTabAdvActive,
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
          )}
          {isAdvFilterOpen && <View style={styles.filterBarDivider} />}
          {openFilter === 'vertido' && (
            <ScrollChips
              style={styles.chips}
              contentContainerStyle={styles.chipsContent}
              fadeRgbLeft="140,216,230"
              fadeRgbRight="242,251,253"
            >
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  natureF === undefined && styles.chipActive,
                  pressed && styles.pressFx,
                ]}
                onPress={() => pick(setNatureF, undefined)}
              >
                <Text
                  style={[
                    styles.chipText,
                    natureF === undefined && styles.chipTextActive,
                  ]}
                >
                  Todos
                </Text>
              </Pressable>
              {NATURE_FILTERS.map((nf) => (
                <Pressable
                  key={nf.key}
                  style={({ pressed }) => [
                    styles.chip,
                    natureF === nf.key && styles.chipActive,
                    pressed && styles.pressFx,
                  ]}
                  onPress={() =>
                    pick(setNatureF, natureF === nf.key ? undefined : nf.key)
                  }
                >
                  <Text
                    style={[
                      styles.chipText,
                      natureF === nf.key && styles.chipTextActive,
                    ]}
                  >
                    {`${nf.label} (${natureCounts[nf.key] ?? 0})`}
                  </Text>
                </Pressable>
              ))}
            </ScrollChips>
          )}
          {openFilter === 'conduccion' && (
            <ScrollChips
              style={styles.chips}
              contentContainerStyle={styles.chipsContent}
              fadeRgbLeft="140,216,230"
              fadeRgbRight="242,251,253"
            >
              <Pressable
                style={({ pressed }) => [
                  styles.chip,
                  condF === undefined && styles.chipActive,
                  pressed && styles.pressFx,
                ]}
                onPress={() => pick(setCondF, undefined)}
              >
                <Text
                  style={[
                    styles.chipText,
                    condF === undefined && styles.chipTextActive,
                  ]}
                >
                  Todos
                </Text>
              </Pressable>
              {COND_FILTERS.map((cd) => (
                <Pressable
                  key={cd}
                  style={({ pressed }) => [
                    styles.chip,
                    condF === cd && styles.chipActive,
                    pressed && styles.pressFx,
                  ]}
                  onPress={() => pick(setCondF, condF === cd ? undefined : cd)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      condF === cd && styles.chipTextActive,
                    ]}
                  >
                    {`${cd} (${condCounts[cd] ?? 0})`}
                  </Text>
                </Pressable>
              ))}
            </ScrollChips>
          )}
          {openFilter === 'entorno' && (
            <ScrollChips
              style={styles.chips}
              contentContainerStyle={styles.chipsContent}
              fadeRgbLeft="140,216,230"
              fadeRgbRight="242,251,253"
            >
              {/* Toggles acumulables: ZEC y orilla se suman, no se
                  excluyen — no son opciones de una faceta */}
              {(
                [
                  {
                    label: '🛡 Zona protegida',
                    on: zecF,
                    set: setZecF,
                    count: flagCounts.zec,
                  },
                  {
                    label: 'En la orilla',
                    on: orillaF,
                    set: setOrillaF,
                    count: flagCounts.orilla,
                  },
                ] as const
              ).map((fl) => (
                <Pressable
                  key={fl.label}
                  style={({ pressed }) => [
                    styles.chip,
                    fl.on && styles.chipActive,
                    pressed && styles.pressFx,
                  ]}
                  onPress={() => fl.set(!fl.on)}
                >
                  <Text
                    style={[styles.chipText, fl.on && styles.chipTextActive]}
                  >
                    {`${fl.label} (${fl.count})`}
                  </Text>
                </Pressable>
              ))}
            </ScrollChips>
          )}
        </ImageBackground>

        <FlatList
          data={rows}
          keyExtractor={(f) => String(f.id)}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          // 'handled': el tap llega a la fila aunque el teclado esté
          // abierto (un tap, no dos); 'on-drag': scrollear retira
          // el teclado sin esperar a un tap
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item: f }) => {
            const s = f.properties.status ?? 'unknown';
            const risk = outfallRisk(f.properties);
            const p = f.properties;
            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.pressFx]}
                onPress={() => onSelect(f)}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowName}>
                    {capName(f.properties.name)}
                  </Text>
                  <Text style={styles.rowSub}>
                    {f.properties.municipality ?? 'Sin municipio'}
                    {f.properties.nature ? ` · ${f.properties.nature}` : ''}
                  </Text>
                  {/* Minibadges escaneables: hechos del censo sin
                      abrir la ficha. La legalidad va aquí — dato
                      duro, no veredicto: la píldora de la derecha es
                      solo la valoración (riesgo) */}
                  <View style={styles.rowBadges}>
                    {s === 'illegal' ? (
                      <Text
                        style={[
                          styles.miniBadge,
                          { color: colors.outfall.illegal },
                        ]}
                      >
                        ✗ sin autorizar
                      </Text>
                    ) : s === 'unknown' ? (
                      <Text
                        style={[
                          styles.miniBadge,
                          { color: colors.outfall.unknown },
                        ]}
                      >
                        ⏳ en trámite
                      </Text>
                    ) : (
                      <Text style={styles.miniBadge}>✓ autorizado</Text>
                    )}
                    {p.protected_area ? (
                      <Text style={styles.miniBadge}>🛡 ZEC</Text>
                    ) : null}
                    {p.condition === 'Malo' || p.condition === 'Precario' ? (
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
                      <Text style={styles.miniBadge}>⤴ con recorrido</Text>
                    ) : null}
                  </View>
                </View>
                <View style={styles.rowBadgeCol}>
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
          ListEmptyComponent={<Text style={styles.empty}>Sin resultados</Text>}
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
      (Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 24) + 10,
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
    color: colors.onColor,
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
  // Pestañas del acordeón — mismos estilos que la barra de Playas
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
  // Dot del color junto al valor que representa (estado/riesgo)
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
  // trunca ("Santa Cruz de T…") pero "(23)" sobrevive
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
  // Botón compacto que despliega la fila avanzada — mismo fondo
  // que las pestañas pero sin flex: no compite por ancho
  moreTab: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(8,107,150,0.14)',
  },
  moreTabText: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: fonts.bold,
    color: colors.primaryDark,
    textAlign: 'center',
    minWidth: 14,
  },
  filterTabsAdv: {
    paddingTop: 0,
  },
  filterTabAdvActive: {
    flex: 2,
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
  badgeText: {
    fontSize: 11,
    fontFamily: fonts.bold,
    color: colors.onColor,
  },
  empty: {
    textAlign: 'center',
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 40,
  },
});

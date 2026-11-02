import React from 'react';
import { Pressable, Text } from 'react-native';

import { displayCause } from '../../lib/format';
import ScrollChips from '../ScrollChips';
import { styles } from './statsStyles';

export type SeasonFilter = 'all' | 'closure' | 'warning' | 'active';

// Chips de año compartidas por ranking y cronología — elegir un año
// sale del modo histórico; "Histórico" (chip fijo al final) lo
// activa. `summer` solo ajusta la lectura accesible ("verano 2024")
// porque la pestaña decide qué significa el año.
// Con más de MAX_YEAR_CHIPS años los antiguos se pliegan tras "Más años ›"
export function YearChips({
  visibleYears,
  selYear,
  histMode,
  chipCounts,
  totalEpisodes,
  showAllYears,
  canCollapse,
  summer,
  onPickYear,
  onToggleAll,
  onHistoric,
}: {
  visibleYears: number[];
  selYear: number;
  histMode: boolean;
  chipCounts: Map<number, number>;
  totalEpisodes: number;
  showAllYears: boolean;
  canCollapse: boolean;
  summer: boolean;
  onPickYear: (year: number) => void;
  onToggleAll: () => void;
  onHistoric: () => void;
}) {
  const chipOn = (y: number) => !histMode && selYear === y;
  return (
    <ScrollChips
      style={styles.seasonChipsWrap}
      contentContainerStyle={styles.seasonChips}
      a11yLabel="años"
    >
      {visibleYears.map((y) => (
        <Pressable
          key={y}
          style={({ pressed }) => [
            styles.seasonChip,
            chipOn(y) && styles.seasonChipOn,
            pressed && styles.pressFx,
          ]}
          onPress={() => onPickYear(y)}
          accessibilityRole="button"
          accessibilityLabel={`Ver ${summer ? 'verano' : 'año'} ${y}`}
        >
          <Text
            style={[
              styles.seasonChipText,
              chipOn(y) && styles.seasonChipTextOn,
            ]}
          >
            {`${y} (${chipCounts.get(y) ?? 0})`}
          </Text>
        </Pressable>
      ))}
      {canCollapse && (
        <Pressable
          style={({ pressed }) => [
            styles.seasonChip,
            pressed && styles.pressFx,
          ]}
          onPress={onToggleAll}
          accessibilityRole="button"
          accessibilityLabel={
            showAllYears ? 'Plegar la lista de años' : 'Ver todos los años'
          }
        >
          <Text style={styles.seasonChipText}>
            {showAllYears ? 'Menos ›' : 'Más años ›'}
          </Text>
        </Pressable>
      )}
      <Pressable
        style={({ pressed }) => [
          styles.seasonChip,
          histMode && styles.seasonChipOn,
          pressed && styles.pressFx,
        ]}
        onPress={onHistoric}
        accessibilityRole="button"
        accessibilityLabel="Ver histórico completo"
      >
        <Text
          style={[styles.seasonChipText, histMode && styles.seasonChipTextOn]}
        >
          Histórico ({totalEpisodes})
        </Text>
      </Pressable>
    </ScrollChips>
  );
}

// Chips-filtro de la cronología: cierres | avisos | activas ahora
export function SeasonFilterChips({
  counts,
  filter,
  onChange,
}: {
  counts: { closures: number; warnings: number; active: number };
  filter: SeasonFilter;
  onChange: (filter: SeasonFilter) => void;
}) {
  return (
    <ScrollChips
      style={styles.seasonChipsWrap}
      contentContainerStyle={styles.seasonChips}
      a11yLabel="filtros de episodios"
    >
      <Pressable
        style={({ pressed }) => [
          styles.seasonChip,
          filter === 'all' && styles.seasonChipOn,
          pressed && styles.pressFx,
        ]}
        onPress={() => onChange('all')}
        accessibilityRole="button"
        accessibilityLabel="Ver todos los episodios"
      >
        <Text
          style={[
            styles.seasonChipText,
            filter === 'all' && styles.seasonChipTextOn,
          ]}
        >
          Todos
        </Text>
      </Pressable>
      {(
        [
          ['closure', counts.closures, 'cierre', 'cierres'],
          ['warning', counts.warnings, 'aviso', 'avisos'],
          ['active', counts.active, 'activa', 'activas'],
        ] as const
      ).map(([k, n, one, many]) =>
        n > 0 ? (
          <Pressable
            key={k}
            style={({ pressed }) => [
              styles.seasonChip,
              filter === k && styles.seasonChipOn,
              pressed && styles.pressFx,
            ]}
            onPress={() => onChange(filter === k ? 'all' : k)}
            accessibilityRole="button"
            accessibilityLabel={`${
              filter === k ? 'Quitar filtro de' : 'Filtrar por'
            } ${n === 1 ? one : many}`}
          >
            <Text
              style={[
                styles.seasonChipText,
                filter === k && styles.seasonChipTextOn,
              ]}
            >
              {`${n} ${n === 1 ? one : many}`}
            </Text>
          </Pressable>
        ) : null,
      )}
    </ScrollChips>
  );
}

// Chips de causa del ranking y la cronología — cuentan solo
// CIERRES, igual que el desglose del banner ("14 cierres (7 mar
// agitado · …)"). Tocar la activa la quita
export function CauseChips({
  causes,
  active,
  onChange,
}: {
  causes: [string, number][];
  active: string;
  onChange: (cause: string) => void;
}) {
  return (
    <ScrollChips
      style={styles.seasonChipsWrap}
      contentContainerStyle={styles.seasonChips}
      a11yLabel="filtros por causa"
    >
      <Pressable
        style={({ pressed }) => [
          styles.seasonChip,
          active === 'all' && styles.seasonChipOn,
          pressed && styles.pressFx,
        ]}
        onPress={() => onChange('all')}
        accessibilityRole="button"
        accessibilityLabel="Ver todos los episodios"
      >
        <Text
          style={[
            styles.seasonChipText,
            active === 'all' && styles.seasonChipTextOn,
          ]}
        >
          Todos
        </Text>
      </Pressable>
      {causes.map(([cause, n]) => (
        <Pressable
          key={cause}
          style={({ pressed }) => [
            styles.seasonChip,
            active === cause && styles.seasonChipOn,
            pressed && styles.pressFx,
          ]}
          onPress={() => onChange(active === cause ? 'all' : cause)}
          accessibilityRole="button"
          accessibilityLabel={`Filtrar por ${cause}`}
        >
          <Text
            style={[
              styles.seasonChipText,
              active === cause && styles.seasonChipTextOn,
            ]}
          >
            {`${displayCause(cause)} · ${n}`}
          </Text>
        </Pressable>
      ))}
    </ScrollChips>
  );
}

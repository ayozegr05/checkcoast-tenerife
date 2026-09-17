import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import BeachDetail from './BeachDetail';
import { BeachStats, GeoFeature, fetchBeachStats } from '../lib/api';

// Orden de prioridad: lo que necesita atención del bañista primero;
// las no monitorizadas van al final (no hay estado oficial que ordenar)
const STATUS_ORDER: Record<string, number> = {
  closed: 0,
  warning: 1,
  unknown: 2,
  open: 3,
  unmonitored: 4,
};

const STATUS_LABELS: Record<string, string> = {
  closed: 'Cerrada',
  warning: 'Aviso',
  unknown: 'Sin datos',
  open: 'Apta',
  unmonitored: 'No monitorizada',
};

const STATUS_COLORS: Record<string, string> = {
  closed: '#c62828',
  warning: '#e65100',
  unknown: '#9e9e9e',
  open: '#2e7d32',
  unmonitored: '#9e9e9e',
};

// "PLAYA ABADES (LOS ABRIGUITOS)" -> "Playa Abades (Los Abriguitos)"
const capName = (name: string) =>
  name
    .toLowerCase()
    .replace(/(^|[\s(-])([a-záéíóúñü])/g, (_m, pre: string, c: string) => pre + c.toUpperCase());

const displayName = (name: string) =>
  capName(name.replace(/\s+PM\d+$/, ''));

// Foto satélite estática del punto (Esri World Imagery, mismo servicio
// que la vista satélite del mapa). Bbox ~800x500 m centrada en la playa
const satelliteShot = ([lon, lat]: [number, number]) => {
  const dLon = 0.004;
  const dLat = 0.0022;
  return (
    'https://server.arcgisonline.com/ArcGIS/rest/services/' +
    `World_Imagery/MapServer/export?bbox=${lon - dLon},${lat - dLat},` +
    `${lon + dLon},${lat + dLat}&bboxSR=4326&imageSR=4326&size=640,300` +
    '&format=png&f=image'
  );
};

const statusOf = (f: GeoFeature) =>
  f.properties.monitored === false
    ? 'unmonitored'
    : (f.properties.status ?? 'unknown');

// Una playa extensa tiene varios puntos de muestreo (PM1, PM2...) con
// registros oficiales separados: la lista los agrupa bajo el nombre base
const baseName = (name: string) => name.replace(/\s+PM\d+$/, '');

const pmLabel = (name: string) => name.match(/\s+(PM\d+)$/)?.[1] ?? null;

const pmNum = (name: string) => {
  const m = name.match(/PM(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
};

// Evaluación oficial de la última muestra, resumida para la sub-fila
const evalLabel = (evaluation: string | null) => {
  if (!evaluation) return null;
  if (/prohib/i.test(evaluation)) return 'Prohibido';
  if (/calificar/i.test(evaluation)) return 'Sin calificar';
  if (/apta/i.test(evaluation)) return 'Apta';
  if (/recomend/i.test(evaluation)) return 'Recomendación';
  return evaluation;
};

const fmtShort = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};

type BeachGroup = {
  key: string;
  name: string;
  municipality: string | null;
  members: GeoFeature[];
};

// El grupo solo es seguro dentro del mismo municipio: Náyade repite
// nombres entre zonas distintas ("Caleta de Negros")
const groupKeyOf = (f: GeoFeature) =>
  `${f.properties.municipality ?? ''}|${baseName(
    f.properties.name,
  ).toUpperCase()}`;

const worstStatusOf = (g: BeachGroup) =>
  g.members
    .map(statusOf)
    .sort(
      (a, b) => (STATUS_ORDER[a] ?? 9) - (STATUS_ORDER[b] ?? 9),
    )[0] ?? 'unknown';

type SortMode = 'estado' | 'cierres' | 'calidad';

const SORT_LABELS: Record<SortMode, string> = {
  estado: 'Estado',
  cierres: 'Más cierres',
  calidad: 'Peor calidad',
};

// Puntuación de calidad: peor = evaluación mala + más muestras no aptas
const qualityScore = (s: BeachStats | undefined): number => {
  if (!s) return -1;
  const evalScore = s.latest_evaluation
    ? /prohib/i.test(s.latest_evaluation)
      ? 3
      : /calificar|recomend/i.test(s.latest_evaluation)
        ? 2
        : /apta/i.test(s.latest_evaluation)
          ? 0
          : 1
    : 1;
  return evalScore * 1000 + s.bad_samples;
};

export default function BeachList({
  beaches,
  visible,
  onSelect,
  onClose,
  initialMunicipality = null,
  onOpenMunicipalities,
}: {
  beaches: GeoFeature[];
  visible: boolean;
  onSelect: (feature: GeoFeature) => void;
  onClose: () => void;
  initialMunicipality?: string | null;
  onOpenMunicipalities?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [municipality, setMunicipality] = useState<string | null>(
    initialMunicipality,
  );
  const [sortMode, setSortMode] = useState<SortMode>('estado');
  const [stats, setStats] = useState<Map<number, BeachStats>>(new Map());
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<GeoFeature | null>(null);

  // El componente queda montado (Modal visible): búsqueda, filtro,
  // expansión y orden se conservan entre aperturas. El municipio solo se
  // impone cuando llega uno nuevo desde el ranking de municipios
  useEffect(() => {
    if (initialMunicipality) setMunicipality(initialMunicipality);
  }, [initialMunicipality]);

  // Stats frescas cada vez que se abre
  useEffect(() => {
    if (!visible) return;
    fetchBeachStats()
      .then((rows) =>
        setStats(new Map(rows.map((s) => [s.beach_id, s]))),
      )
      .catch(() => {});
  }, [visible]);

  const municipalities = useMemo(
    () =>
      [...new Set(beaches.map((f) => f.properties.municipality).filter(Boolean))]
        .sort() as string[],
    [beaches],
  );

  const statSum = (
    g: BeachGroup,
    k: 'closures' | 'warnings' | 'closures_last_year' | 'bad_samples',
  ) => g.members.reduce((s, m) => s + (stats.get(m.id)?.[k] ?? 0), 0);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = beaches.filter(
      (f) =>
        (!q || f.properties.name.toLowerCase().includes(q)) &&
        (!municipality || f.properties.municipality === municipality),
    );
    const map = new Map<string, BeachGroup>();
    for (const f of filtered) {
      const key = groupKeyOf(f);
      const g =
        map.get(key) ?? {
          key,
          name: baseName(f.properties.name),
          municipality: f.properties.municipality ?? null,
          members: [],
        };
      g.members.push(f);
      map.set(key, g);
    }
    const arr = [...map.values()];
    for (const g of arr) {
      g.members.sort(
        (a, b) =>
          pmNum(a.properties.name) - pmNum(b.properties.name) ||
          a.properties.name.localeCompare(b.properties.name),
      );
    }
    const sum = (g: BeachGroup, k: 'closures' | 'closures_last_year') =>
      g.members.reduce((s, m) => s + (stats.get(m.id)?.[k] ?? 0), 0);
    const worstQuality = (g: BeachGroup) =>
      Math.max(...g.members.map((m) => qualityScore(stats.get(m.id))));
    const byName = (a: BeachGroup, b: BeachGroup) =>
      a.name.localeCompare(b.name);
    if (sortMode === 'cierres') {
      arr.sort(
        (a, b) =>
          sum(b, 'closures_last_year') - sum(a, 'closures_last_year') ||
          sum(b, 'closures') - sum(a, 'closures') ||
          byName(a, b),
      );
    } else if (sortMode === 'calidad') {
      arr.sort((a, b) => worstQuality(b) - worstQuality(a) || byName(a, b));
    } else {
      arr.sort(
        (a, b) =>
          (STATUS_ORDER[worstStatusOf(a)] ?? 9) -
            (STATUS_ORDER[worstStatusOf(b)] ?? 9) || byName(a, b),
      );
    }
    return arr;
  }, [beaches, query, municipality, sortMode, stats]);

  return (
    <Modal
      animationType="slide"
      visible={visible}
      onRequestClose={detail ? () => setDetail(null) : onClose}
    >
      <View style={styles.container}>
        {detail ? (
          <>
            <View style={styles.header}>
              <Pressable
                onPress={() => setDetail(null)}
                hitSlop={12}
                style={styles.backBtn}
                accessibilityRole="button"
                accessibilityLabel="Volver a la lista"
              >
                <Text style={styles.backText}>‹</Text>
              </Pressable>
              <Text style={styles.title} numberOfLines={1}>
                {capName(detail.properties.name)}
              </Text>
              <Pressable
                onPress={() => onSelect(detail)}
                style={styles.mapBtn}
                accessibilityRole="button"
                accessibilityLabel="Ver en el mapa"
              >
                <Text style={styles.mapBtnText}>Ver en mapa</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.detailScroll}>
              <View style={styles.mapShotWrap}>
                <Image
                  source={{
                    uri: satelliteShot(detail.geometry.coordinates),
                  }}
                  style={styles.mapShot}
                  resizeMode="cover"
                />
                <View style={styles.mapDot} />
                <Text style={styles.mapCredit}>
                  © Esri, Maxar, Earthstar Geographics
                </Text>
              </View>
              <View style={styles.detailBody}>
                <BeachDetail
                  feature={detail}
                  hasAlert={detail.properties.alert === true}
                />
              </View>
            </ScrollView>
          </>
        ) : (
          <>
        <View style={styles.header}>
          <Text style={styles.title}>Playas monitorizadas</Text>
          <View style={styles.headerRight}>
            {onOpenMunicipalities && (
              <Pressable
                onPress={onOpenMunicipalities}
                hitSlop={12}
                style={styles.muniBtn}
                accessibilityRole="button"
                accessibilityLabel="Ver incidencias por municipio"
              >
                <Text style={styles.muniBtnText}>Por municipio</Text>
              </Pressable>
            )}
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>
        </View>

        <TextInput
          style={styles.search}
          placeholder="Buscar playa..."
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chips}
          contentContainerStyle={styles.chipsContent}
        >
          <Pressable
            style={[styles.chip, municipality === null && styles.chipActive]}
            onPress={() => setMunicipality(null)}
          >
            <Text
              style={[
                styles.chipText,
                municipality === null && styles.chipTextActive,
              ]}
            >
              Todos
            </Text>
          </Pressable>
          {municipalities.map((m) => (
            <Pressable
              key={m}
              style={[styles.chip, municipality === m && styles.chipActive]}
              onPress={() => setMunicipality(municipality === m ? null : m)}
            >
              <Text
                style={[
                  styles.chipText,
                  municipality === m && styles.chipTextActive,
                ]}
              >
                {m}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chips}
          contentContainerStyle={styles.chipsContent}
        >
          {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
            <Pressable
              key={mode}
              style={[styles.chip, sortMode === mode && styles.chipActive]}
              onPress={() => setSortMode(mode)}
            >
              <Text
                style={[
                  styles.chipText,
                  sortMode === mode && styles.chipTextActive,
                ]}
              >
                {SORT_LABELS[mode]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <FlatList
          data={groups}
          keyExtractor={(g) => g.key}
          style={styles.list}
          renderItem={({ item: g }) => {
            const status = worstStatusOf(g);
            const expanded = expandedKey === g.key;
            const closures = statSum(g, 'closures');
            const warnings = statSum(g, 'warnings');
            const badSamples = statSum(g, 'bad_samples');
            return (
              <View style={styles.row}>
                <Pressable
                  style={styles.rowMain}
                  onPress={() =>
                    g.members.length === 1
                      ? setDetail(g.members[0])
                      : setExpandedKey(expanded ? null : g.key)
                  }
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowName}>
                      {displayName(g.name)}
                    </Text>
                    <Text style={styles.rowSub}>
                      {g.municipality ?? 'Sin municipio'}
                      {g.members.length > 1
                        ? ` · ${g.members.length} PMs`
                        : ''}
                      {closures + warnings > 0
                        ? ` · ${closures} cierres · ${warnings} avisos`
                        : ''}
                      {badSamples > 0
                        ? ` · ${badSamples} muestras no aptas`
                        : ''}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: STATUS_COLORS[status] },
                    ]}
                  >
                    <Text style={styles.badgeText}>
                      {STATUS_LABELS[status]}
                    </Text>
                  </View>
                </Pressable>
                {expanded &&
                  g.members.map((f) => {
                    const fStatus = statusOf(f);
                    const st = stats.get(f.id);
                    const ev = evalLabel(st?.latest_evaluation ?? null);
                    const pmSub = [
                      st?.latest_sampled_at
                        ? fmtShort(st.latest_sampled_at)
                        : null,
                      ev,
                      st && st.closures + st.warnings > 0
                        ? `${st.closures} cierres · ${st.warnings} avisos`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <Pressable
                        key={f.id}
                        style={styles.pmRow}
                        onPress={() => setDetail(f)}
                      >
                        <View style={styles.pmText}>
                          <Text style={styles.pmName}>
                            {pmLabel(f.properties.name) ??
                              displayName(f.properties.name)}
                          </Text>
                          {pmSub ? (
                            <Text style={styles.pmSub}>{pmSub}</Text>
                          ) : null}
                        </View>
                        <View
                          style={[
                            styles.badge,
                            { backgroundColor: STATUS_COLORS[fStatus] },
                          ]}
                        >
                          <Text style={styles.badgeText}>
                            {STATUS_LABELS[fStatus]}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
              </View>
            );
          }}
          ListEmptyComponent={
            <Text style={styles.empty}>Sin resultados</Text>
          }
        />
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f7f7',
    paddingTop: (Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 24) + 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  muniBtn: {
    backgroundColor: '#0277bd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  muniBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  backBtn: {
    marginRight: 4,
  },
  backText: {
    fontSize: 26,
    fontWeight: '600',
    color: '#0277bd',
    marginTop: -4,
  },
  mapBtn: {
    backgroundColor: '#0277bd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginLeft: 8,
  },
  mapBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  detailScroll: {
    flex: 1,
  },
  mapShotWrap: {
    margin: 12,
    marginTop: 8,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#e0e0e0',
  },
  mapShot: {
    width: '100%',
    height: 190,
  },
  mapDot: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 16,
    height: 16,
    marginTop: -8,
    marginLeft: -8,
    borderRadius: 8,
    backgroundColor: '#0288d1',
    borderWidth: 3,
    borderColor: '#fff',
  },
  mapCredit: {
    position: 'absolute',
    bottom: 4,
    right: 8,
    fontSize: 9,
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowRadius: 2,
  },
  detailBody: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#222',
  },
  close: {
    fontSize: 20,
    color: '#666',
  },
  search: {
    backgroundColor: '#fff',
    margin: 12,
    marginBottom: 8,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    elevation: 2,
  },
  chips: {
    flexGrow: 0,
  },
  chipsContent: {
    paddingHorizontal: 12,
    gap: 8,
    paddingBottom: 4,
  },
  chip: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    elevation: 1,
  },
  chipActive: {
    backgroundColor: '#0277bd',
  },
  chipText: {
    fontSize: 13,
    color: '#444',
  },
  chipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  list: {
    flex: 1,
    marginTop: 8,
  },
  row: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginBottom: 6,
    borderRadius: 10,
    elevation: 1,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  pmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingLeft: 24,
    paddingRight: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  pmText: {
    flex: 1,
  },
  pmName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
  },
  pmSub: {
    fontSize: 11,
    color: '#888',
    marginTop: 1,
  },
  rowText: {
    flex: 1,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#222',
  },
  rowSub: {
    fontSize: 12,
    color: '#777',
    marginTop: 2,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 8,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  empty: {
    textAlign: 'center',
    color: '#888',
    marginTop: 40,
  },
});

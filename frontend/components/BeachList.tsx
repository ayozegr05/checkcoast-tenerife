import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  ImageBackground,
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
import { beachBaseName, displayBeachName } from '../lib/format';
import { colors, fonts } from '../lib/theme';

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

const STATUS_COLORS = colors.status;

const displayName = (name: string) =>
  displayBeachName(name.replace(/\s+PM\d+$/, ''));

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

// Etiqueta del punto dentro del grupo expandido: "PM3", y si la playa
// se subdivide por romano (Troya I/II) se antepone: "I · PM3"
const pmLabel = (name: string) => {
  const pm = name.match(/\s+(PM\d+)$/)?.[1];
  const roman = name
    .replace(/\s+PM\d+$/, '')
    .split('(')[0]
    .trimEnd()
    .match(/\s+(I|II|III|IV)$/)?.[1];
  const label = [roman, pm].filter(Boolean).join(' · ');
  return label || null;
};

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
  `${f.properties.municipality ?? ''}|${beachBaseName(
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
  initialMunicipality,
  onOpenMunicipalities,
}: {
  beaches: GeoFeature[];
  visible: boolean;
  onSelect: (feature: GeoFeature) => void;
  onClose: () => void;
  // undefined = sin filtro (Todos); null = "Sin municipio"
  initialMunicipality?: string | null;
  onOpenMunicipalities?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [municipality, setMunicipality] = useState<
    string | null | undefined
  >(initialMunicipality);
  const [sortMode, setSortMode] = useState<SortMode>('estado');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(
    undefined,
  );
  const [stats, setStats] = useState<Map<number, BeachStats>>(new Map());
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<GeoFeature | null>(null);

  // El componente queda montado (Modal visible): búsqueda, filtro,
  // expansión y orden se conservan entre aperturas. El municipio solo se
  // impone cuando llega uno nuevo desde el ranking de municipios
  useEffect(() => {
    if (initialMunicipality !== undefined)
      setMunicipality(initialMunicipality);
  }, [initialMunicipality]);

  // Al cerrarse el modal el detalle se descarta: reabrir la lista (p. ej.
  // desde el ranking de municipios) debe mostrar la lista, no la ficha
  // anterior
  useEffect(() => {
    if (!visible) setDetail(null);
  }, [visible]);

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

  // Estados presentes en los datos, en orden de severidad: solo se
  // muestran chips de filtro para lo que realmente hay en la lista
  const presentStatuses = useMemo(
    () =>
      [...new Set(beaches.map(statusOf))].sort(
        (a, b) => (STATUS_ORDER[a] ?? 9) - (STATUS_ORDER[b] ?? 9),
      ),
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
        (municipality === undefined ||
          (municipality === null
            ? f.properties.municipality == null
            : f.properties.municipality === municipality)),
    );
    const map = new Map<string, BeachGroup>();
    for (const f of filtered) {
      const key = groupKeyOf(f);
      const g =
        map.get(key) ?? {
          key,
          name: beachBaseName(f.properties.name),
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
    // El filtro de estado casa con la peor condición del grupo: es el
    // estado que muestra la pastilla de cada fila
    return statusFilter === undefined
      ? arr
      : arr.filter((g) => worstStatusOf(g) === statusFilter);
  }, [beaches, query, municipality, sortMode, statusFilter, stats]);

  return (
    <Modal
      animationType="slide"
      visible={visible}
      onRequestClose={detail ? () => setDetail(null) : onClose}
    >
      <View style={styles.container}>
        {detail ? (
          <>
            <ImageBackground
              source={require('../assets/gradient-sea.png')}
              style={styles.header}
              resizeMode="cover"
            >
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
                {displayBeachName(detail.properties.name)}
              </Text>
              <Pressable
                onPress={() => onSelect(detail)}
                style={styles.mapBtn}
                accessibilityRole="button"
                accessibilityLabel="Ver en el mapa"
              >
                <Text style={styles.mapBtnText}>Ver en mapa</Text>
              </Pressable>
            </ImageBackground>
            <ScrollView style={styles.detailScroll}>
              <View style={styles.mapShotWrap}>
                <Image
                  source={{
                    uri: satelliteShot(detail.geometry.coordinates),
                  }}
                  style={styles.mapShot}
                  resizeMode="cover"
                />
                <View
                  style={[
                    styles.mapDot,
                    {
                      backgroundColor:
                        STATUS_COLORS[
                          detail.properties.monitored === false
                            ? 'unmonitored'
                            : (detail.properties.status ?? 'unknown')
                        ],
                    },
                  ]}
                />
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
        <ImageBackground
          source={require('../assets/gradient-sea.png')}
          style={styles.header}
          resizeMode="cover"
        >
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
        </ImageBackground>

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
            style={[
              styles.chip,
              municipality === undefined && styles.chipActive,
            ]}
            onPress={() => setMunicipality(undefined)}
          >
            <Text
              style={[
                styles.chipText,
                municipality === undefined && styles.chipTextActive,
              ]}
            >
              Todos
            </Text>
          </Pressable>
          {municipalities.map((m) => (
            <Pressable
              key={m}
              style={[styles.chip, municipality === m && styles.chipActive]}
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
                {m}
              </Text>
            </Pressable>
          ))}
          {beaches.some((f) => f.properties.municipality == null) && (
            <Pressable
              style={[
                styles.chip,
                municipality === null && styles.chipActive,
              ]}
              onPress={() =>
                setMunicipality(municipality === null ? undefined : null)
              }
            >
              <Text
                style={[
                  styles.chipText,
                  municipality === null && styles.chipTextActive,
                ]}
              >
                Sin municipio
              </Text>
            </Pressable>
          )}
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
          <View style={styles.chipDivider} />
          {presentStatuses.map((s) => (
            <Pressable
              key={s}
              style={[
                styles.chip,
                styles.chipStatus,
                statusFilter === s && styles.chipActive,
              ]}
              onPress={() =>
                setStatusFilter(statusFilter === s ? undefined : s)
              }
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
                {STATUS_LABELS[s]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <FlatList
          data={groups}
          keyExtractor={(g) => g.key}
          style={styles.list}
          contentContainerStyle={styles.listContent}
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
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop:
      (Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 24) + 10,
    paddingBottom: 12,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  muniBtn: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  muniBtnText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontFamily: fonts.bold,
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
  mapBtn: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginLeft: 8,
  },
  mapBtnText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  detailScroll: {
    flex: 1,
  },
  mapShotWrap: {
    margin: 12,
    marginTop: 8,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.border,
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
    borderWidth: 3,
    borderColor: '#fff',
  },
  mapCredit: {
    position: 'absolute',
    bottom: 4,
    right: 8,
    fontSize: 9,
    fontFamily: fonts.semibold,
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowRadius: 2,
  },
  detailBody: {
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'android' ? 44 : 24,
  },
  title: {
    fontSize: 18,
    fontFamily: fonts.extrabold,
    color: '#fff',
    flex: 1,
  },
  close: {
    fontSize: 20,
    color: 'rgba(255,255,255,0.9)',
  },
  search: {
    backgroundColor: colors.surface,
    margin: 12,
    marginBottom: 8,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: fonts.regular,
    color: colors.text,
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
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    elevation: 1,
  },
  chipActive: {
    backgroundColor: colors.primary,
  },
  chipText: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
  },
  chipTextActive: {
    color: '#fff',
  },
  chipDivider: {
    width: 1,
    backgroundColor: colors.border,
    marginVertical: 6,
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
  list: {
    flex: 1,
    marginTop: 8,
  },
  listContent: {
    paddingBottom: Platform.OS === 'android' ? 34 : 8, // barra de gestos
  },
  row: {
    backgroundColor: colors.surface,
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
    borderTopColor: colors.border,
  },
  pmText: {
    flex: 1,
  },
  pmName: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
  },
  pmSub: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 1,
  },
  rowText: {
    flex: 1,
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
    paddingVertical: 4,
    marginLeft: 8,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: fonts.bold,
  },
  empty: {
    textAlign: 'center',
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 40,
  },
});

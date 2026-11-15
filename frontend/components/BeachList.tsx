import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  ImageBackground,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import BeachListDetail from './beachList/BeachListDetail';
import BeachRow from './beachList/BeachRow';
import SearchHeader from './beachList/SearchHeader';
import {
  BeachStats,
  GeoFeature,
  MunicipalityIncident,
  fetchBeachStats,
  fetchEpisodes,
} from '../lib/api';
import { searchNorm } from '../lib/format';
import { colors, fonts } from '../lib/theme';
import { zoneName } from '../lib/zones';
import {
  STATUS_ORDER,
  SortMode,
  buildGroups,
  groupKeyOf,
  isImpecableGroup,
  statusOf,
  worstStatusOf,
} from '../lib/beachGroups';

export default function BeachList({
  beaches,
  outfalls,
  visible,
  onSelect,
  onClose,
  initialMunicipality,
  onSelectOutfall,
}: {
  beaches: GeoFeature[];
  // Emisarios cargados en la app: BeachDetail los superpone a la foto
  outfalls?: GeoFeature[];
  visible: boolean;
  onSelect: (feature: GeoFeature) => void;
  onClose: () => void;
  // undefined = sin filtro (Todos); null = "Sin municipio"
  initialMunicipality?: string | null;
  // Tap en un emisario cercano dentro de la ficha → verlo en el mapa;
  // el segundo argumento es la playa a restaurar al volver
  onSelectOutfall?: (feature: GeoFeature, restore: GeoFeature | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [municipality, setMunicipality] = useState<string | null | undefined>(
    initialMunicipality,
  );
  const [sortMode, setSortMode] = useState<SortMode>('estado');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(
    undefined,
  );
  const [stats, setStats] = useState<Map<number, BeachStats>>(new Map());
  const [episodes, setEpisodes] = useState<MunicipalityIncident[]>([]);
  // undefined = sin tocar (permite la auto-expansión por búsqueda de
  // cala); null = colapsado a mano; key = expandido a mano
  const [expandedKey, setExpandedKey] = useState<string | null | undefined>(
    undefined,
  );
  const [detail, setDetail] = useState<GeoFeature | null>(null);

  // Abrir ficha: el teclado del buscador podía quedar sobre el overlay
  const openDetail = (f: GeoFeature) => {
    Keyboard.dismiss();
    // Si la ficha es de un PM de grupo, al volver debe verse la lista
    // de PMs expandida — solo si el grupo tiene más de un miembro,
    // si no queda un "punto 1" suelto colgando de la fila
    const key = groupKeyOf(f);
    const n = beaches.filter((b) => groupKeyOf(b) === key).length;
    if (n > 1) setExpandedKey(key);
    setDetail(f);
  };
  const closeDetail = () => {
    if (detail) {
      const key = groupKeyOf(detail);
      const n = beaches.filter((b) => groupKeyOf(b) === key).length;
      if (n > 1) setExpandedKey(key);
    }
    setDetail(null);
  };

  // El componente queda montado (Modal visible): búsqueda, filtro,
  // expansión y orden se conservan entre aperturas. Ajustes de estado
  // durante el render (patrón oficial de React — se procesan antes de
  // pintar, sin cascada):
  //  - el municipio solo se impone cuando llega uno nuevo del ranking
  //  - al cerrarse el modal el detalle se descarta: reabrir debe
  //    mostrar la lista, no la ficha anterior
  const [prevMuni, setPrevMuni] = useState(initialMunicipality);
  const [prevVisible, setPrevVisible] = useState(visible);
  if (prevMuni !== initialMunicipality) {
    setPrevMuni(initialMunicipality);
    if (initialMunicipality !== undefined) setMunicipality(initialMunicipality);
  }
  if (prevVisible !== visible) {
    setPrevVisible(visible);
    if (!visible) setDetail(null);
  }

  // Stats frescas cada vez que se abre
  useEffect(() => {
    if (!visible) return;
    fetchBeachStats()
      .then((rows) => setStats(new Map(rows.map((s) => [s.beach_id, s]))))
      .catch(() => {});
    fetchEpisodes()
      .then(setEpisodes)
      .catch(() => {});
  }, [visible]);

  // Totales de la cabecera por playa física (grupo): un conjunto de
  // PMs vigilados cuenta UNA playa monitorizada, no N
  const totals = useMemo(() => {
    const seen = new Map<string, boolean>();
    for (const f of beaches) {
      const k = groupKeyOf(f);
      seen.set(k, (seen.get(k) ?? false) || f.properties.monitored !== false);
    }
    let mon = 0;
    let un = 0;
    for (const v of seen.values()) {
      if (v) mon++;
      else un++;
    }
    return { mon, un };
  }, [beaches]);

  // Correlación isla: cuántas playas con episodios por contaminación
  // tienen un emisario catalogado a <500 m. Coincidencia espacial —
  // nunca causalidad afirmada
  const correlation = useMemo(() => {
    if (!episodes.length || !outfalls?.length) return null;
    const hav = (a: [number, number], b: [number, number]) => {
      const rad = Math.PI / 180;
      const dLa = (b[1] - a[1]) * rad;
      const dLo = (b[0] - a[0]) * rad;
      const s =
        Math.sin(dLa / 2) ** 2 +
        Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLo / 2) ** 2;
      return 2 * 6371000 * Math.asin(Math.sqrt(s));
    };
    const byId = new Map(beaches.map((f) => [f.id, f]));
    const polluted = new Set<string>();
    const near = new Set<string>();
    for (const ep of episodes) {
      if (ep.kind !== 'closure' || ep.cause !== 'Contaminación') continue;
      const f = byId.get(ep.beach_id);
      if (!f) continue;
      const key = groupKeyOf(f);
      polluted.add(key);
      if (
        outfalls.some(
          (o) => hav(f.geometry.coordinates, o.geometry.coordinates) <= 500,
        )
      ) {
        near.add(key);
      }
    }
    return polluted.size ? { total: polluted.size, near: near.size } : null;
  }, [episodes, beaches, outfalls]);

  const municipalities = useMemo(
    () =>
      [
        ...new Set(
          beaches.map((f) => f.properties.municipality).filter(Boolean),
        ),
      ].sort() as string[],
    [beaches],
  );

  // Estados presentes en los datos, en orden de severidad: solo se
  // muestran chips de filtro para lo que realmente hay en la lista
  // (STATUS_ORDER ya deja "Sin datos" el último)
  const presentStatuses = useMemo(
    () =>
      [...new Set(beaches.map(statusOf))].sort(
        (a, b) => (STATUS_ORDER[a] ?? 9) - (STATUS_ORDER[b] ?? 9),
      ),
    [beaches],
  );

  const groups = useMemo(
    () =>
      buildGroups(beaches, {
        query,
        municipality,
        sortMode,
        statusFilter,
        stats,
      }),
    [beaches, query, municipality, sortMode, statusFilter, stats],
  );

  // Conteos por opción para los paneles del acordeón: cada chip
  // muestra cuántas playas daría elegirlo — el número se calcula
  // SIN su propio filtro pero CON el resto aplicado (municipio
  // respeta búsqueda+estado; estado respeta búsqueda+municipio)
  const noStatus = useMemo(
    () => buildGroups(beaches, { query, municipality, sortMode, stats }),
    [beaches, query, municipality, sortMode, stats],
  );
  const statusCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of noStatus) {
      const s = worstStatusOf(g);
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return m;
  }, [noStatus]);
  const impecablesCount = useMemo(
    () => noStatus.filter((g) => isImpecableGroup(g, stats)).length,
    [noStatus, stats],
  );
  const noMuni = useMemo(
    () => buildGroups(beaches, { query, sortMode, statusFilter, stats }),
    [beaches, query, sortMode, statusFilter, stats],
  );
  const muniCounts = useMemo(() => {
    const m = new Map<string | null, number>();
    for (const g of noMuni) {
      m.set(g.municipality, (m.get(g.municipality) ?? 0) + 1);
    }
    return m;
  }, [noMuni]);

  // Búsqueda por cala: si la query casa el alias de una zona pero no
  // el nombre del grupo, la fila se abre sola — si no, "Punta Brava"
  // aparecería dentro de "Jardín" sin que se adivine dónde está
  const autoExpandKey = useMemo(() => {
    const q = searchNorm(query);
    if (!q) return null;
    const hit = groups.find(
      (g) =>
        g.members.length > 1 &&
        !searchNorm(g.name).includes(q) &&
        g.members.some((m) =>
          searchNorm(
            `${m.properties.name} ${zoneName(m.properties.name) ?? ''}`,
          ).includes(q),
        ),
    );
    return hit?.key ?? null;
  }, [groups, query]);

  // Expansión efectiva: el usuario manda si ha tocado la fila
  // (expandir/colapsar); si no, decide la búsqueda por cala
  const isExpanded = (key: string) =>
    expandedKey === undefined ? autoExpandKey === key : expandedKey === key;

  // PMs del complejo de la ficha abierta (los hermanos de `detail`)
  const detailMembers = useMemo(
    () =>
      detail ? beaches.filter((b) => groupKeyOf(b) === groupKeyOf(detail)) : [],
    [detail, beaches],
  );

  return (
    <Modal
      animationType="slide"
      visible={visible}
      onRequestClose={detail ? closeDetail : onClose}
    >
      <View style={styles.container}>
        <>
          <ImageBackground
            source={require('../assets/gradient-sea.png')}
            style={styles.header}
            resizeMode="cover"
          >
            {/* Fila 1: título + acciones. Los datos isla van a ancho
              completo debajo — antes apretaban el botón "Por
              municipio" */}
            <View style={styles.headerTop}>
              <Text style={[styles.title, { flex: 1, textAlign: 'center' }]}>
                Playas
              </Text>
              <View style={styles.headerRight}>
                <Pressable
                  onPress={onClose}
                  hitSlop={12}
                  style={({ pressed }) => [
                    styles.closeBtn,
                    pressed && styles.pressFx,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Cerrar lista de playas"
                >
                  <Text style={styles.close}>✕</Text>
                </Pressable>
              </View>
            </View>
            <Text style={[styles.headerSub, { marginTop: 23 }]}>
              {totals.mon} monitorizadas · {totals.un} sin monitorizar
            </Text>
            {correlation && (
              <Text style={styles.headerSub}>
                De las {correlation.total} playas que han tenido cierres por
                contaminación, {correlation.near} tienen un emisario a menos de
                500 m
              </Text>
            )}
          </ImageBackground>

          <SearchHeader
            query={query}
            onQueryChange={setQuery}
            municipality={municipality}
            onMunicipalityChange={setMunicipality}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            sortMode={sortMode}
            onSortModeChange={setSortMode}
            resultCount={groups.length}
            municipalities={municipalities}
            muniCounts={muniCounts}
            allCount={noMuni.length}
            hasUnassigned={beaches.some(
              (f) => f.properties.municipality == null,
            )}
            presentStatuses={presentStatuses}
            statusCounts={statusCounts}
            impecablesCount={impecablesCount}
          />

          <FlatList
            data={groups}
            keyExtractor={(g) => g.key}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            // 'handled': el tap llega a la fila con el teclado abierto
            // (no se lo come el dismiss); 'on-drag': scrollear ya
            // retira el teclado sin esperar a un tap
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            renderItem={({ item: g }) => (
              <BeachRow
                group={g}
                expanded={isExpanded(g.key)}
                stats={stats}
                sortMode={sortMode}
                onToggle={() =>
                  setExpandedKey(isExpanded(g.key) ? null : g.key)
                }
                onOpenDetail={openDetail}
              />
            )}
            ListEmptyComponent={
              <Text style={styles.empty}>Sin resultados</Text>
            }
          />
        </>

        {/* Ficha del PM como overlay: la lista queda montada debajo y
        {/* Ficha del PM como overlay: la lista queda montada debajo y
            conserva scroll + expansión al volver atrás */}
        {detail && (
          <BeachListDetail
            // key por playa: remount limpio de scroll + «Ver más»
            key={detail.id}
            detail={detail}
            members={detailMembers}
            outfalls={outfalls}
            onBack={closeDetail}
            onViewOnMap={() => onSelect(detail)}
            onSelectOutfall={
              onSelectOutfall ? (f) => onSelectOutfall(f, detail) : undefined
            }
          />
        )}
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
    paddingHorizontal: 16,
    paddingTop:
      (Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 24) + 10,
    paddingBottom: 12,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  title: {
    fontSize: 18,
    fontFamily: fonts.extrabold,
    color: colors.onColor,
  },
  headerSub: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 2,
  },
  close: {
    fontSize: 20,
    fontFamily: fonts.extrabold,
    color: 'rgba(255,255,255,0.9)',
  },
  // Botón ✕ contenido: cuadrado de esquinas suaves translúcido —
  // affordance visible sin pesar sobre el header degradado
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  list: {
    flex: 1,
    marginTop: 8,
  },
  listContent: {
    paddingBottom: Platform.OS === 'android' ? 34 : 8, // barra de gestos
  },
  empty: {
    textAlign: 'center',
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 40,
  },
});

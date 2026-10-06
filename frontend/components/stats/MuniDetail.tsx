import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, ImageBackground, Pressable, Text, View } from 'react-native';

import {
  GeoFeature,
  MunicipalityIncident,
  fetchMunicipalityIncidents,
} from '../../lib/api';
import { causeFamily } from '../../lib/episodes';
import { displayBeachName, formatDays } from '../../lib/format';
import { MuniStats, durationDays, fmtDate } from '../../lib/muniStats';
import { colors } from '../../lib/theme';
import Skeleton from '../Skeleton';
import { styles } from './statsStyles';

// Un item de la línea temporal del municipio: punto de color (sólido si
// sigue activo, apagado si cerró) + tarjeta con playa, fechas y badge
function TimelineRow({
  inc,
  isLast,
  live,
  onSelectBeach,
}: {
  inc: MunicipalityIncident;
  isLast: boolean;
  // Estado vivo de la playa: un incidente abierto cuyo observations no
  // dice "prohibido" se clasifica como aviso, pero si la playa está
  // cerrada ahora mismo el badge debe decir "Cierre activo"
  live: string | undefined;
  onSelectBeach?: (beachId: number) => void;
}) {
  // Solo un incidente sin fecha de cierre está "activo":
  // el badge sólido se reserva a ese caso — los
  // históricos van en outline para no leerse como vivos
  const active = inc.closed_at === null;
  // "Sin Calificar" = Náyade abrió ficha por una muestra
  // pendiente de clasificar (p.ej. San Marcos por la
  // pérdida de arena): no es ni cierre ni aviso real
  const unclassified = /sin\s*calificar/i.test(inc.observations ?? '');
  // En incidentes vivos manda el estado actual de la
  // playa (p.ej. Gaviotas: incidencia "aviso" pero la
  // playa está cerrada por muestra no apta)
  const kind =
    active && (live === 'closed' || live === 'warning')
      ? live === 'closed'
        ? 'closure'
        : 'warning'
      : inc.kind;
  return (
    <View style={styles.tlItem}>
      <View style={styles.tlRail}>
        <View
          style={[
            styles.tlDot,
            !active && styles.tlDotEnded,
            active && {
              backgroundColor:
                kind === 'closure'
                  ? colors.status.closed
                  : colors.status.warning,
            },
          ]}
        />
        {!isLast && <View style={styles.tlLine} />}
      </View>
      <Pressable
        style={({ pressed }) => [styles.tlBody, pressed && styles.pressFx]}
        onPress={() => onSelectBeach?.(inc.beach_id)}
        accessibilityRole="button"
        accessibilityLabel={`Ver ficha de ${displayBeachName(inc.beach_name)}`}
      >
        <View style={styles.tlHeader}>
          <Text style={styles.tlBeach} numberOfLines={1}>
            {displayBeachName(inc.beach_name)}
          </Text>
          <Text
            style={[
              styles.badge,
              active
                ? kind === 'closure'
                  ? styles.badgeClosed
                  : styles.badgeWarning
                : styles.badgeEnded,
            ]}
          >
            {unclassified
              ? 'Pendiente'
              : kind === 'closure'
                ? 'Cierre'
                : 'Aviso'}
            {active && !unclassified ? ' activo' : ''}
          </Text>
          <Text style={styles.tlGo}>›</Text>
        </View>
        <Text style={styles.tlDates}>
          {inc.end_estimated
            ? // Fin estimado (última mención en prensa):
              // no se muestra — solo el día del cierre
              inc.opened_at
              ? fmtDate(inc.opened_at)
              : '—'
            : `${inc.opened_at ? fmtDate(inc.opened_at) : '—'} → ${
                inc.closed_at ? fmtDate(inc.closed_at) : 'activo'
              }${inc.opened_at ? ` · ${formatDays(durationDays(inc))}` : ''}`}
        </Text>
        {inc.observations ? (
          <Text style={styles.tlObs}>{inc.observations}</Text>
        ) : null}
      </Pressable>
    </View>
  );
}

export default function MuniDetail({
  detail,
  beaches,
  isYearMode,
  selYear,
  yearCause,
  onSelect,
  onSelectBeach,
  onBack,
}: {
  detail: MuniStats;
  // Features del mapa: estado vivo por playa + síntesis de alertas de
  // prensa para "Sin municipio"
  beaches: GeoFeature[];
  isYearMode: boolean;
  selYear: number;
  yearCause: string;
  onSelect: (municipality: string | null) => void;
  onSelectBeach?: (beachId: number) => void;
  onBack: () => void;
}) {
  const [incidents, setIncidents] = useState<MunicipalityIncident[] | null>(
    null,
  );

  // Línea temporal de incidentes del municipio abierto; solo las playas
  // monitorizadas tienen incidentes, así que "Sin municipio" no tiene
  useEffect(() => {
    setIncidents(null);
    // "Sin municipio" no tiene incidentes oficiales pero puede tener
    // alertas de prensa (playas OSM): lista vacía, no skeleton eterno
    if (!detail.municipality) {
      setIncidents([]);
      return;
    }
    fetchMunicipalityIncidents(detail.municipality)
      .then(setIncidents)
      .catch(() => setIncidents([]));
  }, [detail]);

  // Línea temporal del municipio abierto: el backend ya devuelve
  // incidentes oficiales + eventos reconstruidos (analítica/prensa).
  // Solo "Sin municipio" necesita síntesis en cliente: el endpoint
  // no puede filtrar por municipio NULL
  const detailRows = useMemo<MunicipalityIncident[]>(() => {
    const official = incidents ?? [];
    const pressRows: MunicipalityIncident[] = detail.municipality
      ? [] // solo "Sin municipio" sintetiza alertas de prensa en cliente
      : beaches
          .filter(
            (f) =>
              (f.properties.municipality ?? 'Sin municipio') === detail.name &&
              f.properties.alert === true,
          )
          .map((f) => ({
            id: -f.id, // id negativo: no colisiona con incidentes reales
            beach_id: f.id,
            beach_name: f.properties.name,
            municipality: detail.municipality,
            kind:
              f.properties.status === 'warning'
                ? ('warning' as const)
                : ('closure' as const),
            opened_at: (f.properties.reported_at ?? '').slice(0, 10),
            closed_at: null,
            observations: 'Según prensa — sin incidente oficial en Náyade',
            via: 'press',
          }));
    return (
      [...official, ...pressRows]
        .sort((a, b) => (b.opened_at ?? '').localeCompare(a.opened_at ?? ''))
        // Con una causa activa el detalle muestra solo esos episodios
        .filter((inc) =>
          yearCause === 'all'
            ? true
            : yearCause === 'sin causa'
              ? !inc.cause
              : causeFamily(inc.cause) === yearCause,
        )
        // En modo-año la línea temporal solo muestra episodios que
        // tocaron ese año (mismo solape que yearEpisodes)
        .filter(
          (inc) =>
            !isYearMode ||
            ((inc.opened_at ?? '') <= `${selYear}-12-31` &&
              (inc.closed_at === null || inc.closed_at >= `${selYear}-01-01`)),
        )
    );
  }, [detail, incidents, beaches, yearCause, isYearMode, selYear]);

  const liveStatus = useMemo(
    () => new Map(beaches.map((f) => [f.id, f.properties.status ?? 'unknown'])),
    [beaches],
  );

  return (
    <>
      <ImageBackground
        source={require('../../assets/gradient-sea.png')}
        style={styles.headerBlock}
        resizeMode="cover"
      >
        <View style={styles.header}>
          <Pressable
            onPress={onBack}
            hitSlop={12}
            style={({ pressed }) => [
              styles.backBtn,
              styles.closeBtn,
              pressed && styles.pressFx,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Volver al ranking"
          >
            <Text style={styles.backText}>‹</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {detail.name}
          </Text>
          <Pressable
            onPress={() => onSelect(detail.municipality)}
            style={({ pressed }) => [styles.listBtn, pressed && styles.pressFx]}
            accessibilityRole="button"
            accessibilityLabel="Ver playas del municipio"
          >
            <Text style={styles.listBtnText}>Ver playas</Text>
          </Pressable>
        </View>
        <Text style={styles.subtitle}>
          Línea temporal de incidentes
          {isYearMode ? ` · ${selYear}` : ''} · más reciente primero
        </Text>
      </ImageBackground>

      <FlatList
        data={detailRows}
        keyExtractor={(inc) => String(inc.id)}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        renderItem={({ item: inc, index }) => (
          <TimelineRow
            inc={inc}
            isLast={index === detailRows.length - 1}
            live={liveStatus.get(inc.beach_id)}
            onSelectBeach={onSelectBeach}
          />
        )}
        ListEmptyComponent={
          incidents === null ? (
            <View>
              {[0, 1, 2].map((i) => (
                <View key={i} style={styles.tlItem}>
                  <View style={styles.tlRail}>
                    <Skeleton style={styles.tlDotSkeleton} />
                    {i < 2 && <View style={styles.tlLine} />}
                  </View>
                  <View style={styles.tlBody}>
                    <Skeleton style={styles.tlSkeletonTitle} />
                    <Skeleton style={styles.tlSkeletonLine} />
                    <Skeleton style={styles.tlSkeletonLineShort} />
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.empty}>Sin incidentes registrados</Text>
          )
        }
      />
    </>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  ImageBackground,
  Pressable,
  Text,
  View,
} from 'react-native';

import {
  EpisodeFocus,
  GeoFeature,
  MunicipalityIncident,
  fetchMunicipalityIncidents,
} from '../../lib/api';
import { causeLabelArts, STRUCT_CAUSES } from '../../lib/causeArt';
import { causeFamily } from '../../lib/episodes';
import { displayBeachName, formatDays } from '../../lib/format';
import { MuniStats, durationDays, fmtDate } from '../../lib/muniStats';
import { groupNewsItems } from '../../lib/news';
import { colors } from '../../lib/theme';
import { zoneName } from '../../lib/zones';
import Skeleton from '../Skeleton';
import NewsGroupList from '../beach/NewsGroupList';
import { styles } from './statsStyles';

// Un item de la línea temporal del municipio: punto de color (sólido si
// sigue activo, apagado si cerró) + tarjeta con playa, fechas y badge
function TimelineRow({
  inc,
  isLast,
  live,
  zone,
  onSelectBeach,
}: {
  inc: MunicipalityIncident;
  isLast: boolean;
  // Estado vivo de la playa: un incidente abierto cuyo observations no
  // dice "prohibido" se clasifica como aviso, pero si la playa está
  // cerrada ahora mismo el badge debe decir "Cierre activo"
  live: string | undefined;
  // Cala concreta del complejo ("Leocadio Machado") — en complejos
  // multi-punto la fila dice la zona real, no solo el arenal
  zone: string | null;
  onSelectBeach?: (beachId: number, episode?: EpisodeFocus) => void;
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
  // Acento por causa — el mismo vocabulario que la ficha de playa:
  // estructural granate, fauna añil, cierre rojo, aviso naranja.
  // Todo gris leía "cementerio" y borraba la info que la causa da
  const accent = unclassified
    ? colors.textFaint
    : inc.cause && STRUCT_CAUSES.has(inc.cause)
      ? colors.status.structural
      : inc.cause === 'Medusas'
        ? colors.status.fauna
        : kind === 'closure'
          ? colors.status.closed
          : colors.status.warning;
  const [titlesOpen, setTitlesOpen] = useState(false);
  // Evidencia del episodio: en un cierre cuentan solo el ciclo
  // cierre→reapertura (avisos y contexto no lo cuentan) — misma
  // regla que la fila de Episodios de la ficha
  const pressItems =
    kind === 'closure'
      ? (inc.press_items ?? []).filter(
          (n) => n.event_type === 'closure' || n.event_type === 'reopening',
        )
      : (inc.press_items ?? []);
  return (
    <View style={styles.tlItem}>
      <View style={styles.tlRail}>
        <View
          style={[
            styles.tlDot,
            // Activo = punto sólido del color de la causa; resuelto =
            // anillo del mismo color — el estado sigue leyéndose
            // (lleno/vacío) pero la causa ya colorea el timeline
            active
              ? { backgroundColor: accent }
              : {
                  borderColor: accent,
                  borderWidth: 1.5,
                  backgroundColor: 'transparent',
                },
          ]}
        />
        {!isLast && <View style={styles.tlLine} />}
        {/* Tick horizontal dot→tarjeta a la altura del dot: el rail
            lee "línea temporal conectada" (tipo git-log) en vez de
            puntos flotando junto a las tarjetas */}
        <View style={[styles.tlTick, { backgroundColor: accent }]} />
      </View>
      <Pressable
        style={({ pressed }) => [
          styles.tlBody,
          {
            borderLeftColor: accent,
            // Velo del color de causa (~6% alfa): la fila respira el
            // estado del episodio sin competir con la raya ni el dot
            backgroundColor: `${accent}10`,
          },
          pressed && styles.pressFx,
        ]}
        // La tarjeta entera navega a la ficha; el chevron › del borde
        // derecho es la pista de "fila navegable" (gesto clásico de
        // lista), no un segundo botón
        onPress={() =>
          onSelectBeach?.(inc.beach_id, {
            beach_id: inc.beach_id,
            id: inc.id,
            opened_at: inc.opened_at,
          })
        }
        accessibilityRole="button"
        accessibilityLabel={`Ver ficha de ${displayBeachName(inc.beach_name)}`}
      >
        {/* Dos columnas: contenido a la izquierda y el chevron de
            navegación como columna hermana autocentrada — centra
            sobre TODO el alto de la tarjeta (contenido + enlace de
            titulares + titulares desplegados), no solo sobre la
            primera línea */}
        <View style={styles.tlWrap}>
          <View style={styles.tlContent}>
            {/* Mismo layout que una fila de Episodios de la ficha:
                identidad y fechas a la izquierda; a la derecha el
                badge circular de la causa (en cierres) o la etiqueta
                de estado (avisos / notas pendientes), con la causa
                debajo */}
            <View style={styles.tlRow}>
              <View style={styles.tlMain}>
                <Text style={styles.tlBeach} numberOfLines={2}>
                  {displayBeachName(inc.beach_name)}
                  {zone ? <Text style={styles.tlZone}> · {zone}</Text> : null}
                </Text>
                <Text style={styles.tlDates}>
                  {inc.end_estimated
                    ? // Fin estimado (última mención en prensa): no se
                      // muestra, pero la fecha pelada parece dato roto
                      // — el "según prensa" la contextualiza
                      `${inc.opened_at ? fmtDate(inc.opened_at) : '—'} · según prensa`
                    : `${inc.opened_at ? fmtDate(inc.opened_at) : '—'} → ${
                        inc.closed_at ? fmtDate(inc.closed_at) : 'activo'
                      }${inc.opened_at ? ` · ${formatDays(durationDays(inc))}` : ''}`}
                </Text>
                {inc.observations ? (
                  <Text style={styles.tlObs}>{inc.observations}</Text>
                ) : null}
              </View>
              <View style={styles.tlSide}>
                {kind === 'closure' && !unclassified ? (
                  // Un badge por parámetro — "E. coli y enterococos"
                  // apila los dos (como incidentBadgeArts en la ficha)
                  <View style={styles.tlBadges}>
                    {causeLabelArts(inc.cause).map((art) => (
                      <Image
                        key={art}
                        testID="incident-badge"
                        source={art}
                        style={styles.tlBadge}
                      />
                    ))}
                  </View>
                ) : (
                  <Text style={[styles.tlState, { color: accent }]}>
                    {unclassified ? 'Pendiente' : 'Aviso'}
                  </Text>
                )}
                {inc.cause && !unclassified ? (
                  // Causa compuesta ("E. coli y enterococos") → dos
                  // líneas tras la conjunción; queda más aireada
                  // que una línea larga junto al badge
                  <Text style={styles.tlCause}>
                    {inc.cause.replace(/ y /g, ' y\n')}
                  </Text>
                ) : null}
                {active && !unclassified ? (
                  <Text style={[styles.tlActive, { color: accent }]}>
                    activo
                  </Text>
                ) : null}
              </View>
            </View>
            {/* Línea de acciones: ▾ despliega la evidencia aquí mismo */}
            {pressItems.length > 0 && (
              <View style={styles.tlActions}>
                <Pressable
                  onPress={() => setTitlesOpen((o) => !o)}
                  hitSlop={8}
                  style={({ pressed }) => pressed && styles.pressFx}
                  accessibilityRole="button"
                  accessibilityLabel={
                    titlesOpen
                      ? 'Ocultar titulares del episodio'
                      : `Ver ${pressItems.length} titulares del episodio`
                  }
                >
                  <Text style={[styles.tlNewsToggle, { color: accent }]}>
                    {titlesOpen
                      ? 'Ocultar titulares ▴'
                      : `Ver titulares (${pressItems.length}) ▾`}
                  </Text>
                </Pressable>
              </View>
            )}
            {pressItems.length > 0 && titlesOpen && (
              <View style={styles.tlTitles}>
                <NewsGroupList
                  groups={groupNewsItems(pressItems)}
                  accentOverride={accent}
                />
              </View>
            )}
          </View>
          {/* Indicador de navegación — el chevron › de las listas
              nativas. Columna hermana con alignSelf:'center': centra
              sobre TODO el alto de la tarjeta (contenido + acciones +
              titulares). Decorativo, la fila entera navega; toma el
              acento del episodio (rojo en cierres) */}
          <Text
            style={[styles.tlChevron, { color: accent }]}
            accessible={false}
          >
            ›
          </Text>
        </View>
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
  onSelectBeach?: (beachId: number, episode?: EpisodeFocus) => void;
  onBack: () => void;
}) {
  // "Sin municipio" no tiene incidentes oficiales (puede tener alertas
  // de prensa en playas OSM): lista vacía de entrada, no skeleton
  const [incidents, setIncidents] = useState<MunicipalityIncident[] | null>(
    detail.municipality ? null : [],
  );

  // Reset durante render al cambiar de municipio abierto
  const [prevDetail, setPrevDetail] = useState(detail);
  if (prevDetail !== detail) {
    setPrevDetail(detail);
    setIncidents(detail.municipality ? null : []);
  }

  // Línea temporal de incidentes del municipio abierto; solo las playas
  // monitorizadas tienen incidentes, así que "Sin municipio" no tiene
  useEffect(() => {
    if (!detail.municipality) return;
    let cancelled = false;
    fetchMunicipalityIncidents(detail.municipality)
      .then((v) => !cancelled && setIncidents(v))
      .catch(() => !cancelled && setIncidents([]));
    return () => {
      cancelled = true;
    };
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
            observations: 'Cierre según prensa',
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

  const beachNameById = useMemo(
    () => new Map(beaches.map((f) => [f.id, f.properties.name ?? ''])),
    [beaches],
  );

  // Cala concreta del episodio dentro del complejo: las zonas que la
  // prensa nombró (zone_beach_ids) o el propio punto si el episodio
  // es de una sola playa. "Playa del Médano · Leocadio Machado" —
  // sin complejo zoneName devuelve null y la fila va a secas
  const zoneLabelOf = (inc: MunicipalityIncident) => {
    const ids = inc.zone_beach_ids?.length
      ? inc.zone_beach_ids
      : [inc.beach_id];
    const zones = [
      ...new Set(
        ids
          .map((id) => beachNameById.get(id))
          .filter((n): n is string => !!n)
          .map((n) => zoneName(n))
          .filter((z): z is string => !!z),
      ),
    ];
    return zones.length ? zones.join(' + ') : null;
  };

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
        {/* Resumen del detalle: cuántos episodios y en cuántas
            playas distintas — contexto rápido antes de scrollear */}
        {detailRows.length > 0 && (
          <Text style={styles.subtitleCount}>
            {detailRows.length} episodio{detailRows.length === 1 ? '' : 's'} ·{' '}
            {new Set(detailRows.map((i) => i.beach_name)).size} playa
            {new Set(detailRows.map((i) => i.beach_name)).size === 1 ? '' : 's'}
          </Text>
        )}
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
            zone={zoneLabelOf(inc)}
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

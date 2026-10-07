import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import SatelliteShot from '../SatelliteShot';
import type { GeoFeature } from '../../lib/api';
import { OutfallNearbyBeach, fetchOutfallNearbyBeaches } from '../../lib/api';
import { beachBaseName, displayBeachName, fmtDistance } from '../../lib/format';
import { outfallRisk, RISK_LABEL, RISK_COLORS } from '../../lib/outfallRisk';
import { beachStatusKey } from '../../lib/beachStatus';
import {
  OUTFALL_STATUS_LABELS,
  CONDITION_COLORS,
  conduitSegs,
  zoneText,
  originLabel,
  protectedAreaName,
  protectedAreaNote,
  natureParts,
  operationText,
  nearbyUniqueBeaches,
} from '../../lib/outfallSheet';
import { colors, fonts } from '../../lib/theme';

type OutfallSheetProps = {
  feature: GeoFeature;
  // Emisarios y playas cargados en la app: se superponen a la foto
  // satélite y dan destino a las filas de "Playas cercanas"
  outfalls?: GeoFeature[];
  beaches?: GeoFeature[];
  // Tap en la foto satélite → ver el punto en el mapa
  onViewOnMap?: () => void;
  // Tap en "Playa más cercana" de la ficha de emisario → verla en el mapa
  onSelectBeach?: (feature: GeoFeature) => void;
};

// Cuerpo de la ficha de EMISARIO: vista satélite, legalidad,
// funcionamiento, espacio protegido, qué se vierte, dónde y cómo,
// playas cercanas y enlace al censo oficial
export default function OutfallSheet({
  feature,
  outfalls,
  beaches,
  onViewOnMap,
  onSelectBeach,
}: OutfallSheetProps) {
  const p = feature.properties;
  const statusKey = p.status ?? 'unknown';
  const operationLine = operationText(p.is_active, p.continuity);
  const risk = outfallRisk(p);

  // Ubicación en una línea: punto concreto · núcleo urbano, sin
  // repetir el municipio ni valores duplicados ("Barranco de Troya
  // · Playa de Las Américas" y luego Municipio: Adeje)
  // Lugar en una sola línea: la descripción del censo es la frase
  // principal y solo se le añade ubicación/núcleo/municipio si no
  // los nombra ya — evita "paseo marítimo de Playa San Juan" dos
  // veces seguidas
  const zoneLine = p.zone_desc ? zoneText(p.zone_desc) : null;
  const whereExtra = [p.location, p.settlement, p.municipality]
    .filter((v): v is string => !!v)
    .filter(
      (v) => !zoneLine || !zoneLine.toLowerCase().includes(v.toLowerCase()),
    )
    .filter((v, i, a) => a.indexOf(v) === i);
  const placeText = zoneLine
    ? whereExtra.length
      ? `${zoneLine.slice(0, -1)}, ${whereExtra.join(', ')}.`
      : zoneLine
    : whereExtra.length
      ? `Está en ${whereExtra.join(', ')}.`
      : null;

  // Playas en un radio de 1.5 km del vertido (proximidad geométrica,
  // no implica vínculo oficial con ningún cierre)
  const [nearby, setNearby] = useState<OutfallNearbyBeach[]>([]);
  useEffect(() => {
    setNearby([]);
    fetchOutfallNearbyBeaches(feature.id)
      .then((list) => setNearby(nearbyUniqueBeaches(list)))
      .catch(() => setNearby([]));
  }, [feature.id]);

  // Marcadores de la foto satélite del emisario: otros vertidos y las
  // playas del entorno proyectados al encuadre (el propio emisario es
  // el dot central)
  const shotMarkers = useMemo(() => {
    const others = (outfalls ?? [])
      .filter((o) => o.id !== feature.id)
      .map((o) => {
        const s = o.properties.status ?? 'unknown';
        return {
          id: `o${o.id}`,
          coords: o.geometry.coordinates as [number, number],
          color:
            colors.outfall[s as keyof typeof colors.outfall] ??
            colors.status.unknown,
          icon: require('../../assets/icons/icon-faucet-sil.png'),
        };
      });
    const beachMarks = (beaches ?? []).map((b) => {
      const k = beachStatusKey(b);
      return {
        id: `b${b.id}`,
        coords: b.geometry.coordinates as [number, number],
        color: colors.status[k],
        icon: require('../../assets/icons/beach_sil.png'),
      };
    });
    return [...beachMarks, ...others];
  }, [outfalls, beaches, feature.id]);

  return (
    <View>
      {/* Vista satélite del entorno: el emisario en el centro,
          otros vertidos y playas alrededor. Clicable → mapa */}
      <SatelliteShot
        center={feature.geometry.coordinates as [number, number]}
        centerColor={colors.outfall[statusKey] ?? colors.status.unknown}
        centerIcon={require('../../assets/icons/icon-faucet-sil.png')}
        markers={shotMarkers}
        line={
          p.start_lon != null && p.start_lat != null
            ? {
                from: [p.start_lon, p.start_lat],
                color: colors.primary,
              }
            : undefined
        }
        onPress={onViewOnMap}
        startLevel={1}
      />
      {/* Chip único de legalidad + frase fluida de funcionamiento:
          "Activo + habitual" como lectura continua, no como etiquetas
          apiladas */}
      <View style={styles.chipsRow}>
        <View
          style={[
            styles.chip,
            {
              backgroundColor:
                colors.outfall[statusKey] ?? colors.status.unknown,
            },
          ]}
        >
          <Text style={styles.chipText}>
            {OUTFALL_STATUS_LABELS[statusKey] ?? 'En trámite / sin datos'}
          </Text>
        </View>
      </View>
      {/* Funcionamiento + riesgo en una sola caja: qué hace hoy y
          cuánto debería importar — el tinte lo marca el nivel de
          riesgo, que es la conclusión */}
      {operationLine || risk ? (
        <View
          style={[
            styles.opBox,
            {
              borderLeftColor: RISK_COLORS[risk!.level],
              backgroundColor: `${RISK_COLORS[risk!.level]}14`,
            },
          ]}
        >
          {operationLine ? (
            <Text style={styles.opText}>{operationLine}</Text>
          ) : null}
          {risk ? (
            <Text
              style={[styles.opText, operationLine ? { marginTop: 4 } : null]}
            >
              <Text
                style={{
                  color: RISK_COLORS[risk.level],
                  fontFamily: fonts.extrabold,
                }}
              >
                {RISK_LABEL[risk.level]}
              </Text>
              {risk.reasons.length ? ` — ${risk.reasons.join(', ')}` : ''}.
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* ZEC justo tras el funcionamiento: que vierta en zona
          protegida es contexto de máxima prioridad */}
      {p.protected_area ? (
        <View style={styles.protectedBox}>
          <Text style={styles.protectedTitle}>
            Emisario en espacio protegido
          </Text>
          <Text style={styles.protectedName}>
            Este emisario está dentro de la{' '}
            {protectedAreaName(p.protected_area)}, una Zona Especial de
            Conservación de la red Natura 2000
            {protectedAreaNote(p.protected_area)}.
          </Text>
        </View>
      ) : null}
      {/* El vertido: la respuesta protagonista — qué cae al mar y de
          dónde viene. Es la pregunta que abre la ficha */}
      {p.nature || p.entity || p.manager ? (
        <View style={styles.heroBox}>
          <View style={styles.heroText}>
            {p.nature ? (
              <>
                <View style={styles.secHead}>
                  <Image
                    source={require('../../assets/icons/icon-faucet.png')}
                    style={[styles.secIcon, { tintColor: colors.accent }]}
                  />
                  <Text style={styles.secCardTitle}>Qué se vierte</Text>
                </View>
                <Text style={styles.heroValue}>{p.nature}</Text>
                {p.origin ? (
                  <Text style={styles.heroSub}>{originLabel(p.origin)}</Text>
                ) : null}
                {natureParts(
                  p.nature,
                  p.origin,
                  p.outfall_depth,
                  p.zone_desc,
                ).map((pt, i) => {
                  // Si la etiqueta repite el subtítulo ("Desaladora"
                  // bajo "Desaladora") no se pinta: queda solo la
                  // frase explicativa
                  const dup =
                    !!p.origin &&
                    pt.label.toLowerCase() ===
                      originLabel(p.origin).toLowerCase();
                  const desc = pt.desc
                    ? dup
                      ? pt.desc[0].toUpperCase() + pt.desc.slice(1)
                      : pt.desc
                    : null;
                  return (
                    <Text key={i} style={styles.heroNote}>
                      {dup ? null : (
                        <Text style={styles.heroRespStrong}>
                          {pt.label[0].toUpperCase() + pt.label.slice(1)}
                          {pt.colon ? ':' : ''}
                        </Text>
                      )}
                      {desc ? (
                        <Text style={styles.heroRespStrong}>
                          {dup ? desc : ` ${desc}`}
                        </Text>
                      ) : null}
                      {dup && !desc
                        ? pt.note[0].toUpperCase() + pt.note.slice(1)
                        : pt.colon
                          ? ` ${pt.note}`
                          : ` — ${pt.note}`}
                    </Text>
                  );
                })}
              </>
            ) : null}
            {/* Solo el responsable: la distinción titular/gestor
                (Entidad vs GestSan) no le dice nada al bañista y
                partía la línea en dos etiquetas distintas según el
                emisario */}
            {p.entity || p.manager ? (
              <Text style={styles.heroResp}>
                Responsable:{' '}
                <Text style={styles.heroRespStrong}>
                  {p.entity ?? p.manager}
                </Text>
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
      {/* Dónde + conducción en una sola card: son pocos datos y
          juntos narran "está aquí, sale así". El responsable vive en
          el hero; la profundidad va visible */}
      {p.location ||
      p.settlement ||
      p.municipality ||
      p.zone_desc ||
      p.kind ||
      p.length_m != null ||
      p.outfall_depth != null ||
      p.condition ? (
        <View style={[styles.secCard, { borderLeftColor: colors.accent }]}>
          <View style={styles.secHead}>
            <Image
              source={require('../../assets/icons/icon-map.png')}
              style={[styles.secIcon, { tintColor: colors.accent }]}
            />
            <Text style={styles.secCardTitle}>Dónde y cómo</Text>
          </View>
          {placeText ? <Text style={styles.zoneDesc}>{placeText}</Text> : null}
          {conduitSegs(p.kind, p.shore_m, p.length_m, p.outfall_depth) ? (
            <Text style={styles.row}>
              {conduitSegs(p.kind, p.shore_m, p.length_m, p.outfall_depth)!.map(
                (s, i) =>
                  s.b ? (
                    <Text key={i} style={styles.rowStrong}>
                      {s.t}
                    </Text>
                  ) : (
                    s.t
                  ),
              )}
            </Text>
          ) : null}
          {p.condition ? (
            <Text style={styles.row}>
              Su estado es{' '}
              <Text
                style={[
                  styles.rowStrong,
                  {
                    color: CONDITION_COLORS[p.condition] ?? colors.text,
                  },
                ]}
              >
                {p.condition.toLowerCase()}
              </Text>
              .
            </Text>
          ) : null}
        </View>
      ) : null}
      {/* Playas cercanas como card: es la respuesta a "¿dónde me
          afecta?" — las filas abren la playa en el mapa */}
      {nearby.length > 0 ? (
        <View style={[styles.secCard, { borderLeftColor: colors.accent }]}>
          <View style={styles.secHead}>
            <Image
              source={require('../../assets/icons/icon-wave.png')}
              style={[styles.secIcon, { tintColor: colors.accent }]}
            />
            <Text style={styles.secCardTitle}>Playas cercanas</Text>
          </View>
          <Text style={styles.nearSub}>
            Si no las ves en el mapa, aleja el zoom
          </Text>
          {nearby.map((n) => {
            const beachTarget = (beaches ?? []).find(
              (b) => b.id === n.beach_id,
            );
            // La barra codifica exposición a ESTE emisario por
            // distancia (todas las filas son del mismo punto, el
            // color legal no variaría): rojo pegado, naranja al
            // alcance de la pluma, amarillo ya diluido
            const distColor =
              n.distance_m < 500
                ? colors.outfall.illegal // #c62828 rojo
                : n.distance_m < 1000
                  ? colors.status.warning // #e65100 naranja
                  : colors.outfall.unknown; // #f9a825 amarillo
            return (
              <Pressable
                key={n.beach_id}
                style={({ pressed }) => [
                  styles.nearestBox,
                  { borderLeftColor: distColor },
                  pressed && styles.pressFx,
                ]}
                onPress={
                  beachTarget && onSelectBeach
                    ? () => onSelectBeach(beachTarget)
                    : undefined
                }
                disabled={!beachTarget || !onSelectBeach}
                accessibilityRole="button"
                accessibilityLabel={`${displayBeachName(beachBaseName(n.beach_name))}, ver en el mapa`}
              >
                <View style={styles.nearestBody}>
                  <Text style={styles.nearestName} numberOfLines={1}>
                    {displayBeachName(beachBaseName(n.beach_name))}
                  </Text>
                  {n.municipality ? (
                    <Text style={styles.nearestMeta}>{n.municipality}</Text>
                  ) : null}
                </View>
                {/* Distancia como badge: columna escaneable, mismo
                    formato que "Emisarios cercanos" */}
                <Text style={[styles.nearestDist, { color: distColor }]}>
                  {fmtDistance(n.distance_m)}
                </Text>
                {beachTarget && onSelectBeach && (
                  <Text style={styles.nearestChevron}>›</Text>
                )}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Fuente oficial como pie discreto — la tabla cruda se fue:
          cada dato relevante ya está narrado en las cards y el resto
          no le dice nada al bañista. Queda el enlace por
          transparencia */}
      {p.source_url ? (
        <Pressable
          onPress={() => p.source_url && Linking.openURL(p.source_url)}
          accessibilityRole="link"
          accessibilityLabel="Abrir el censo oficial de vertidos"
          style={({ pressed }) => [
            styles.censusSrcWrap,
            pressed && styles.pressFx,
          ]}
        >
          <Text style={styles.censusSrc}>
            Fuente: Censo Vertidos Tierra-Mar 2025 ↗
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Feedback táctil común: leve fundido al presionar
  pressFx: {
    opacity: 0.6,
  },
  // Los chips del emisario van en fila (legalidad + activo + régimen):
  // el chip solo pierde el centrado cuando hay hermanos
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
  },
  chip: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 8,
    marginBottom: 4,
  },
  chipText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  // Caja de funcionamiento (activo/régimen): barra + fondo tintado
  // del color de escenario, como las cajas de prensa o la ZEC
  opBox: {
    marginTop: 6,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  opText: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.text,
    lineHeight: 17,
  },
  row: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.text,
    marginTop: 4,
  },
  rowStrong: {
    fontFamily: fonts.semibold,
  },
  zoneDesc: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.text,
    marginTop: 4,
  },
  // Respuesta protagonista del emisario: "qué se vierte" con icono —
  // no una fila más, es la pregunta que abre la ficha
  heroBox: {
    marginTop: 8,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    backgroundColor: colors.background,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  heroText: {
    flex: 1,
  },
  heroValue: {
    fontSize: 15,
    fontFamily: fonts.extrabold,
    color: colors.text,
    marginTop: 1,
    textAlign: 'center',
  },
  heroSub: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  heroNote: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    lineHeight: 18,
    marginTop: 4,
  },
  heroResp: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 4,
  },
  heroRespStrong: {
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  // Sección como mini-card: barra de color + icono + título, mismo
  // lenguaje que heroBox y la caja de espacio protegido
  secCard: {
    marginTop: 10,
    borderLeftWidth: 3,
    backgroundColor: colors.background,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  secHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginBottom: 2,
  },
  // Icono de cabecera de card — mismo tamaño que el grifo del hero
  secIcon: {
    width: 22,
    height: 22,
  },
  // Título de card único: "Qué se vierte", "Dónde y cómo" y
  // "Playas cercanas" comparten tamaño, peso y color
  secCardTitle: {
    fontSize: 15,
    fontFamily: fonts.extrabold,
    color: colors.primaryDark,
  },
  // ZEC en ámbar (aviso), no verde: verter dentro de una zona
  // protegida hace al emisario más delicado, no más "correcto"
  protectedBox: {
    marginTop: 8,
    marginBottom: 4,
    borderLeftWidth: 3,
    borderLeftColor: colors.status.warning,
    backgroundColor: `${colors.status.warning}14`,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  protectedTitle: {
    fontSize: 11,
    fontFamily: fonts.bold,
    color: colors.status.warning,
    textTransform: 'uppercase',
  },
  protectedName: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.text,
    marginTop: 1,
  },
  nearestBox: {
    marginBottom: 6,
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 4,
    backgroundColor: colors.background,
    borderRadius: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  nearestChevron: {
    fontSize: 16,
    fontFamily: fonts.semibold,
    color: colors.textFaint,
    paddingRight: 8,
  },
  nearestBody: {
    flex: 1,
    paddingRight: 4,
  },
  nearestMeta: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 1,
  },
  // Distancia como badge en columna — mismo patrón que
  // outfallDist en BeachDetail ("Emisarios cercanos")
  nearestDist: {
    fontSize: 13,
    fontFamily: fonts.bold,
    alignSelf: 'center',
    marginRight: 6,
    minWidth: 46,
    textAlign: 'right',
  },
  nearSub: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginBottom: 6,
  },
  nearestName: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  // Pie: solo el enlace a la fuente oficial, discreto
  censusSrcWrap: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
    paddingBottom: 4,
  },
  censusSrc: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: colors.primary,
    textAlign: 'center',
  },
});

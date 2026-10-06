import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import type { BeachNews } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { NEWS_PHASE_COLOR, type NewsGroup } from '../../lib/news';
import { colors, fonts } from '../../lib/theme';

// Fila de titular enlazable: borde y flecha con el color de la fase
// (o el del banner si es de reapertura)
function NewsItemRow({ n, accent }: { n: BeachNews; accent: string }) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.newsRow,
        { borderLeftColor: accent },
        pressed && styles.pressFx,
      ]}
      onPress={() => Linking.openURL(n.url).catch(() => {})}
      accessibilityRole="link"
      accessibilityLabel={`Noticia: ${n.title}`}
    >
      <View style={styles.newsRowBody}>
        <Text style={styles.newsTitle} numberOfLines={2}>
          {n.title}
        </Text>
        <Text style={styles.newsMeta} numberOfLines={1}>
          {[
            n.source,
            n.published_at ? fmtDate(n.published_at.slice(0, 10)) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <Text style={[styles.newsChevron, { color: accent }]}>›</Text>
    </Pressable>
  );
}

// Bloque completo de grupos: compartido por el banner y la expansión
// de cada fila del historial
export default function NewsGroupList({
  groups,
  accentOverride,
}: {
  groups: NewsGroup[];
  accentOverride?: string;
}) {
  return (
    <>
      {groups.map((g) => {
        const accent = accentOverride ?? NEWS_PHASE_COLOR[g.type];
        return (
          <View key={g.label} style={styles.newsGroup}>
            <Text style={[styles.newsGroupTitle, { color: accent }]}>
              {g.label}
            </Text>
            {g.items.map((n) => (
              <NewsItemRow key={n.id} n={n} accent={accent} />
            ))}
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  // Feedback táctil común: leve fundido al presionar
  pressFx: {
    opacity: 0.6,
  },
  newsGroup: {
    marginTop: 4,
  },
  newsGroupTitle: {
    fontSize: 11,
    fontFamily: fonts.extrabold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 4,
    marginTop: 4,
  },
  // Cada titular es una tarjeta blanca dentro de la caja ámbar "según
  // prensa": el blanco la separa del crema y el chevron naranja al
  // final anuncia que es pulsable (abre el artículo)
  newsRow: {
    borderLeftWidth: 3,
    borderLeftColor: colors.status.warning,
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 4,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderRadius: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  newsRowBody: {
    flex: 1,
  },
  newsChevron: {
    fontSize: 18,
    fontFamily: fonts.extrabold,
    color: colors.status.warning,
    marginLeft: 6,
  },
  newsTitle: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  newsMeta: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 1,
  },
});

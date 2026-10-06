import React from 'react';
import {
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { SearchItem } from '../../lib/mapData';
import { colors, fonts } from '../../lib/theme';

type MapSearchProps = {
  query: string;
  onChangeQuery: (q: string) => void;
  results: SearchItem[];
  onPick: (item: SearchItem) => void;
  // Ref del input: el padre lo desenfoca al cerrar (Android conserva
  // el foco y el teclado si solo se llama a Keyboard.dismiss())
  inputRef: React.RefObject<TextInput | null>;
};

// Buscador de la topbar: input + lista de resultados
export default function MapSearch({
  query,
  onChangeQuery,
  results,
  onPick,
  inputRef,
}: MapSearchProps) {
  return (
    <View style={styles.searchWrap}>
      <View style={styles.searchBar}>
        <Image
          source={require('../../assets/icons/icon-search.png')}
          style={styles.searchIcon}
        />
        <TextInput
          ref={inputRef}
          style={styles.searchInput}
          placeholder="Buscar playa, emisario o municipio..."
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={onChangeQuery}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Buscar playa, emisario o municipio"
        />
      </View>
      {results.length > 0 && (
        <View style={styles.searchResults}>
          {results.map((item) => (
            <Pressable
              key={item.key}
              style={({ pressed }) => [
                styles.searchRow,
                pressed && styles.pressFx,
              ]}
              onPress={() => onPick(item)}
              accessibilityRole="button"
              accessibilityLabel={`${item.label}, ${item.sub}`}
              accessibilityHint="Centrar en el mapa"
            >
              <Text style={styles.searchLabel} numberOfLines={1}>
                {item.label}
              </Text>
              <Text style={styles.searchSub} numberOfLines={1}>
                {item.sub}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Feedback táctil común: leve fundido al presionar
  pressFx: {
    opacity: 0.6,
  },
  searchWrap: {
    alignSelf: 'stretch',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 12,
    paddingHorizontal: 14,
    elevation: 4,
  },
  searchIcon: {
    width: 16,
    height: 16,
    tintColor: colors.textFaint,
  },
  searchInput: {
    flex: 1,
    paddingLeft: 8,
    paddingVertical: 9,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  searchResults: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 12,
    marginTop: 6,
    paddingVertical: 4,
    elevation: 6,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 10,
  },
  searchLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  searchSub: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
});

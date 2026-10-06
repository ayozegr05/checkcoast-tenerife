import React from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';

import { colors, fonts } from '../../lib/theme';

type MapTopbarProps = {
  onOpenList?: () => void;
  onOpenOutfalls?: () => void;
  onOpenMunicipalities?: () => void;
  onToggleSearch: () => void;
  onOpenHelp?: () => void;
};

function TopbarButton({
  icon,
  label,
  a11yLabel,
  onPress,
}: {
  icon: ImageSourcePropType;
  label: string;
  a11yLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.topbarBtn,
        pressed && styles.topbarBtnPressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
    >
      <Image source={icon} style={styles.topbarIcon} />
      <Text style={styles.topbarLabel}>{label}</Text>
    </Pressable>
  );
}

// Barra superior: logo + accesos a listas, buscador y guía. Los
// botones opcionales solo se pintan si el padre pasa su handler
export default function MapTopbar({
  onOpenList,
  onOpenOutfalls,
  onOpenMunicipalities,
  onToggleSearch,
  onOpenHelp,
}: MapTopbarProps) {
  return (
    <View style={styles.topbar}>
      <Image
        source={require('../../assets/icon.png')}
        style={styles.topbarBrand}
      />
      {onOpenList && (
        <>
          <TopbarButton
            icon={require('../../assets/icons/beach.png')}
            label="Playas"
            a11yLabel="Abrir lista de playas"
            onPress={onOpenList}
          />
          <View style={styles.topbarDivider} />
        </>
      )}
      {onOpenOutfalls && (
        <>
          <TopbarButton
            icon={require('../../assets/icons/icon-faucet.png')}
            label="Emisarios"
            a11yLabel="Abrir lista de emisarios"
            onPress={onOpenOutfalls}
          />
          <View style={styles.topbarDivider} />
        </>
      )}
      {onOpenMunicipalities && (
        <>
          <TopbarButton
            icon={require('../../assets/icons/icon-townhall.png')}
            label="Municipios"
            a11yLabel="Abrir incidencias por municipio"
            onPress={onOpenMunicipalities}
          />
          <View style={styles.topbarDivider} />
        </>
      )}
      <TopbarButton
        icon={require('../../assets/icons/icon-search.png')}
        label="Buscar"
        a11yLabel="Buscar playa, emisario o municipio"
        onPress={onToggleSearch}
      />
      <View style={styles.topbarDivider} />
      {onOpenHelp && (
        <TopbarButton
          icon={require('../../assets/icons/icon-book.png')}
          label="Guía"
          a11yLabel="Abrir guía de uso"
          onPress={onOpenHelp}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Altura fija: el icono absoluto la necesita como referencia
  // estable. top+bottom sin altura fija en un hijo absoluto dentro de
  // un contenedor de alto automático es ambiguo para Yoga y puede
  // disparar el tamaño sin control — de ahí el bug anterior.
  topbar: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    height: 48,
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 14,
    paddingLeft: 52,
    paddingRight: 6,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  topbarBrand: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 48,
    height: 48,
    opacity: 0.72,
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
  },
  topbarBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 0,
    paddingVertical: 5,
    borderRadius: 8,
  },
  topbarBtnPressed: {
    backgroundColor: 'rgba(7,82,118,0.10)',
  },
  topbarIcon: {
    width: 22,
    height: 22,
  },
  topbarLabel: {
    fontSize: 10,
    lineHeight: 12,
    fontFamily: fonts.semibold,
    color: colors.text,
    marginTop: 1,
  },
  topbarDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.border,
    marginVertical: 4,
  },
});

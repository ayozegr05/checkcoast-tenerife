import React, { useState } from 'react';
import {
  Image,
  ImageBackground,
  ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, fonts } from '../lib/theme';

const HINTS: [ImageSourcePropType, string][] = [
  [
    require('../assets/icons/beach.png'),
    'Playas: estado oficial, calidad del agua e incidencias · toca un punto para su ficha',
  ],
  [
    require('../assets/icons/icon-faucet.png'),
    'Emisarios: puntos de vertido autorizados, en trámite o no autorizados',
  ],
  [
    require('../assets/icons/icon-bell.png'),
    'Avisos: recibe una notificación si una playa cierra o reabre',
  ],
  [
    require('../assets/icons/icon-townhall.png'),
    'Municipios: ranking de afectación por municipio',
  ],
];

export default function IntroCard({
  onClose,
}: {
  // dontShow = true -> persistir "no volver a mostrar"
  onClose: (dontShow: boolean) => void;
}) {
  const [dontShow, setDontShow] = useState(false);
  return (
    <View style={styles.backdrop}>
      <View style={styles.card}>
        <ImageBackground
          source={require('../assets/gradient-sea.png')}
          style={styles.header}
          resizeMode="cover"
        >
          <Text style={styles.title}>CheckCoast Tenerife</Text>
          <Text style={styles.subtitle}>
            Estado de las playas y emisarios de la isla, con datos
            oficiales actualizados
          </Text>
        </ImageBackground>

        <View style={styles.body}>
          {HINTS.map(([icon, text], i) => (
            <View key={i} style={styles.hintRow}>
              <Image source={icon} style={styles.hintIcon} />
              <Text style={styles.hintText}>{text}</Text>
            </View>
          ))}
        </View>

        <View style={styles.footer}>
          <Pressable
            style={styles.checkRow}
            onPress={() => setDontShow((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: dontShow }}
          >
            <View style={[styles.checkBox, dontShow && styles.checkBoxOn]}>
              {dontShow && <Text style={styles.checkMark}>✓</Text>}
            </View>
            <Text style={styles.checkLabel}>No volver a mostrar</Text>
          </Pressable>
          <Pressable
            onPress={() => onClose(dontShow)}
            accessibilityRole="button"
          >
            <ImageBackground
              source={require('../assets/gradient-sea.png')}
              style={styles.btn}
              resizeMode="cover"
            >
              <Text style={styles.btnText}>Entendido</Text>
            </ImageBackground>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(7, 43, 62, 0.35)',
  },
  card: {
    marginHorizontal: 24,
    maxWidth: 420,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
  },
  title: {
    fontSize: 20,
    fontFamily: fonts.extrabold,
    color: '#fff',
  },
  subtitle: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 4,
    lineHeight: 18,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 4,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  hintIcon: {
    width: 26,
    height: 26,
    marginRight: 12,
  },
  hintText: {
    flex: 1,
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 18,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    marginTop: 6,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkBox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.textFaint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  checkBoxOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkMark: {
    color: '#fff',
    fontSize: 13,
    fontFamily: fonts.bold,
    marginTop: -1,
  },
  checkLabel: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  btn: {
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 20,
    overflow: 'hidden',
  },
  btnText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: fonts.bold,
  },
});

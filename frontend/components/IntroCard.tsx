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
    require('../assets/icons/pin-open.png'),
    '¿Puedo bañarme? Verde apta, naranja con aviso, roja cerrada: decide de un vistazo al mapa',
  ],
  [
    require('../assets/icons/icon-book.png'),
    'Tu playa cuenta su historia: toca un punto y verás por qué cerró, cuándo y qué dice la prensa',
  ],
  [
    require('../assets/icons/icon-faucet.png'),
    '¿Qué se vierte cerca? Emisarios del censo oficial: qué vierten, en qué estado están y quién responde',
  ],
  [
    require('../assets/icons/icon-bell.png'),
    'No te enteres tarde: aviso al móvil si una playa cierra o reabre',
  ],
  [
    require('../assets/icons/icon-townhall.png'),
    '¿Dónde se concentra el problema? Ranking de municipios por incidencias',
  ],
];

export default function IntroCard({
  onClose,
  revisit = false,
  onBack,
}: {
  // dontShow = true -> persistir "no volver a mostrar"
  onClose: (dontShow: boolean) => void;
  // Reabierta desde la Guía: sin "No volver a mostrar" (la acaban de
  // pedir) — ‹ vuelve al índice de la guía, ✕ cierra al mapa
  revisit?: boolean;
  onBack?: () => void;
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
          <View style={styles.titleRow}>
            {revisit && onBack && (
              <Pressable
                onPress={onBack}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.navBackBtn,
                  pressed && styles.pressFx,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Volver a la guía"
              >
                <Text style={styles.navBackText}>‹</Text>
              </Pressable>
            )}
            <View style={styles.titleCenter}>
              <Image
                source={require('../assets/icon.png')}
                style={[styles.titleIcon, revisit && styles.titleIconRevisit]}
              />
              <Text style={[styles.title, revisit && styles.titleRevisit]}>
                CheckCoast Tenerife
              </Text>
            </View>
            {revisit && (
              <Pressable
                onPress={() => onClose(false)}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.navBtn,
                  pressed && styles.pressFx,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Cerrar"
              >
                <Text style={styles.navCloseText}>✕</Text>
              </Pressable>
            )}
          </View>
          <Text style={styles.subtitle}>
            ¿Puedo bañarme hoy? El estado real de las playas de Tenerife
          </Text>
        </ImageBackground>

        <View style={styles.body}>
          {HINTS.map(([icon, text], i) => (
            <View key={i} style={styles.hintRow}>
              <Image source={icon} style={styles.hintIcon} />
              <Text style={styles.hintText}>{text}</Text>
            </View>
          ))}
          {/* Honestidad primero: "abierta" no promete seguridad — es
              ausencia de incidencia conocida. Decirlo aquí construye
              la confianza que nos diferencia */}
          <Text style={styles.note}>
            Verde significa «sin incidencias oficiales activas», no una
            garantía. Si hay duda, cada ficha muestra la última analítica y su
            fecha.
          </Text>
        </View>

        {!revisit && (
          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [
                styles.checkRow,
                pressed && styles.pressFx,
              ]}
              onPress={() => setDontShow((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: dontShow }}
            >
              <View style={[styles.checkBox, dontShow && styles.checkBoxOn]}>
                {dontShow && <Text style={styles.checkMark}>✓</Text>}
              </View>
              <Text style={styles.checkLabel}>No mostrar al inicio</Text>
            </Pressable>
            <Pressable
              onPress={() => onClose(dontShow)}
              style={({ pressed }) => pressed && styles.pressFx}
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
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Feedback táctil común: leve fundido al presionar
  pressFx: {
    opacity: 0.6,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(7, 43, 62, 0.35)',
    // Android: sin elevation los botones flotantes del mapa (elev 3-6)
    // ganan el hit-test aunque queden bajo la cortina. shadowColor
    // transparent: la elevation dibuja una sombra negra en los bordes
    // de la vista (bandas laterales a pantalla completa)
    elevation: 30,
    zIndex: 30,
    shadowColor: 'transparent',
  },
  card: {
    width: '86%',
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  titleCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 10,
  },
  titleIcon: {
    width: 26,
    height: 26,
    borderRadius: 7,
  },
  // Botones de cabecera del modo "revisit": ‹ círculo como el de
  // HelpHub, ✕ cuadrado-redondeado como las secciones
  navBackBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  navBackText: {
    color: '#fff',
    fontSize: 22,
    fontFamily: fonts.bold,
    marginTop: -3,
  },
  navCloseText: {
    fontSize: 20,
    fontFamily: fonts.extrabold,
    color: 'rgba(255,255,255,0.9)',
  },
  title: {
    fontSize: 20,
    fontFamily: fonts.extrabold,
    color: '#fff',
  },
  // En modo revisit (desde la Guía) los botones ‹ ✕ roban ancho —
  // título e icono un punto más pequeños para que respire, igual que
  // las cabeceras de sección (títulos cortos a 18)
  titleRevisit: {
    fontSize: 17,
  },
  titleIconRevisit: {
    width: 22,
    height: 22,
    borderRadius: 6,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 10,
    lineHeight: 18,
    textAlign: 'center',
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
  note: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    lineHeight: 15,
    marginTop: 4,
    marginBottom: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    textAlign: 'center',
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

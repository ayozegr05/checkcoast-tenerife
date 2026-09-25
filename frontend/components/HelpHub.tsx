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

type Topic = {
  key: string;
  icon: ImageSourcePropType;
  title: string;
  subtitle: string;
  rows: [ImageSourcePropType, string][];
};

const TOPICS: Topic[] = [
  {
    key: 'mapa',
    icon: require('../assets/icons/icon-layers.png'),
    title: 'El mapa',
    subtitle: 'Qué ves y cómo cambiarlo',
    rows: [
      [
        require('../assets/icons/icon-layers.png'),
        'El botón de capas abre un panel para filtrar los estados: solo las cerradas, solo los vertidos sin permiso…',
      ],
      [
        require('../assets/icons/icon-satellite.png'),
        '¿Quieres ver la foto real? El botón de satélite cambia a vista aérea',
      ],
      [
        require('../assets/icons/icon-search.png'),
        'Busca una playa, un vertido o un municipio y te lleva directo',
      ],
      [
        require('../assets/icons/icon-compass.png'),
        'Si giras el mapa, la brújula te devuelve el norte',
      ],
    ],
  },
  {
    key: 'playas',
    icon: require('../assets/icons/beach.png'),
    title: 'Playas y fichas',
    subtitle: 'Estado, calidad del agua e incidencias',
    rows: [
      [
        require('../assets/icons/beach.png'),
        'Cuatro colores: azul apta, naranja aviso, roja cerrada, gris sin vigilancia',
      ],
      [
        require('../assets/icons/icon-satellite.png'),
        'Toca una playa y verás su foto aérea, cómo está el agua y su historial de cierres',
      ],
      [
        require('../assets/icons/icon-map.png'),
        'El botón del mapa te lleva volando hasta la playa',
      ],
      [
        require('../assets/icons/icon-faucet.png'),
        '¿Hay un vertido cerca? Tócalo y lo ves en el mapa',
      ],
    ],
  },
  {
    key: 'vertidos',
    icon: require('../assets/icons/icon-faucet.png'),
    title: 'Emisarios',
    subtitle: 'Los 180 vertidos de la isla y su estado legal',
    rows: [
      [
        require('../assets/icons/icon-faucet.png'),
        'Tres colores según su estado legal: verde autorizado, ámbar en trámite, rojo sin permiso',
      ],
      [
        require('../assets/icons/icon-satellite.png'),
        'Toca un emisario y verás su foto aérea con las playas que tiene alrededor',
      ],
      [
        require('../assets/icons/beach.png'),
        '"Playa más cercana" te dice a qué playa afecta y te lleva a ella',
      ],
    ],
  },
  {
    key: 'municipios',
    icon: require('../assets/icons/icon-townhall.png'),
    title: 'Municipios',
    subtitle: 'Qué municipios acumulan más incidencias',
    rows: [
      [
        require('../assets/icons/icon-townhall.png'),
        'Un ranking de quién acumula más cierres, avisos e incidencias',
      ],
      [
        require('../assets/icons/icon-alert.png'),
        'La barra de color te dice cómo está cada uno: roja si hay cierres ahora, naranja avisos, azul solo pasado; cuanto más larga, peor estado',
      ],
      [
        require('../assets/icons/beach.png'),
        'Toca un municipio y verás su historial completo de incidencias: qué playa, cuándo y por qué',
      ],
    ],
  },
  {
    key: 'prensa',
    icon: require('../assets/icons/icon-news.png'),
    title: 'Noticias',
    subtitle: 'El porqué que Sanidad no da',
    rows: [
      [
        require('../assets/icons/icon-news.png'),
        'Titulares de prensa local que pueden explicar por qué una playa está cerrada',
      ],
      [
        require('../assets/icons/icon-alert.png'),
        'Las noticias dan contexto "según prensa"; cuando no hay dato oficial, pueden ser la única pista',
      ],
      [
        require('../assets/icons/beach.png'),
        'En la ficha de playa, toca "Ver titulares" para leer las noticias',
      ],
    ],
  },
];

export default function HelpHub({
  onClose,
  onShowIntro,
}: {
  onClose: () => void;
  onShowIntro?: () => void;
}) {
  const [topic, setTopic] = useState<Topic | null>(null);

  return (
    <View style={styles.backdrop}>
      <View style={styles.card}>
        <ImageBackground
          source={require('../assets/gradient-sea.png')}
          style={styles.header}
          resizeMode="cover"
        >
          <View style={styles.titleRow}>
            {topic && (
              <Pressable
                style={styles.headerBack}
                onPress={() => setTopic(null)}
                accessibilityRole="button"
                accessibilityLabel="Volver al índice de la guía"
              >
                <Text style={styles.headerBackText}>‹</Text>
              </Pressable>
            )}
            <View style={styles.titleWrap}>
              <Text style={styles.title}>
                {topic ? topic.title : 'Guía'}
              </Text>
              <Text style={styles.subtitle}>
                {topic
                  ? topic.subtitle
                  : 'Elige un tema para ver cómo funciona'}
              </Text>
            </View>
          </View>
        </ImageBackground>

        <View style={styles.body}>
          {topic
            ? topic.rows.map(([icon, text], i) => (
                <View key={i} style={styles.hintRow}>
                  <Image source={icon} style={styles.hintIcon} />
                  <Text style={styles.hintText}>{text}</Text>
                </View>
              ))
            : (
                <>
                  {onShowIntro && (
                    <Pressable
                      style={styles.topicRow}
                      onPress={onShowIntro}
                      accessibilityRole="button"
                      accessibilityLabel="Ver la tarjeta de bienvenida"
                    >
                      <Image
                        source={require('../assets/icon.png')}
                        style={styles.hintIcon}
                      />
                      <View style={styles.topicTextWrap}>
                        <Text style={styles.topicTitle}>
                          ¿Qué es CheckCoast?
                        </Text>
                        <Text style={styles.topicSub}>
                          Primeros pasos: lo esencial en 5 líneas
                        </Text>
                      </View>
                      <Text style={styles.topicChevron}>›</Text>
                    </Pressable>
                  )}
                  {TOPICS.map((t) => (
                    <Pressable
                      key={t.key}
                      style={styles.topicRow}
                      onPress={() => setTopic(t)}
                      accessibilityRole="button"
                      accessibilityLabel={`Ayuda sobre ${t.title}`}
                    >
                      <Image source={t.icon} style={styles.hintIcon} />
                      <View style={styles.topicTextWrap}>
                        <Text style={styles.topicTitle}>{t.title}</Text>
                        <Text style={styles.topicSub}>{t.subtitle}</Text>
                      </View>
                      <Text style={styles.topicChevron}>›</Text>
                    </Pressable>
                  ))}
                </>
              )}
        </View>

        <View style={styles.footer}>
          <View />
          <Pressable onPress={onClose} accessibilityRole="button">
            <ImageBackground
              source={require('../assets/gradient-sea.png')}
              style={styles.btn}
              resizeMode="cover"
            >
              <Text style={styles.btnText}>Cerrar</Text>
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
  },
  titleWrap: {
    flex: 1,
  },
  headerBack: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerBackText: {
    color: '#fff',
    fontSize: 22,
    fontFamily: fonts.bold,
    marginTop: -3,
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
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  topicTextWrap: {
    flex: 1,
  },
  topicTitle: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  topicSub: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 1,
  },
  topicChevron: {
    fontSize: 20,
    fontFamily: fonts.bold,
    color: colors.textMuted,
    marginLeft: 8,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    marginTop: 6,
  },
  backBtn: {
    paddingVertical: 9,
    paddingRight: 12,
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

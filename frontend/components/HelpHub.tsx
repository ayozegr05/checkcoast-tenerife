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
        require('../assets/icons/icon-map.png'),
        'La leyenda inferior activa o quita playas y emisarios',
      ],
      [
        require('../assets/icons/icon-layers.png'),
        'El botón de capas (arriba a la derecha) alterna entre mapa y vista satélite',
      ],
      [
        require('../assets/icons/icon-search.png'),
        'Buscar localiza playas, emisarios y municipios; los nombres salen al acercar',
      ],
      [
        require('../assets/icons/beach.png'),
        'Los puntos grises son playas sin monitorización oficial',
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
        'Estados: apta (azul), aviso (naranja), cerrada (roja), gris = sin monitorizar',
      ],
      [
        require('../assets/icons/icon-satellite.png'),
        'Cada ficha tiene foto satélite con zoom ±, emisarios cercanos, calidad del agua e incidencias',
      ],
      [
        require('../assets/icons/icon-map.png'),
        'El botón de mapa de la ficha te lleva al punto con el pin destacado',
      ],
      [
        require('../assets/icons/icon-faucet.png'),
        'Los emisarios cercanos son clables: vas a su pin y al volver regresas a la ficha',
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
        'Autorizados (verde), en trámite (ámbar) o no autorizados (rojo)',
      ],
      [
        require('../assets/icons/icon-satellite.png'),
        'Su ficha muestra foto satélite con los vertidos y playas del entorno',
      ],
      [
        require('../assets/icons/beach.png'),
        'Toca "Playa más cercana" para saltar a su pin en el mapa y volver con atrás',
      ],
      [
        require('../assets/icons/icon-faucet.png'),
        'La lista de emisarios se abre desde la barra superior',
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
        'Ordena los municipios por playas cerradas, avisos e incidencias',
      ],
      [
        require('../assets/icons/icon-alert.png'),
        'La barra de severidad resume el estado general de cada municipio',
      ],
      [
        require('../assets/icons/beach.png'),
        'Toca un municipio para ver su línea temporal de incidencias y abrir cada playa',
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
        'Siempre etiquetados "según prensa": nunca alteran el estado oficial',
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
          <Text style={styles.title}>
            {topic ? topic.title : 'Ayuda'}
          </Text>
          <Text style={styles.subtitle}>
            {topic
              ? topic.subtitle
              : 'Elige un tema para ver cómo funciona'}
          </Text>
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
          {topic ? (
            <Pressable
              style={styles.backBtn}
              onPress={() => setTopic(null)}
              accessibilityRole="button"
              accessibilityLabel="Volver al índice de ayuda"
            >
              <Text style={styles.backText}>‹ Temas</Text>
            </Pressable>
          ) : (
            <View />
          )}
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
  backText: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.primary,
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

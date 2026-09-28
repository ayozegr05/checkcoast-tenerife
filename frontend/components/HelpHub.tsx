import React, { useEffect, useState } from 'react';
import {
  BackHandler,
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
        'Tres vistas: el ranking por municipio, lo de este verano y lo de este año',
      ],
      [
        require('../assets/icons/icon-alert.png'),
        'La barra de color te dice cómo está cada uno: roja si hay cierres ahora, naranja avisos, azul solo pasado; cuanto más larga, peor estado',
      ],
      [
        require('../assets/icons/icon-layers.png'),
        'Los chips de arriba filtran por año y por causa: solo contaminación, solo desprendimientos… también dentro del ranking',
      ],
      [
        require('../assets/icons/beach.png'),
        'Toca un municipio y verás su historial de incidencias: qué playa, cuándo y por qué — con el filtro que tengas activo',
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

  // Atrás hardware: dentro de una sección vuelve al índice; en el
  // índice devuelve false para que App cierre la guía entera
  useEffect(() => {
    const sub = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (topic) {
          setTopic(null);
          return true;
        }
        return false;
      },
    );
    return () => sub.remove();
  }, [topic]);

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
                style={({ pressed }) => [
                  styles.headerBack,
                  pressed && styles.pressFx,
                ]}
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
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={({ pressed }) => [
                styles.closeBtn,
                pressed && styles.pressFx,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Cerrar la guía"
            >
              <Text style={styles.close}>✕</Text>
            </Pressable>
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
                      style={({ pressed }) => [
                        styles.topicRow,
                        pressed && styles.pressFx,
                      ]}
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
                      style={({ pressed }) => [
                        styles.topicRow,
                        pressed && styles.pressFx,
                      ]}
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
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
    marginLeft: 12,
  },
  close: {
    fontSize: 20,
    fontFamily: fonts.extrabold,
    color: 'rgba(255,255,255,0.9)',
  },
  title: {
    fontSize: 20,
    // Android corta el acento de la Í sin aire suficiente — gotcha
    // Nunito conocido (mismo que la leyenda)
    lineHeight: 26,
    fontFamily: fonts.extrabold,
    color: '#fff',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 4,
    lineHeight: 20,
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
});

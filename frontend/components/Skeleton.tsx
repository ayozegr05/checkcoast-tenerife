import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { colors } from '../lib/theme';

// Caja "sea-glass" con una banda de brillo que la barre en loop:
// placeholder con la forma del contenido que está por llegar
export default function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (width <= 0) return;
    translateX.setValue(-width);
    const loop = Animated.loop(
      Animated.timing(translateX, {
        toValue: width,
        duration: 1100,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [width, translateX]);

  return (
    <View
      style={[styles.box, style]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {width > 0 && (
        <Animated.View
          style={[styles.shine, { transform: [{ translateX }] }]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.skeleton,
    borderRadius: 6,
    overflow: 'hidden',
  },
  shine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '45%',
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
});

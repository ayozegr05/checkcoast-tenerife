import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Alert, Platform } from 'react-native';

import { registerDevice } from './api';

// Con la app en primer plano: banner + bandeja + sonido
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Pide permiso, obtiene el Expo push token y lo registra en el backend.
// Silencioso ante cualquier fallo: la app funciona igual sin push.
export async function setupPushNotifications(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('alerts', {
      name: 'Alertas de playas',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#0288d1',
    });
  }
  if (!Device.isDevice) return; // sin push en emulador/Expo Go

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') return;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as
    | string
    | undefined;
  if (!projectId) {
    Alert.alert('Push debug', 'projectId no encontrado en expoConfig');
    return;
  }

  try {
    const token = (
      await Notifications.getExpoPushTokenAsync({ projectId })
    ).data;
    await registerDevice(token, Platform.OS);
  } catch (e) {
    // DEBUG temporal: mostrar por qué falla el registro
    Alert.alert('Push debug', String(e));
  }
}

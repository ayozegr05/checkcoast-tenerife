// Firebase App Check en modo MONITOR (ROADMAP 10.12): adjunta el
// token de integridad en los POST de escritura (/devices,
// /client-events). El backend verifica pero nunca rechaza.
//
// Degradaciones esperadas → todas devuelven {} y el backend las
// cuenta como `missing`, nunca rompen la petición:
//   · dev-client antiguo / Expo Go: módulo nativo ausente
//   · APK sideloaded: Play Integrity solo attesta apps distribuidas
//     por Play Store — getToken rechaza hasta la publicación
//   · emulador/dev-client: usa provider `debug` (token a registrar
//     en la consola Firebase o vía FIREBASE_APP_CHECK_DEBUG_TOKEN)
import type { AppCheck } from '@react-native-firebase/app-check';

let instancePromise: Promise<AppCheck | null> | null = null;

function initialize(): Promise<AppCheck | null> {
  instancePromise ??= (async () => {
    try {
      const { getApp } = await import('@react-native-firebase/app');
      const { initializeAppCheck } = await import(
        '@react-native-firebase/app-check'
      );
      return await initializeAppCheck(getApp(), {
        provider: {
          providerOptions: {
            android: { provider: __DEV__ ? 'debug' : 'playIntegrity' },
          },
        },
        isTokenAutoRefreshEnabled: true,
      });
    } catch {
      return null;
    }
  })();
  return instancePromise;
}

// Header { X-Firebase-AppCheck } o {} si el token no está disponible
export async function appCheckHeaders(): Promise<Record<string, string>> {
  try {
    const instance = await initialize();
    if (!instance) return {};
    const { getToken } = await import('@react-native-firebase/app-check');
    const { token } = await getToken(instance, false);
    return token ? { 'X-Firebase-AppCheck': token } : {};
  } catch {
    return {};
  }
}

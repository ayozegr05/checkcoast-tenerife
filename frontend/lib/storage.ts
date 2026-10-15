import { NativeModules, TurboModuleRegistry } from 'react-native';

// AsyncStorage es nativo: si el build instalado no lleva el módulo ni
// se toca — las flags de "ya visto" no persisten y los hints salen en
// cada arranque, como antes. Con New Architecture el módulo vive como
// TurboModule (NativeModules puede no listarlo), así que se consultan
// ambos registros.
export const storage: {
  getItem: (k: string) => Promise<string | null>;
  setItem: (k: string, v: string) => Promise<void>;
} | null =
  (NativeModules.RNCAsyncStorage ?? TurboModuleRegistry.get('RNCAsyncStorage'))
    ? require('@react-native-async-storage/async-storage').default
    : null;

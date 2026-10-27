import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text, View } from 'react-native';

// Gate nativo (bug e2e oct-2026): el APK dev-client-e2e no traía
// ExpoLinearGradient y montar el scrim del "Ver más" lanzaba →
// RedBox tapaba la ficha y Maestro no encontraba "Cerrar ficha" ni
// el picker de zonas. SafeGradient debe pintar el gradiente cuando
// el binario lo trae y no renderizar nada cuando no. El flag se lee
// dentro del factory del mock (jest solo permite vars `mock*`).
let mockNativePresent = true;
jest.mock('expo-modules-core', () => ({
  ...(jest.requireActual('expo-modules-core') as Record<string, unknown>),
  requireOptionalNativeModule: () => mockNativePresent,
}));

// El gate se evalúa al cargar SafeGradient, así que cada caso
// re-importa el módulo tras fijar el flag
// eslint-disable-next-line @typescript-eslint/no-require-imports
const load = () => require('../../components/SafeGradient').SafeGradient;

const props = {
  colors: ['rgba(255,255,255,0)', 'rgba(255,255,255,0.97)'],
  locations: [0, 0.8],
};

describe('<SafeGradient />', () => {
  it('con el módulo presente pinta el view manager nativo', async () => {
    mockNativePresent = true;
    jest.resetModules();
    const SafeGradient = load();
    const { toJSON } = await render(<SafeGradient {...props} />);
    expect(JSON.stringify(toJSON())).toContain(
      'ViewManagerAdapter_ExpoLinearGradient',
    );
  });

  it('sin módulo nativo renderiza null y no lanza', async () => {
    mockNativePresent = false;
    jest.resetModules();
    const SafeGradient = load();
    const { toJSON } = await render(
      <View>
        <SafeGradient {...props} />
        <Text>Ver más</Text>
      </View>,
    );
    // El árbol existe (no petó) y solo contiene el texto
    expect(screen.getByText('Ver más')).toBeTruthy();
    expect(JSON.stringify(toJSON())).not.toContain('LinearGradient');
  });
});

// LinearGradient es un view manager NATIVO: en dev-clients sin el
// módulo compilado (APKs viejos, el dev-client-e2e del CI mientras no
// se regenere) montar <LinearGradient> lanza y RedBox tapa la app.
// Gate con requireOptionalNativeModule (patrón AGENTS.md: módulos
// nativos nuevos → gate nativo, no solo import() lazy): si el
// binario no lo trae ni se evalúa el JS del paquete — el require
// condicional evita que su index registre el view manager al vuelo.
// El scrim es cosmético: sin gradiente no se pinta, pero el "Ver más"
// y el contenido siguen funcionando.
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { LinearGradientProps } from 'expo-linear-gradient';
import type { ComponentType } from 'react';

const LinearGradient: ComponentType<LinearGradientProps> | null =
  requireOptionalNativeModule('ExpoLinearGradient')
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('expo-linear-gradient') as typeof import('expo-linear-gradient'))
        .LinearGradient
    : null;

export function SafeGradient(props: LinearGradientProps) {
  if (!LinearGradient) return null;
  return <LinearGradient {...props} />;
}

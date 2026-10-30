import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import React from 'react';

import MuniMiniMap from '../../components/stats/MuniMiniMap';
import { muniMapImage, muniMapSlug } from '../../lib/muniMap';

describe('muniMapSlug', () => {
  it('normaliza acentos y alias del censo al dataset', () => {
    expect(muniMapSlug('San Cristóbal de La Laguna')).toBe('la-laguna');
    expect(muniMapSlug('Güímar')).toBe('guimar');
    expect(muniMapSlug('Guía de Isora')).toBe('guia-de-isora');
    expect(muniMapSlug('El Rosario')).toBe('el-rosario');
    expect(muniMapSlug(null)).toBeNull();
  });

  it('resuelve imagen solo para municipios conocidos', () => {
    expect(muniMapImage('El Rosario')).toBeTruthy();
    expect(muniMapImage('Narnia')).toBeNull();
  });
});

describe('<MuniMiniMap />', () => {
  it('pinta la silueta con el municipio resaltado', async () => {
    await render(<MuniMiniMap name="El Rosario" />);
    expect(
      screen.getByLabelText('Mapa de Tenerife con El Rosario resaltado'),
    ).toBeTruthy();
  });

  it('municipio desconocido: no pinta nada', async () => {
    await render(<MuniMiniMap name="Atlántida" />);
    expect(screen.queryByLabelText(/resaltado/)).toBeNull();
  });
});

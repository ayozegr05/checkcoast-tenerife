import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import type { TextInput } from 'react-native';

import MapSearch from '../../components/map/MapSearch';
import type { SearchItem } from '../../lib/mapData';

const results: SearchItem[] = [
  { key: 'b1', kind: 'beach', label: 'Playa Jardín', sub: 'Puerto de la Cruz' },
  { key: 'm1', kind: 'municipality', label: 'Arona', sub: 'Municipio' },
];

describe('<MapSearch />', () => {
  it('propaga lo escrito y el resultado elegido', async () => {
    const onChangeQuery = jest.fn();
    const onPick = jest.fn();
    await render(
      <MapSearch
        query="pla"
        onChangeQuery={onChangeQuery}
        results={results}
        onPick={onPick}
        inputRef={React.createRef<TextInput>()}
      />,
    );
    await fireEvent.changeText(
      screen.getByLabelText('Buscar playa, emisario o municipio'),
      'playa j',
    );
    expect(onChangeQuery).toHaveBeenCalledWith('playa j');

    await fireEvent.press(
      screen.getByRole('button', { name: 'Arona, Municipio' }),
    );
    expect(onPick).toHaveBeenCalledWith(results[1]);
  });

  it('sin resultados no pinta la lista', async () => {
    await render(
      <MapSearch
        query=""
        onChangeQuery={jest.fn()}
        results={[]}
        onPick={jest.fn()}
        inputRef={React.createRef<TextInput>()}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});

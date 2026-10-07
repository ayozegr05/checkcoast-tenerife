import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Linking } from 'react-native';

import NewsGroupList from '../../components/beach/NewsGroupList';
import { groupNewsItems } from '../../lib/news';
import { news } from '../../test/fixtures';

describe('<NewsGroupList />', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const items = [
    news({ id: 1, title: 'Cierran Playa Jardín', source: 'El Día' }),
    news({
      id: 2,
      title: 'Reabren Playa Jardín',
      event_type: 'reopening',
      source: null,
      published_at: '2026-07-05T08:00:00Z',
      url: 'https://example.org/reapertura',
    }),
  ];

  it('agrupa por fase con fuente y fecha', async () => {
    await render(<NewsGroupList groups={groupNewsItems(items)} />);
    const labels = groupNewsItems(items).map((g) => g.label);
    for (const l of labels) expect(screen.getByText(l)).toBeTruthy();
    expect(screen.getByText('El Día · 02/07/2026')).toBeTruthy();
    // Sin medio: solo la fecha
    expect(screen.getByText('05/07/2026')).toBeTruthy();
  });

  it('cada titular es un enlace que abre la noticia', async () => {
    const open = jest
      .spyOn(Linking, 'openURL')
      .mockResolvedValue(undefined as never);
    await render(<NewsGroupList groups={groupNewsItems(items)} />);
    await fireEvent.press(
      screen.getByRole('link', { name: 'Noticia: Reabren Playa Jardín' }),
    );
    expect(open).toHaveBeenCalledWith('https://example.org/reapertura');
  });
});

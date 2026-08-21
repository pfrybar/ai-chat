import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('App', () => {
  it('introduces the chat playground', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Experiment with chat APIs.' }),
    ).toBeInTheDocument();
  });
});

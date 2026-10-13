import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

const failure = vi.hoisted(() => ({ active: true }));
vi.mock('./GameShell', () => ({
  GameShell: () => {
    if (failure.active) throw new Error('malformed remote room');
    return <h1>Recovered menu</h1>;
  },
}));

describe('root render recovery', () => {
  it('shows recovery controls after a render error and remounts the menu', () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<App />);
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
      failure.active = false;
      fireEvent.click(screen.getByRole('button', { name: 'Back to Menu' }));
      expect(screen.getByRole('heading', { name: 'Recovered menu' })).toBeInTheDocument();
    } finally {
      report.mockRestore();
      failure.active = true;
    }
  });
});

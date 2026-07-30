import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppServices } from './servicesContext';
import { AppProviders } from './providers';
import { WorkbenchBootstrap } from './WorkbenchBootstrap';
import { App } from './App';

describe('App', () => {
  it('renders the project baseline', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'HCR Simulator' }),
    ).toBeInTheDocument();
  });

  it('shows an actionable Provider error state', async () => {
    const services: AppServices = {
      challengeProvider: {
        listChallenges: async () => {
          throw new Error('Provider offline');
        },
        getChallenge: async () => {
          throw new Error('Provider offline');
        },
      },
      scoreProvider: {
        score: async () => {
          throw new Error('Not used');
        },
      },
    };

    render(
      <AppProviders services={services}>
        <WorkbenchBootstrap />
      </AppProviders>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Provider offline',
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });
});

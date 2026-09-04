import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  recordingUsageProvider,
  unusedMatchProvider,
  unusedSessionProvider,
} from '../test/stubServices';
import type { AppServices } from './servicesContext';
import { AppProviders } from './providers';
import { WorkbenchBootstrap } from './WorkbenchBootstrap';
import { App } from './App';

describe('App', () => {
  it('requires an affirmative academic research choice before mounting the app', () => {
    localStorage.removeItem('hcr.research-preferences.v1');
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Academic research participation' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('HCR Simulator')).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Participate in the academic study' }),
    );
    expect(
      JSON.parse(
        localStorage.getItem('hcr.research-preferences.v1') ?? '{}',
      ),
    ).toEqual({
      programAndScores: true,
      language: true,
      utcOffset: true,
      decided: true,
    });
    expect(
      screen.getByRole('heading', { name: 'HCR Simulator' }),
    ).toBeInTheDocument();
  });

  it('defaults the first-visit detailed study settings to coarse language and UTC offset', () => {
    localStorage.removeItem('hcr.research-preferences.v1');
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'More settings' }));

    expect(
      screen.getByRole('checkbox', { name: /Primary language/ }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /UTC offset/ }),
    ).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(
      JSON.parse(
        localStorage.getItem('hcr.research-preferences.v1') ?? '{}',
      ),
    ).toEqual({
      programAndScores: true,
      language: true,
      utcOffset: true,
      decided: true,
    });
  });

  it('opens on the menu with both modes offered', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'HCR Simulator' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Solo Practice/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Versus Round/ }),
    ).toBeInTheDocument();
  });

  it('says plainly that an unconfigured build plays offline', () => {
    // The distinction matters: an offline round is scored by this browser, so
    // it is practice, not a result. A player must be able to tell which they
    // are in without reading the source.
    render(<App />);

    expect(screen.getByText('OFFLINE · PRACTICE')).toBeInTheDocument();
  });

  it('reaches the versus setup screen from the menu', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /Versus Round/ }));

    expect(
      screen.getByRole('heading', { name: 'Same challenge. Same clock.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Room/ })).toBeEnabled();
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
      matchProvider: unusedMatchProvider(),
      sessionProvider: unusedSessionProvider(),
      usageProvider: recordingUsageProvider(),
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

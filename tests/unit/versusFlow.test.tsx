import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '../../src/app/providers';
import type { AppServices } from '../../src/app/servicesContext';
import { VersusRound } from '../../src/features/match/VersusRound';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import { LocalMatchProvider } from '../../src/services/local/LocalMatchProvider';
import { LocalSessionProvider } from '../../src/services/local/LocalSessionProvider';
import { LocalScoreProvider } from '../../src/services/local/LocalScoreProvider';

const IDENTITY = { playerId: 'u-test', displayName: 'Tester' };

function renderVersus() {
  const challengeProvider = new LocalChallengeProvider();
  const services: AppServices = {
    challengeProvider,
    scoreProvider: new LocalScoreProvider(),
    matchProvider: new LocalMatchProvider(challengeProvider),
    sessionProvider: new LocalSessionProvider(),
  };

  return render(
    <AppProviders services={services}>
      <VersusRound identity={IDENTITY} onExit={() => {}} />
    </AppProviders>,
  );
}

/**
 * The versus flow up to the point the 3D stage would mount.
 *
 * Stopping at the lobby is deliberate: everything past it is the existing
 * workbench, already covered, and rendering it here would drag WebGL into a
 * jsdom test for no extra assurance.
 */
describe('versus flow', () => {
  it('opens on setup, offering both host and join', () => {
    renderVersus();

    expect(screen.getByRole('button', { name: /Open Room/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Join Room/ })).toBeDisabled();
  });

  it('states that an offline round is practice against bots', () => {
    renderVersus();

    expect(screen.getByText(/Offline practice/)).toBeInTheDocument();
    expect(screen.getByText(/scripted bots/)).toBeInTheDocument();
  });

  it('hosting opens a lobby with a shareable code and a full roster', async () => {
    renderVersus();

    fireEvent.click(screen.getByRole('button', { name: /Open Room/ }));

    const code = await screen.findByTestId('room-code');
    expect(code.textContent).toMatch(/^[A-Z2-9]{6}$/);

    // The host plus three practice bots.
    expect(screen.getByText('4 / 16')).toBeInTheDocument();
    expect(screen.getByText('Tester')).toBeInTheDocument();
    expect(screen.getAllByText('BOT')).toHaveLength(3);
  });

  it('never shows a score in the lobby', async () => {
    renderVersus();
    fireEvent.click(screen.getByRole('button', { name: /Open Room/ }));
    await screen.findByTestId('room-code');

    // No official score exists to anyone before the round closes; the lobby is
    // where a leak would be easiest to introduce by accident.
    expect(screen.getByText(/Standings stay hidden/)).toBeInTheDocument();
    expect(screen.queryByTestId('final-score')).not.toBeInTheDocument();
  });

  it('reports an unknown room code rather than failing silently', async () => {
    renderVersus();

    fireEvent.change(screen.getByLabelText('Room code'), {
      target: { value: 'ZZZZ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Join Room/ }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/No practice round/),
    );
  });
});

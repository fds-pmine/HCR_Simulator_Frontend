import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../src/app/providers';
import type { AppServices } from '../../src/app/servicesContext';
import { VersusRound } from '../../src/features/match/VersusRound';
import { MatchScoreboard } from '../../src/features/match/MatchScoreboard';
import type { MatchResultRow, MatchResults } from '../../src/types/match';
import { DEFAULT_MATCH_CONFIG } from '../../src/types/match';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import { LocalMatchProvider } from '../../src/services/local/LocalMatchProvider';
import { LocalUsageProvider } from '../../src/services/local/LocalUsageProvider';
import { LocalSessionProvider } from '../../src/services/local/LocalSessionProvider';
import { LocalScoreProvider } from '../../src/services/local/LocalScoreProvider';

const IDENTITY = { playerId: 'u-test', displayName: 'Tester' };

function stubbedServices(): AppServices {
  const challengeProvider = new LocalChallengeProvider();
  return {
    challengeProvider,
    scoreProvider: new LocalScoreProvider(),
    matchProvider: new LocalMatchProvider(challengeProvider),
    sessionProvider: new LocalSessionProvider(),
    usageProvider: new LocalUsageProvider(),
  };
}

function renderVersus() {
  const challengeProvider = new LocalChallengeProvider();
  const services: AppServices = {
    challengeProvider,
    scoreProvider: new LocalScoreProvider(),
    matchProvider: new LocalMatchProvider(challengeProvider),
    sessionProvider: new LocalSessionProvider(),
    usageProvider: new LocalUsageProvider(),
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

    // The host plus three practice bots, against a capacity sized for a class.
    expect(
      screen.getByText(`4 / ${DEFAULT_MATCH_CONFIG.maxPlayers}`),
    ).toBeInTheDocument();
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

// ---------------------------------------------------------------------------
// The scoreboard, rendered directly — the round that produces it needs WebGL.
// ---------------------------------------------------------------------------

function row(
  playerId: string,
  rank: number,
  completionScore: number,
): MatchResultRow {
  return {
    rank,
    playerId,
    displayName: playerId,
    completionScore,
    finalScore: completionScore,
    metrics: { sourceBlockCount: 2, executedCommandCount: 2, estimatedDurationMs: 900 },
    submissionId: `sub-${playerId}`,
    serverReceivedAt: 1,
  };
}

const RESULTS: MatchResults = {
  matchId: 'ABC234',
  challengeId: 'neat-short-cap',
  challengeVersion: 1,
  rankBy: 'completion',
  rows: [row('u-test', 1, 90), row('rival', 2, 40)],
};

describe('the scoreboard between rounds', () => {
  const board = (extra: Partial<Parameters<typeof MatchScoreboard>[0]> = {}) =>
    render(
      <AppProviders services={stubbed()}>
        <MatchScoreboard
          results={RESULTS}
          identity={IDENTITY}
          kind="online"
          season={[]}
          crews={{}}
          classTarget={0}
          onPlayAgain={() => {}}
          onExit={() => {}}
          {...extra}
        />
      </AppProviders>,
    );

  function stubbed(): AppServices {
    return stubbedServices();
  }



  it('offers another round in the same room', () => {
    const onNextRound = vi.fn();
    board({ onNextRound });

    fireEvent.click(screen.getByTestId('next-round'));
    expect(onNextRound).toHaveBeenCalledOnce();
    // Leaving is still available; it is just no longer the loud one.
    expect(screen.getByTestId('play-again')).toBeInTheDocument();
  });

  it('falls back to leaving when a round cannot be reopened', () => {
    board();

    expect(screen.queryByTestId('next-round')).not.toBeInTheDocument();
    expect(screen.getByTestId('play-again')).toBeInTheDocument();
  });

  it('holds the winner back until the reveal reaches first place', async () => {
    // Printing "X wins" over three blank podium rows is a spoiler with an
    // animation underneath it.
    board({ onNextRound: () => {} });

    expect(screen.getByRole('heading', { name: /Counting down the field/ })).toBeInTheDocument();
    expect(screen.queryByTestId('your-standing')).not.toBeInTheDocument();

    await waitFor(
      () => expect(screen.getByTestId('your-standing')).toBeInTheDocument(),
      { timeout: 5_000 },
    );
    expect(screen.getByRole('heading', { name: /You win/ })).toBeInTheDocument();
  });

  it('does not offer another round while one is being opened', () => {
    board({ onNextRound: () => {}, busy: true });

    expect(screen.getByTestId('next-round')).toBeDisabled();
  });
});

describe('the endless loop on the scoreboard', () => {
  const board = (extra: Partial<Parameters<typeof MatchScoreboard>[0]> = {}) =>
    render(
      <AppProviders services={stubbedServices()}>
        <MatchScoreboard
          results={RESULTS}
          identity={IDENTITY}
          kind="online"
          season={[]}
          crews={{}}
          classTarget={0}
          onPlayAgain={() => {}}
          onExit={() => {}}
          {...extra}
        />
      </AppProviders>,
    );

  it('counts down for everybody', () => {
    board({ autoAdvanceMs: 20_000 });
    expect(screen.getByTestId('auto-advance')).toHaveTextContent(/Next round in/);
  });

  it('offers the stop only to the machine driving the loop', () => {
    // A control that stopped nothing would be the lie the crew buttons told.
    board({ autoAdvanceMs: 20_000 });
    expect(screen.queryByTestId('stop-loop')).not.toBeInTheDocument();

    board({ autoAdvanceMs: 20_000, onStopLoop: () => {} });
    expect(screen.getAllByTestId('stop-loop')).toHaveLength(1);
  });

  it('says nothing at all when the loop is off', () => {
    board();
    expect(screen.queryByTestId('auto-advance')).not.toBeInTheDocument();
  });
});

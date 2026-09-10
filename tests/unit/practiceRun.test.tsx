import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../src/app/providers';
import type { AppServices } from '../../src/app/servicesContext';
import { PracticeRun } from '../../src/features/practice/PracticeRun';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import { LocalUsageProvider } from '../../src/services/local/LocalUsageProvider';
import { LocalScoreProvider } from '../../src/services/local/LocalScoreProvider';
import type { SessionProvider } from '../../src/services/contracts';
import { unusedMatchProvider } from '../../src/test/stubServices';

const workbenchProps = vi.hoisted(() => vi.fn());

vi.mock('../../src/components/layout/SimulationWorkbench', () => ({
  SimulationWorkbench: (props: Record<string, unknown>) => {
    workbenchProps(props);
    return <div>Practice workbench</div>;
  },
}));

describe('Practice CAT bootstrap', () => {
  it('opens a servo-scoped session before loading its first signed item', async () => {
    const start = vi.fn<SessionProvider['start']>().mockResolvedValue({
      sessionId: 'session-1',
      theta: 0,
      responseCount: 0,
      state: 'active',
    });
    const next = vi.fn<SessionProvider['next']>().mockResolvedValue({
      itemRef: 'signed-item',
      challengeId: 'neat-short-cap',
      challengeVersion: 7,
    });
    const sessionProvider: SessionProvider = {
      kind: 'adaptive',
      start,
      next,
      submit: vi.fn(),
      respond: vi.fn(),
      finalize: vi.fn(),
    };
    const services: AppServices = {
      challengeProvider: new LocalChallengeProvider(),
      scoreProvider: new LocalScoreProvider(),
      matchProvider: unusedMatchProvider(),
      sessionProvider,
      usageProvider: new LocalUsageProvider(),
    };

    render(
      <AppProviders services={services}>
        <PracticeRun onExit={() => {}} />
      </AppProviders>,
    );

    expect(await screen.findByText('Practice workbench')).toBeInTheDocument();
    expect(start).toHaveBeenCalledWith({
      programmingMode: 'servo',
      practice: false,
    });
    expect(next).toHaveBeenCalledWith('session-1');
    await waitFor(() =>
      expect(workbenchProps).toHaveBeenLastCalledWith(
        expect.objectContaining({
          availableProgrammingModes: ['servo'],
          cutterGridPlannerMode: 'remote',
          challengeVersion: 7,
        }),
      ),
    );
  });
});

describe('Endless practice', () => {
  /** A session provider whose bank runs dry after `perSession` items. */
  function exhaustibleProvider(perSession: number) {
    let served = 0;
    const start = vi.fn<SessionProvider['start']>().mockImplementation(() => {
      served = 0;
      return Promise.resolve({
        sessionId: `session-${start.mock.calls.length}`,
        theta: 0,
        responseCount: 0,
        state: 'active' as const,
      });
    });
    const next = vi.fn<SessionProvider['next']>().mockImplementation(() => {
      served += 1;
      if (served > perSession) {
        return Promise.reject(new Error('No further challenges.'));
      }
      return Promise.resolve({
        itemRef: 'signed-item',
        challengeId: 'neat-short-cap',
        challengeVersion: 7,
      });
    });
    const sessionProvider: SessionProvider = {
      kind: 'adaptive',
      start,
      next,
      submit: vi.fn(),
      respond: vi.fn(),
      finalize: vi.fn(),
    };
    return { sessionProvider, start };
  }

  function mount(sessionProvider: SessionProvider) {
    const services: AppServices = {
      challengeProvider: new LocalChallengeProvider(),
      scoreProvider: new LocalScoreProvider(),
      matchProvider: unusedMatchProvider(),
      sessionProvider,
      usageProvider: new LocalUsageProvider(),
    };
    return render(
      <AppProviders services={services}>
        <PracticeRun onExit={() => {}} />
      </AppProviders>,
    );
  }

  it('opens a fresh session when the loop is running, and stops when told', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // A bank that runs dry immediately, so the finished screen arrives without
      // driving a whole session.
      const { sessionProvider, start } = exhaustibleProvider(0);
      mount(sessionProvider);

      const keepGoing = await screen.findByTestId('practice-endless-start');
      expect(start).toHaveBeenCalledTimes(1);

      fireEvent.click(keepGoing);
      await waitFor(() => expect(start).toHaveBeenCalledTimes(2));

      // The loop is now armed: the finished screen shows a countdown and a stop.
      await screen.findByTestId('practice-endless-loop');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_500);
      });
      await waitFor(() => expect(start).toHaveBeenCalledTimes(3));

      // Stopping leaves the totals on screen rather than opening anything else.
      fireEvent.click(await screen.findByTestId('practice-endless-stop'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(start).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks for a practice session once the loop is running', async () => {
    const { sessionProvider, start } = exhaustibleProvider(0);
    mount(sessionProvider);

    // The opening session measures: it may only serve calibrated items.
    await waitFor(() =>
      expect(start).toHaveBeenLastCalledWith(
        expect.objectContaining({ practice: false }),
      ),
    );

    fireEvent.click(await screen.findByTestId('practice-endless-start'));

    // Continuations do not. A practice session may serve provisional items and
    // synthesise new ones, which is what stops the loop running out — and is
    // exactly why the first session must not be one.
    await waitFor(() =>
      expect(start).toHaveBeenLastCalledWith(
        expect.objectContaining({ practice: true }),
      ),
    );
  });

  it('switches the session between Servo and Cutter Grid', async () => {
    const { sessionProvider, start } = exhaustibleProvider(0);
    mount(sessionProvider);

    await screen.findByTestId('practice-switch-mode');
    expect(start).toHaveBeenLastCalledWith({
      programmingMode: 'servo',
      practice: false,
    });

    // A session estimates one ability, so the mode is pinned per session and a
    // switch means a new one rather than a mid-session change.
    fireEvent.click(screen.getByTestId('practice-switch-mode'));
    await waitFor(() =>
      expect(start).toHaveBeenLastCalledWith({
        programmingMode: 'cutter-grid',
        practice: false,
      }),
    );
  });
});

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

/**
 * The engine, stubbed for the one test that submits.
 *
 * That test is about what leaves the browser — the route, an empty servo
 * program, no trajectory — and running a real plan through a real engine to
 * prove it would be testing the engine instead.
 */
vi.mock('../../src/features/simulation/headlessRun', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runCutterGridHeadless: vi.fn().mockResolvedValue(undefined),
}));

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

    // Solo asks which editor before it measures anything: a session is pinned
    // to one, so it cannot be a default the learner discovers afterwards.
    fireEvent.click(await screen.findByTestId('practice-mode-servo'));

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
    const rendered = render(
      <AppProviders services={services}>
        <PracticeRun onExit={() => {}} />
      </AppProviders>,
    );
    return rendered;
  }

  /** Mount, then answer the editor question the way a learner would. */
  async function open(
    sessionProvider: SessionProvider,
    mode: 'servo' | 'cutter-grid' = 'servo',
  ) {
    const rendered = mount(sessionProvider);
    fireEvent.click(await screen.findByTestId(`practice-mode-${mode}`));
    return rendered;
  }

  it('opens a fresh session when the loop is running, and stops when told', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // A bank that runs dry immediately, so the finished screen arrives without
      // driving a whole session.
      const { sessionProvider, start } = exhaustibleProvider(0);
      await open(sessionProvider);

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
    await open(sessionProvider);

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
    await open(sessionProvider);

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

describe('a Cutter Grid practice session', () => {
  it('enters the route, and never a trajectory', async () => {
    const sessionProvider: SessionProvider = {
      kind: 'adaptive',
      start: vi.fn().mockResolvedValue({
        sessionId: 'grid-session',
        theta: 0,
        responseCount: 0,
        state: 'active',
      }),
      next: vi.fn().mockResolvedValue({
        itemRef: 'signed-item',
        challengeId: 'neat-short-cap',
        challengeVersion: 1,
      }),
      submit: vi.fn().mockResolvedValue(undefined),
      respond: vi.fn().mockResolvedValue({
        correct: true,
        rawScore: 1,
        theta: 0,
        standardError: 1,
        terminated: true,
        terminationReason: 'done',
      }),
      finalize: vi.fn(),
    };

    render(
      <AppProviders
        services={{
          challengeProvider: new LocalChallengeProvider(),
          scoreProvider: new LocalScoreProvider(),
          matchProvider: unusedMatchProvider(),
          sessionProvider,
          usageProvider: new LocalUsageProvider(),
        }}
      >
        <PracticeRun onExit={() => {}} />
      </AppProviders>,
    );

    fireEvent.click(await screen.findByTestId('practice-mode-cutter-grid'));
    await screen.findByText('Practice workbench');

    await waitFor(() =>
      expect(workbenchProps).toHaveBeenLastCalledWith(
        expect.objectContaining({
          // A session is pinned to one editor, so the workbench offers no
          // switch — and the route can now actually be entered.
          availableProgrammingModes: ['cutter-grid'],
        }),
      ),
    );

    const props = workbenchProps.mock.lastCall?.[0] as {
      match: { onSubmitCutterGrid: (entry: unknown) => void };
    };
    const route = {
      kind: 'cutter-grid',
      version: 1,
      plannerVersion: 'cutter-grid-compact-ptp-v4',
      nodes: [],
      sourceBlockCount: 4,
    };
    props.match.onSubmitCutterGrid({
      program: route,
      plan: { kind: 'cutter-grid-trajectory' },
      sourceBlockCount: 4,
    });

    await waitFor(() =>
      expect(sessionProvider.submit).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          cutterGridV4: route,
          // Empty, carrying the block count: a Cutter Grid entry has no joint
          // commands to replay.
          program: { nodes: [], sourceBlockCount: 4 },
        }),
      ),
    );
  });
});

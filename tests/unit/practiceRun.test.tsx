import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../src/app/providers';
import type { AppServices } from '../../src/app/servicesContext';
import { PracticeRun } from '../../src/features/practice/PracticeRun';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
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
    };

    render(
      <AppProviders services={services}>
        <PracticeRun onExit={() => {}} />
      </AppProviders>,
    );

    expect(await screen.findByText('Practice workbench')).toBeInTheDocument();
    expect(start).toHaveBeenCalledWith({ programmingMode: 'servo' });
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

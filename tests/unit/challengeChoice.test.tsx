import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../src/app/providers';
import type { AppServices } from '../../src/app/servicesContext';
import { MatchSetup } from '../../src/features/match/MatchSetup';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import { LocalMatchProvider } from '../../src/services/local/LocalMatchProvider';
import { LocalUsageProvider } from '../../src/services/local/LocalUsageProvider';
import { LocalSessionProvider } from '../../src/services/local/LocalSessionProvider';
import { LocalScoreProvider } from '../../src/services/local/LocalScoreProvider';
import type { ChallengeSummary } from '../../src/types/domain';

/** A catalog with more than one entry — the case that used to be unreachable. */
function servicesWith(summaries: ChallengeSummary[]): AppServices {
  const local = new LocalChallengeProvider();
  const challengeProvider = {
    listChallenges: async () => summaries,
    getChallenge: (id: string) => local.getChallenge(id),
  };
  return {
    challengeProvider,
    scoreProvider: new LocalScoreProvider(),
    matchProvider: new LocalMatchProvider(challengeProvider),
    sessionProvider: new LocalSessionProvider(),
    usageProvider: new LocalUsageProvider(),
  };
}

const CATALOG: ChallengeSummary[] = [
  { id: 'neat-short-cap', name: 'Neat Short Haircut', description: 'The authored one.' },
  { id: 'cap-trim-aaa', name: 'Cap Trim 50%', description: 'Generated.' },
  { id: 'cap-trim-bbb', name: 'Cap Trim 85%', description: 'Generated.' },
];

// Solo no longer picks: it runs an adaptive session, so the only place a
// challenge is chosen by hand is hosting a round.
describe('choosing a challenge', () => {
  it('versus lets the host pin the item instead of always taking the default', async () => {
    const onHost = vi.fn();
    render(
      <AppProviders services={servicesWith(CATALOG)}>
        <MatchSetup
          kind="online"
          busy={false}
          onHost={onHost}
          onJoin={() => {}}
          onBack={() => {}}
          onDismissError={() => {}}
        />
      </AppProviders>,
    );

    const select = await screen.findByLabelText('Challenge for this round');
    fireEvent.change(select, { target: { value: 'cap-trim-aaa' } });
    fireEvent.click(screen.getByRole('button', { name: /Open Room/ }));

    expect(onHost).toHaveBeenCalledWith(expect.any(Number), 'cap-trim-aaa');
  });

  it('versus still hosts when the catalog offers no choice', async () => {
    // One challenge, or a catalog that failed to load: hosting must not be
    // blocked by it — the server picks in that case.
    const onHost = vi.fn();
    render(
      <AppProviders services={servicesWith([CATALOG[0]])}>
        <MatchSetup
          kind="online"
          busy={false}
          onHost={onHost}
          onJoin={() => {}}
          onBack={() => {}}
          onDismissError={() => {}}
        />
      </AppProviders>,
    );

    await waitFor(() =>
      expect(screen.queryByLabelText('Challenge for this round')).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Open Room/ }));
    expect(onHost).toHaveBeenCalledWith(expect.any(Number), undefined);
  });
});

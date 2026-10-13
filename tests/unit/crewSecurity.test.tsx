import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { assignCrew, crewTotals, crewsFor, drawCrews } from '../../src/features/match/crews';
import { MatchLobby } from '../../src/features/match/MatchLobby';
import { LocalMatchProvider } from '../../src/services/local/LocalMatchProvider';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import { matchConfig, type MatchPlayer, type MatchResultRow } from '../../src/types/match';

const prototypeIds = ['__proto__', 'constructor', 'toString'];
const players: MatchPlayer[] = prototypeIds.map((playerId) => ({
  playerId, displayName: playerId, connected: true, submitted: false,
}));
const rows: MatchResultRow[] = prototypeIds.map((playerId, index) => ({
  playerId, displayName: playerId, rank: index + 1,
  completionScore: 50, finalScore: 50,
  metrics: { sourceBlockCount: 1, commandCount: 1, executedCommandCount: 1, estimatedDurationMs: 1 },
  submissionId: `submission-${index}`,
}));

describe('crew maps with prototype-key player ids', () => {
  it('keeps drawn and assigned maps free of inherited player entries', () => {
    expect(Object.getPrototypeOf(drawCrews([], 'ROOM'))).toBeNull();
    const drawn = drawCrews(prototypeIds, 'ROOM', 3);
    expect(Object.getPrototypeOf(drawn)).toBeNull();
    expect(Object.keys(drawn)).toHaveLength(3);
    expect(crewTotals(rows, drawn, 'completion')).toHaveLength(3);

    const assigned = crewsFor([{ ...players[0], crew: 'A' }, players[1], players[2]], 'ROOM');
    expect(Object.getPrototypeOf(assigned)).toBeNull();
    expect(crewTotals(rows, assigned, 'completion')).toEqual([
      { crew: 'A', total: 50, members: 1, submitted: 1, scores: [50] },
    ]);
  });

  it('treats inherited keys on ordinary caller maps as unassigned', () => {
    expect(crewTotals(rows, {}, 'completion')).toEqual([]);
    for (const playerId of prototypeIds) {
      const assigned = assignCrew({}, playerId);
      expect(assigned[playerId]).toBe('A');
      expect(Object.getPrototypeOf(assigned)).toBeNull();
    }
  });

  it('renders prototype-key roster ids without treating prototype objects as crews', () => {
    render(
      <MatchLobby
        state={{ matchId: 'ROOM', phase: 'lobby', config: matchConfig(), players, serverTime: 0 }}
        identity={{ playerId: 'you', displayName: 'You' }} kind="practice"
        busy={false} crews={{}} format="crews" isHost={false}
        onAssignCrew={() => {}} onStart={() => {}} onLeave={() => {}}
      />,
    );
    for (const playerId of prototypeIds) {
      expect(screen.getByTestId(`crew-${playerId}`)).toHaveTextContent('+');
    }
  });

  it('does not assign inherited entries through the offline provider', async () => {
    const provider = new LocalMatchProvider(new LocalChallengeProvider());
    const room = await provider.createMatch(matchConfig());
    for (const playerId of prototypeIds) {
      provider.setPlayer({ playerId, displayName: playerId });
      await provider.joinMatch(room.matchId);
    }
    const updated = await provider.setCrews(room.matchId, {});
    expect(updated.players.every((player) => player.crew === undefined)).toBe(true);
  });
});

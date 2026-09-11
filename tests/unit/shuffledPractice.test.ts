import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROUND_COUNTDOWN_MS } from '../../src/features/match/countdown';
import { runHeadless } from '../../src/features/simulation/headlessRun';
import { SimulationEngine } from '../../src/features/simulation/SimulationEngine';
import { LocalScoreProvider } from '../../src/services/local/LocalScoreProvider';
import { cutterGridAvailableForChallenge } from '../../src/features/cutter-grid/profileRegistry';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import { LocalMatchProvider } from '../../src/services/local/LocalMatchProvider';
import { LocalSessionProvider } from '../../src/services/local/LocalSessionProvider';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import { LESSONS } from '../../src/data/challenges/lessons';
import { matchConfig } from '../../src/types/match';
import type {
  CompiledProgram,
  RobotCommand,
} from '../../src/features/blockly/programTypes';
import type { JointId } from '../../src/types/domain';

afterEach(() => {
  vi.useRealTimers();
});

const CATALOG_SIZE = LESSONS.length + 1;

/** Walk a whole offline practice session and report the ids it served. */
async function playThrough(session: LocalSessionProvider): Promise<string[]> {
  const started = await session.start();
  const served: string[] = [];
  for (let index = 0; index < CATALOG_SIZE; index += 1) {
    const item = await session.next(started.sessionId);
    served.push(item.challengeId);
    await session.respond(started.sessionId, item.itemRef);
  }
  return served;
}

describe('solo practice order', () => {
  it('still serves every challenge exactly once', async () => {
    // Shuffling may reorder the catalog; it may not drop an item or deal one
    // twice, which would quietly shorten the session or waste a turn.
    const served = await playThrough(new LocalSessionProvider());

    expect(served).toHaveLength(CATALOG_SIZE);
    expect(new Set(served).size).toBe(CATALOG_SIZE);
    expect([...served].sort()).toEqual(
      [...LESSONS.map((lesson) => lesson.id), DEFAULT_CHALLENGE_ID].sort(),
    );
  });

  it('deals a different order to each session', async () => {
    // The point of the change: a room of thirty is not all on item 1 at once,
    // and running practice a second time is not the first run again.
    const session = new LocalSessionProvider();
    const orders = new Set<string>();
    for (let run = 0; run < 12; run += 1) {
      orders.add((await playThrough(session)).join(','));
    }

    // Twelve identical draws from 9! orders does not happen; a fixed sequence
    // is the only way this collapses to one.
    expect(orders.size).toBeGreaterThan(1);
  });

  it('runs out after the catalog rather than looping', async () => {
    const session = new LocalSessionProvider();
    const started = await session.start();
    for (let index = 0; index < CATALOG_SIZE; index += 1) {
      const item = await session.next(started.sessionId);
      await session.respond(started.sessionId, item.itemRef);
    }

    await expect(session.next(started.sessionId)).rejects.toThrow(
      /finished every challenge/,
    );
    const result = await session.finalize(started.sessionId);
    expect(result.totalItems).toBe(CATALOG_SIZE);
  });
});

describe('versus round challenges', () => {
  const provider = () => {
    const instance = new LocalMatchProvider(new LocalChallengeProvider());
    instance.setPlayer({ playerId: 'you', displayName: 'You' });
    return instance;
  };

  /** Start a round, read out the challenge it revealed, and let it close. */
  async function playRound(
    match: LocalMatchProvider,
    matchId: string,
  ): Promise<string> {
    await match.startMatch(matchId);
    const revealed = await match.getMatchChallenge(matchId);
    vi.advanceTimersByTime(ROUND_COUNTDOWN_MS + 61_000);
    const results = await match.getResults(matchId);
    expect(results.challengeId).toBe(revealed.challenge.id);
    return revealed.challenge.id;
  }

  it('opens unpinned rooms on different challenges', async () => {
    // Every unpinned room used to open on the head of the catalog, so a class
    // played the same haircut all afternoon whatever the host did.
    vi.useFakeTimers();
    const match = provider();
    const opened = new Set<string>();
    for (let room = 0; room < 12; room += 1) {
      const created = await match.createMatch(matchConfig({ durationMs: 60_000 }));
      await match.joinMatch(created.matchId);
      opened.add(await playRound(match, created.matchId));
    }

    expect(opened.size).toBeGreaterThan(1);
  });

  it('never repeats the challenge in the round straight after it', async () => {
    // Rounds come out of a shuffled bag rather than an independent roll, so
    // "again" is not merely unlikely between consecutive rounds — it cannot
    // happen, which is the case a player would read as broken shuffling.
    vi.useFakeTimers();
    const match = provider();
    const created = await match.createMatch(matchConfig({ durationMs: 60_000 }));
    await match.joinMatch(created.matchId);

    let previous = await playRound(match, created.matchId);
    for (let round = 0; round < CATALOG_SIZE * 2; round += 1) {
      await match.rematch(created.matchId);
      const current = await playRound(match, created.matchId);
      expect(current).not.toBe(previous);
      previous = current;
    }
  });

  it('keeps the challenge a host pinned, across rematches', async () => {
    // A host who named the item meant it: a class working one haircut for an
    // afternoon is a lesson plan, not a bug.
    vi.useFakeTimers();
    const match = provider();
    const created = await match.createMatch(
      matchConfig({
        durationMs: 60_000,
        challengeRef: { challengeId: DEFAULT_CHALLENGE_ID, version: 1 },
      }),
    );
    await match.joinMatch(created.matchId);

    expect(await playRound(match, created.matchId)).toBe(DEFAULT_CHALLENGE_ID);
    await match.rematch(created.matchId);
    expect(await playRound(match, created.matchId)).toBe(DEFAULT_CHALLENGE_ID);
  });

  it('redraws a Cutter Grid room only among challenges it can be played on', async () => {
    // The draw has to keep honouring the profile requirement on every round,
    // not only on the one the room was created with.
    vi.useFakeTimers();
    const challenges = new LocalChallengeProvider();
    const match = new LocalMatchProvider(challenges);
    match.setPlayer({ playerId: 'you', displayName: 'You' });
    const created = await match.createMatch(
      matchConfig({ durationMs: 60_000, programmingMode: 'cutter-grid' }),
    );
    await match.joinMatch(created.matchId);

    for (let round = 0; round < 4; round += 1) {
      if (round > 0) await match.rematch(created.matchId);
      const played = await playRound(match, created.matchId);
      expect(
        cutterGridAvailableForChallenge(await challenges.getChallenge(played)),
      ).toBe(true);
    }
  });
});


/**
 * The workbench end-to-end suite opens Solo Practice and works with whatever it
 * is dealt (`tests/e2e/workbench.spec.ts`). That was a fixed item and is now a
 * draw, so what the suite relies on has to be a property of *every* item rather
 * than of the one that used to come first: the same hair to cut, the same arm
 * to cut it with, and the same outcome from the two programs it seeds. If a
 * tenth challenge ever breaks that, this fails here — in a second — instead of
 * failing one run in ten of a browser suite nobody can reproduce.
 */
describe('every practice item is an interchangeable opener', () => {
  function compiledProgram(
    blocks: readonly { id: string; jointId: string; angleDeg: number }[],
  ): CompiledProgram {
    const commands: RobotCommand[] = blocks.map((block) => ({
      type: 'set-joint-angle',
      jointId: block.jointId as JointId,
      angleDeg: block.angleDeg,
      sourceBlockId: block.id,
    }));
    return {
      program: { nodes: commands, sourceBlockCount: commands.length },
      runtimeCommands: commands,
      executedCommandCount: 0,
    };
  }

  /** The e2e suite's long program: four joints, no contact with the head. */
  const LONG_PROGRAM = [
    { id: 'long-base-out', jointId: 'baseYaw', angleDeg: 30 },
    { id: 'long-base-back', jointId: 'baseYaw', angleDeg: 150 },
    { id: 'long-shoulder', jointId: 'shoulder', angleDeg: 150 },
    { id: 'long-elbow', jointId: 'elbow', angleDeg: 17.5 },
  ];

  /** The e2e suite's collision: rolling the shoulder to its limit hits the head. */
  const COLLIDING_PROGRAM = [
    { id: 'reckless-roll', jointId: 'shoulderRoll', angleDeg: -45 },
  ];

  it('starts from the same hair and the same arm, whichever is dealt', async () => {
    const provider = new LocalChallengeProvider();
    const summaries = await provider.listChallenges();
    expect(summaries).toHaveLength(CATALOG_SIZE);

    for (const summary of summaries) {
      const challenge = await provider.getChallenge(summary.id);
      expect(challenge.initialHair.voxels.size).toBe(241);
      expect(challenge.robotConfig.joints.map((joint) => joint.id)).toEqual([
        'baseYaw',
        'shoulderRoll',
        'shoulder',
        'elbow',
        'wrist',
      ]);
    }
  });

  it('gives the e2e suite the same two outcomes, whichever is dealt', async () => {
    const provider = new LocalChallengeProvider();
    for (const summary of await provider.listChallenges()) {
      const challenge = await provider.getChallenge(summary.id);

      const long = new SimulationEngine(challenge, new LocalScoreProvider());
      const scored = await runHeadless(long, compiledProgram(LONG_PROGRAM));
      expect(long.getSnapshot().status, summary.id).toBe('completed');
      expect(long.getSnapshot().metrics.executedCommandCount, summary.id).toBe(4);
      expect(scored, summary.id).toBeDefined();

      const crash = new SimulationEngine(challenge, new LocalScoreProvider());
      const unscored = await runHeadless(crash, compiledProgram(COLLIDING_PROGRAM));
      expect(crash.getSnapshot().status, summary.id).toBe('error');
      expect(crash.getSnapshot().metrics.executedCommandCount, summary.id).toBe(0);
      // A halted run is not scored at all, which is what the e2e asserts by the
      // absence of the score panel.
      expect(unscored, summary.id).toBeUndefined();
    }
  });
});

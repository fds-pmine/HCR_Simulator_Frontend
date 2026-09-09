import type { MatchPlayer, MatchResultRow, MatchResults } from '../../types/match';

/**
 * Crews: small teams inside a round.
 *
 * The server ranks individuals and always will — a crew is a sum over rows it
 * already ranked, not a different scoring rule, and every individual standing
 * stays visible next to it. What changes is not the arithmetic but what a
 * student does with a spare minute: when the crew total is what wins, the
 * fastest programmer in the crew has a reason to lean over and explain the
 * procedure to the slowest, which is the one behaviour a lecture cannot force.
 *
 * A crew total sums rather than averages, so a crew improves by getting its
 * quietest member to submit at all.
 */
export type CrewId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export const CREWS: readonly CrewId[] = ['A', 'B', 'C', 'D', 'E', 'F'];

/** Player id to crew. A player who is in no crew is simply absent. */
export type CrewMap = Readonly<Record<string, CrewId>>;

/**
 * The next crew in the cycle, ending at unassigned.
 *
 * One control, cycled by tapping, rather than a dropdown per player: crews get
 * set while twenty people are talking, and the whole assignment has to take
 * seconds.
 */
export function nextCrew(current: CrewId | undefined): CrewId | undefined {
  if (current === undefined) return CREWS[0];
  const index = CREWS.indexOf(current);
  return index === CREWS.length - 1 ? undefined : CREWS[index + 1];
}

/**
 * A 32-bit hash of a player inside a room.
 *
 * Seeded by the room code so the same person lands in a different crew in the
 * next room, and mixed the same way `LocalMatchProvider`'s bot seed is, because
 * two hashes in one codebase that differ for no reason are two hashes to get
 * wrong.
 */
function hashInRoom(matchId: string, playerId: string): number {
  let state = 2166136261;
  for (const character of `${matchId}:${playerId}`) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return state >>> 0;
}

/**
 * Deal the roster into crews, deterministically from the room code.
 *
 * Every client computes this from `MatchState.players`, which the server
 * publishes in a stable order, so twenty laptops cannot disagree and nothing
 * has to be transmitted. That is the whole reason crews can be shared at all
 * without a wire field: the draw is a pure function of data everybody already
 * has.
 *
 * Sorting by hash before dealing round-robin means crews come out balanced
 * whatever order people joined in, and that a late joiner does not simply pile
 * onto the last crew.
 */
export function drawCrews(
  playerIds: readonly string[],
  matchId: string,
  crewCount = CREWS.length,
): CrewMap {
  const crews = Math.max(1, Math.min(crewCount, CREWS.length));
  if (playerIds.length === 0) return {};

  const dealt = [...playerIds].sort(
    (left, right) =>
      hashInRoom(matchId, left) - hashInRoom(matchId, right) ||
      left.localeCompare(right),
  );

  return Object.fromEntries(
    dealt.map((playerId, index) => [playerId, CREWS[index % crews]]),
  );
}

/**
 * How many crews to deal a roster of this size into.
 *
 * Aims at crews of three or four. Below that a crew is a pair and its weakest
 * member is its only member; much above it and the quiet one disappears into
 * the group, which is the person the format exists to reach.
 */
export function crewCountFor(playerCount: number): number {
  if (playerCount < 4) return 1;
  // Crews of three or four. Below that a crew is a pair and its weakest member
  // is its only member; much above it and the quiet one disappears into the
  // group, which is the person the whole format exists to reach.
  return Math.max(2, Math.min(CREWS.length, Math.round(playerCount / 3.5)));
}

/**
 * The crew map the room is actually playing.
 *
 * An assignment somebody made wins, because it was made for a reason a draw
 * cannot know — pairing a newcomer with a particular person. Absent one, the
 * room draws its own, which is why a crew round needs no setup at all in the
 * common case and why every client agrees without anything being transmitted.
 *
 * Mixing the two is deliberate: the moment anybody is assigned, the draw stops
 * entirely rather than filling in the gaps. Half-drawn, half-chosen crews would
 * change under an instructor's hands as they assigned them one by one.
 */
export function crewsFor(
  players: readonly MatchPlayer[],
  matchId: string,
): CrewMap {
  const assigned = Object.fromEntries(
    players
      .filter((player) => player.crew !== undefined)
      .map((player) => [player.playerId, player.crew as CrewId]),
  );
  if (Object.keys(assigned).length > 0) return assigned;

  const ids = players.map((player) => player.playerId);
  return drawCrews(ids, matchId, crewCountFor(ids.length));
}

export function assignCrew(crews: CrewMap, playerId: string): CrewMap {
  const next = nextCrew(crews[playerId]);
  const rest = Object.fromEntries(
    Object.entries(crews).filter(([id]) => id !== playerId),
  );
  return next === undefined ? rest : { ...rest, [playerId]: next };
}

/**
 * How a crew's score is reduced from its members'.
 *
 * `sum` rewards a crew for getting everybody in, and a strong member can still
 * carry a weak one. `weakestTwo` scores only the crew's two lowest members, so
 * carrying is arithmetically impossible: the fastest programmer's own score
 * stops mattering the moment they are not in the bottom two, and the only move
 * left is to go and help. That is a blunt instrument and it is meant to be —
 * announce which one is in play before the round, never after.
 */
export type CrewScoring = 'sum' | 'weakestTwo';

export interface CrewTotal {
  crew: CrewId;
  total: number;
  members: number;
  /** How many of them got a submission in. */
  submitted: number;
  /** The scores the total was reduced from, lowest first. */
  scores: readonly number[];
}

/** How many members `weakestTwo` counts. */
const WEAKEST_COUNT = 2;

/** Crew standings for one round, highest total first. Empty when nobody is assigned. */
export function crewTotals(
  rows: readonly MatchResultRow[],
  crews: CrewMap,
  rankBy: MatchResults['rankBy'],
  scoring: CrewScoring = 'sum',
): readonly CrewTotal[] {
  const gathered = new Map<
    CrewId,
    { scores: number[]; members: number; submitted: number }
  >();

  for (const row of rows) {
    const crew = crews[row.playerId];
    if (crew === undefined) continue;
    // A member who never submitted counts as zero rather than being skipped:
    // under either rule, a crew that leaves somebody behind should feel it.
    const scored = row.submissionId !== undefined;
    const score = scored ? (rankBy === 'final' ? row.finalScore : row.completionScore) : 0;
    const running = gathered.get(crew) ?? { scores: [], members: 0, submitted: 0 };
    running.scores.push(score);
    running.members += 1;
    running.submitted += scored ? 1 : 0;
    gathered.set(crew, running);
  }

  const totals: CrewTotal[] = [...gathered.entries()].map(([crew, entry]) => {
    const scores = [...entry.scores].sort((left, right) => left - right);
    const counted =
      scoring === 'weakestTwo' ? scores.slice(0, WEAKEST_COUNT) : scores;
    return {
      crew,
      total: counted.reduce((sum, score) => sum + score, 0),
      members: entry.members,
      submitted: entry.submitted,
      scores,
    };
  });

  return totals.sort(
    (left, right) => right.total - left.total || left.crew.localeCompare(right.crew),
  );
}

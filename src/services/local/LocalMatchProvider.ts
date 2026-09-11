import type {
  ChallengeProvider,
  MatchChallenge,
  MatchProvider,
  MatchSubmission,
} from '../contracts';
import type {
  ClockSample,
  MatchConfig,
  MatchPlayer,
  MatchResultRow,
  MatchResults,
  MatchState,
  MatchSubmissionAck,
} from '../../types/match';
import type { ProgramMetrics } from '../../types/domain';
import { ROUND_COUNTDOWN_MS } from '../../features/match/countdown';
import { cutterGridAvailableForChallenge } from '../../features/cutter-grid/profileRegistry';
import { reshuffledAfter } from './shuffle';

/**
 * An offline practice round.
 *
 * # What this is not
 *
 * It is **not multiplayer**. There is no server, so there is no authoritative
 * replay: the score it records is the one the browser computed, and the
 * opponents are scripted local bots whose scores are generated, not earned.
 * Nothing here is a result, and the UI labels every round it runs as practice.
 *
 * # Why it exists anyway
 *
 * The simulator ships offline by default (`resolveServices`), and a versus mode
 * that shows an error until somebody runs a Rust server is a versus mode nobody
 * sees. This makes the format — shared deadline, hidden scores, best attempt
 * counts — playable and reviewable with `npm run dev` alone, against the same
 * {@link MatchProvider} interface the online path implements. Point
 * `VITE_HCR_API_BASE_URL` at a backend and the identical UI becomes real.
 */
export class LocalMatchProvider implements MatchProvider {
  readonly kind = 'practice' as const;

  private player: {
    playerId: string;
    displayName: string;
    utcOffsetMinutes?: number;
  } = { playerId: 'you', displayName: 'You' };
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly challenges: ChallengeProvider) {}

  setPlayer(player: {
    playerId: string;
    displayName: string;
    utcOffsetMinutes?: number;
  }): void {
    this.player = player;
  }

  async createMatch(config: MatchConfig): Promise<MatchState> {
    const matchId = roomCode();
    const room: Room = {
      matchId,
      // Copied, not held: the room rewrites `challengeRef` on every draw, and
      // that must not reach back into the caller's settings object.
      config: { ...config },
      // A host who named the item meant it, in this round and every rematch.
      // Everyone else gets a fresh draw per round.
      hostPinned: config.challengeRef !== undefined,
      bag: [],
      phase: 'lobby',
      players: new Map(),
      entries: new Map(),
      bots: makeBots(matchId, Math.min(3, Math.max(0, config.maxPlayers - 1))),
      rounds: 1,
    };
    await this.prepareChallenge(room);
    for (const bot of room.bots) {
      room.players.set(bot.playerId, {
        playerId: bot.playerId,
        displayName: bot.displayName,
        utcOffsetMinutes: bot.utcOffsetMinutes,
        connected: true,
        submitted: false,
      });
    }
    this.rooms.set(matchId, room);
    return this.snapshot(room);
  }

  /**
   * Settle what the round will be played on, before anybody joins it.
   *
   * Cutter Grid needs a certified profile per challenge — the mode is only
   * offered where one proves the lattice is reachable, that entry cuts nothing
   * and that a reference route removes exactly the target — so a room opened on
   * an unprofiled item would be a lobby nobody could submit into, discovered at
   * T0 with twenty people watching. The server refuses that at creation
   * (`06-MULTIPLAYER.md` §3) and so does this: a pinned item the mode cannot be
   * played on is an error, and an unpinned Cutter Grid room draws its challenge
   * here rather than at T0 so the failure, if there is one, happens at creation.
   *
   * An unpinned Servo room draws nothing yet. Any challenge will do, so the
   * draw waits for {@link getMatchChallenge} — the moment it is revealed — and
   * the lobby carries no item for a curious player to read out of the state.
   */
  private async prepareChallenge(room: Room): Promise<void> {
    const pinned = room.config.challengeRef?.challengeId;
    if (pinned) {
      if (
        room.config.programmingMode === 'cutter-grid' &&
        !cutterGridAvailableForChallenge(
          await this.challenges.getChallenge(pinned),
        )
      ) {
        throw new Error(
          'That challenge has no certified Cutter Grid profile, so it cannot be played in Cutter Grid.',
        );
      }
      return;
    }

    if (room.config.programmingMode === 'cutter-grid') {
      room.config.challengeRef = {
        challengeId: await this.draw(room),
        version: 1,
      };
    }
  }

  /**
   * The next challenge this room plays, drawn at random without repeating.
   *
   * Every unpinned round used to open on the head of the catalog, so a class
   * that played six rounds played the same haircut six times and rounds two
   * through six measured who remembered round one. Drawing from a bag — a
   * shuffle dealt one item at a time, refilled when it empties — gives every
   * challenge a turn before any challenge gets a second one, and
   * {@link reshuffledAfter} keeps the seam between two bags from repeating.
   */
  private async draw(room: Room): Promise<string> {
    if (room.bag.length === 0) {
      const eligible = await this.playableChallenges(room.config);
      if (eligible.length === 0) {
        throw new Error(
          room.config.programmingMode === 'cutter-grid'
            ? 'No challenge in the catalog has a certified Cutter Grid profile.'
            : 'The challenge catalog is empty.',
        );
      }
      room.bag = reshuffledAfter(eligible, room.lastDrawn);
    }
    const drawn = room.bag.shift() as string;
    room.lastDrawn = drawn;
    return drawn;
  }

  /**
   * Catalog ids a round in this mode can actually be played on.
   *
   * Servo runs on anything. Cutter Grid asks each challenge whether it has a
   * certified profile, which means building every one of them — lessons derive
   * their target by running their solution — so this is the one place the
   * offline provider does real work. It is paid once per room, and
   * `buildLessonChallenge` caches, so a second room is free.
   */
  private async playableChallenges(config: MatchConfig): Promise<string[]> {
    const listed = (await this.challenges.listChallenges()).map(
      (summary) => summary.id,
    );
    if (config.programmingMode !== 'cutter-grid') {
      return listed;
    }

    const playable: string[] = [];
    for (const challengeId of listed) {
      const challenge = await this.challenges.getChallenge(challengeId);
      if (cutterGridAvailableForChallenge(challenge)) {
        playable.push(challengeId);
      }
    }
    return playable;
  }

  async joinMatch(matchId: string): Promise<MatchState> {
    const room = this.room(matchId);
    room.players.set(this.player.playerId, {
      playerId: this.player.playerId,
      displayName: this.player.displayName,
      ...(this.player.utcOffsetMinutes === undefined
        ? {}
        : { utcOffsetMinutes: this.player.utcOffsetMinutes }),
      connected: true,
      submitted: false,
    });
    return this.snapshot(room);
  }

  async startMatch(matchId: string): Promise<MatchState> {
    const room = this.room(matchId);
    if (room.phase !== 'lobby') {
      throw new Error('The round has already started.');
    }
    const now = Date.now();
    room.phase = 'running';
    room.opensAt = now;
    // The clients hold the editor back for `ROUND_COUNTDOWN_MS` after `opensAt`
    // so that every screen starts on the same second. Online that comes out of
    // the round, because only the server may move a deadline. This room *is*
    // the server, so it grants the countdown instead of charging the players
    // for it: a three-minute round here is three minutes of editing.
    room.closesAt = now + ROUND_COUNTDOWN_MS + room.config.durationMs;
    return this.snapshot(room);
  }

  async getMatch(matchId: string): Promise<MatchState> {
    return this.snapshot(this.room(matchId));
  }

  async getMatchChallenge(matchId: string): Promise<MatchChallenge> {
    const room = this.room(matchId);
    if (room.phase === 'lobby') {
      // Same wording the server uses, so the two modes read alike.
      throw new Error('The challenge is revealed when the round starts.');
    }
    if (!room.config.challengeRef) {
      // An unpinned Servo room draws at the reveal, and records the draw: every
      // player is shown the one item, and the results row names the same one.
      room.config.challengeRef = { challengeId: await this.draw(room), version: 1 };
    }
    const { challengeId, version } = room.config.challengeRef;
    return {
      challenge: await this.challenges.getChallenge(challengeId),
      version,
    };
  }

  async submit(
    matchId: string,
    submission: MatchSubmission,
  ): Promise<MatchSubmissionAck> {
    const room = this.room(matchId);
    const now = Date.now();
    this.settle(room, now);

    const refuse = (reason: MatchSubmissionAck['rejectedReason']) => ({
      submissionId: submission.submissionId,
      accepted: false,
      serverReceivedAt: now,
      rejectedReason: reason,
    });

    if (!room.players.has(this.player.playerId)) {
      return refuse('not-participant');
    }
    // Deadline before phase, so a player who missed it by a millisecond is told
    // that, rather than the technically-true-but-useless "wrong phase".
    if (room.closesAt !== undefined && now >= room.closesAt) {
      return refuse('after-deadline');
    }
    if (room.phase !== 'running') {
      return refuse('wrong-phase');
    }

    // A halted program — a head collision, say — produces no client score,
    // because the browser engine stops rather than scoring the partial result.
    // The server would score what was achieved up to the halt; with no server,
    // the entry is worth zero. Another way an offline round is not a result.
    const entry: Entry = {
      completionScore: submission.clientScore?.completionScore ?? 0,
      finalScore: submission.clientScore?.finalScore ?? 0,
      efficiencyScore: submission.clientScore?.efficiencyScore ?? 0,
      metrics: {
        ...ZERO_METRICS,
        sourceBlockCount: submission.program.sourceBlockCount,
      },
      submissionId: submission.submissionId,
      serverReceivedAt: now,
    };
    const previous = room.entries.get(this.player.playerId);
    if (!previous || beats(entry, previous, room.config.rankBy)) {
      room.entries.set(this.player.playerId, entry);
    }
    const player = room.players.get(this.player.playerId);
    if (player) {
      player.submitted = true;
    }

    return {
      submissionId: submission.submissionId,
      accepted: true,
      serverReceivedAt: now,
    };
  }

  async getResults(matchId: string): Promise<MatchResults> {
    const room = this.room(matchId);
    this.settle(room, Date.now());
    if (room.phase !== 'results') {
      throw new Error('Results are published when the round closes.');
    }

    for (const bot of room.bots) {
      if (!room.entries.has(bot.playerId)) {
        room.entries.set(bot.playerId, {
          completionScore: bot.completionScore,
          finalScore: bot.finalScore,
          efficiencyScore: bot.efficiencyScore,
          metrics: { ...ZERO_METRICS, sourceBlockCount: bot.blocks },
          submissionId: `${bot.playerId}-1`,
          serverReceivedAt: room.opensAt ?? Date.now(),
        });
      }
    }

    const rows: MatchResultRow[] = [...room.players.values()].map((player) => {
      const entry = room.entries.get(player.playerId);
      return {
        rank: 0,
        playerId: player.playerId,
        displayName: player.displayName,
        completionScore: entry?.completionScore ?? 0,
        finalScore: entry?.finalScore ?? 0,
        metrics: entry?.metrics ?? { ...ZERO_METRICS },
        ...(entry ? { submissionId: entry.submissionId } : {}),
        ...(entry ? { serverReceivedAt: entry.serverReceivedAt } : {}),
      };
    });

    rows.sort((left, right) => {
      const a = room.entries.get(left.playerId);
      const b = room.entries.get(right.playerId);
      if (a && b) {
        if (beats(a, b, room.config.rankBy)) return -1;
        if (beats(b, a, room.config.rankBy)) return 1;
      }
      if (a && !b) return -1;
      if (b && !a) return 1;
      return left.playerId.localeCompare(right.playerId);
    });
    rows.forEach((row, index) => {
      row.rank = index + 1;
    });

    return {
      matchId,
      challengeId: room.config.challengeRef?.challengeId ?? 'unknown',
      challengeVersion: room.config.challengeRef?.version ?? 1,
      rankBy: room.config.rankBy,
      rows,
    };
  }

  /**
   * Reopen a finished practice round, keeping the room and its roster.
   *
   * The offline room lives in this tab and its code was never shareable, so
   * there is nothing here to save a class from retyping. It exists so the
   * button behaves identically in both modes: the interface is the same
   * interface, and a control that worked online and did nothing offline would
   * be a worse lie than the practice label already has to tell.
   *
   * Fresh bots each time, and — unless the host named the item — a fresh
   * challenge, for the same reason the server picks a new one: replaying the
   * identical round would make round two a memory test.
   */
  async rematch(matchId: string): Promise<MatchState> {
    const room = this.room(matchId);
    this.settle(room, Date.now());
    if (room.phase !== 'results') {
      throw new Error('Only a finished round can be reopened.');
    }

    room.phase = 'lobby';
    delete room.opensAt;
    delete room.closesAt;
    room.entries.clear();
    if (!room.hostPinned) {
      delete room.config.challengeRef;
      await this.prepareChallenge(room);
    }
    for (const player of room.players.values()) {
      player.submitted = false;
    }

    for (const bot of room.bots) {
      room.players.delete(bot.playerId);
    }
    room.bots = makeBots(
      `${matchId}:${room.rounds}`,
      Math.min(3, Math.max(0, room.config.maxPlayers - 1)),
    );
    room.rounds += 1;
    for (const bot of room.bots) {
      room.players.set(bot.playerId, {
        playerId: bot.playerId,
        displayName: bot.displayName,
        utcOffsetMinutes: bot.utcOffsetMinutes,
        connected: true,
        submitted: false,
      });
    }

    return this.snapshot(room);
  }

  async setCrews(
    matchId: string,
    crews: Readonly<Record<string, string>>,
  ): Promise<MatchState> {
    const room = this.room(matchId);
    this.settle(room, Date.now());
    if (room.phase !== 'lobby') {
      throw new Error('Crews are set before the round starts.');
    }

    for (const player of room.players.values()) {
      const crew = crews[player.playerId];
      if (crew === undefined) {
        delete player.crew;
      } else {
        player.crew = crew;
      }
    }
    return this.snapshot(room);
  }

  /** No server, so no offset. */
  async syncClock(): Promise<ClockSample> {
    return { offsetMs: 0, rttMs: 0 };
  }

  private room(matchId: string): Room {
    const room = this.rooms.get(matchId.toUpperCase());
    if (!room) {
      throw new Error(
        `No practice round "${matchId}". Offline rounds live in this tab only — connect a backend to share a code.`,
      );
    }
    return room;
  }

  private snapshot(room: Room): MatchState {
    const now = Date.now();
    this.settle(room, now);
    // Bots "submit" partway through, so the roster is not suspiciously static.
    if (room.phase === 'running' && room.opensAt !== undefined) {
      const elapsed = now - room.opensAt;
      for (const bot of room.bots) {
        const player = room.players.get(bot.playerId);
        if (player && elapsed >= bot.submitsAtMs) {
          player.submitted = true;
        }
      }
    }
    return {
      matchId: room.matchId,
      phase: room.phase,
      config: room.config,
      ...(room.opensAt === undefined ? {} : { opensAt: room.opensAt }),
      ...(room.closesAt === undefined ? {} : { closesAt: room.closesAt }),
      serverTime: now,
      players: [...room.players.values()]
        .map((player) => ({ ...player }))
        .sort((a, b) => a.playerId.localeCompare(b.playerId)),
    };
  }

  private settle(room: Room, now: number): void {
    if (
      room.phase === 'running' &&
      room.closesAt !== undefined &&
      now >= room.closesAt
    ) {
      room.phase = 'results';
    }
  }
}

/** Whether a roster entry is a scripted practice opponent rather than a person. */
export function isPracticeBot(playerId: string): boolean {
  return playerId.startsWith('bot:');
}

interface Entry {
  completionScore: number;
  finalScore: number;
  efficiencyScore: number;
  metrics: ProgramMetrics;
  submissionId: string;
  serverReceivedAt: number;
}

interface Bot {
  playerId: string;
  displayName: string;
  completionScore: number;
  finalScore: number;
  efficiencyScore: number;
  blocks: number;
  submitsAtMs: number;
  utcOffsetMinutes: number;
}

interface Room {
  matchId: string;
  config: MatchConfig;
  phase: MatchState['phase'];
  opensAt?: number;
  closesAt?: number;
  players: Map<string, MatchPlayer>;
  entries: Map<string, Entry>;
  bots: Bot[];
  /** Rounds played in this room, so a rematch draws different bots. */
  rounds: number;
  /**
   * Whether the host named the challenge in the lobby.
   *
   * Pinned rooms keep it across rematches — a host who chose an item wants that
   * item, and a class working one haircut all afternoon is a real lesson plan.
   * Unpinned rooms redraw every round.
   */
  hostPinned: boolean;
  /** Challenges left in the current shuffle, dealt one per round. */
  bag: string[];
  /** The last challenge dealt, so a refilled bag cannot repeat it. */
  lastDrawn?: string;
}

const ZERO_METRICS: ProgramMetrics = {
  sourceBlockCount: 0,
  executedCommandCount: 0,
  estimatedDurationMs: 0,
};

const BOT_NAMES = ['Nova', 'Kite', 'Juno', 'Vex', 'Iris', 'Onyx', 'Wren'];

/**
 * Tie-break from `06-MULTIPLAYER.md` §1, mirroring `rounds.rs::Entry::beats`.
 *
 * Duplicated rather than shared because the server's copy is the one that
 * counts; this one only has to agree, and a test pins that it does.
 */
function beats(entry: Entry, other: Entry, rankBy: MatchConfig['rankBy']): boolean {
  const mine = rankBy === 'final' ? entry.finalScore : entry.completionScore;
  const theirs = rankBy === 'final' ? other.finalScore : other.completionScore;
  if (mine !== theirs) return mine > theirs;
  if (entry.efficiencyScore !== other.efficiencyScore) {
    return entry.efficiencyScore > other.efficiencyScore;
  }
  if (entry.metrics.estimatedDurationMs !== other.metrics.estimatedDurationMs) {
    return entry.metrics.estimatedDurationMs < other.metrics.estimatedDurationMs;
  }
  return entry.serverReceivedAt < other.serverReceivedAt;
}

/**
 * Build the bot field for a room.
 *
 * Seeded from the room code so the same code always faces the same opponents —
 * a practice round you can retry against a fixed bar is more useful than one
 * that reshuffles every time.
 */
function makeBots(matchId: string, count: number): Bot[] {
  const random = seededRandom(matchId);
  const names = [...BOT_NAMES];
  return Array.from({ length: count }, (_, index) => {
    const name = names.splice(Math.floor(random() * names.length), 1)[0] ?? `Bot ${index}`;
    const completionScore = 58 + random() * 36;
    const efficiencyScore = 45 + random() * 50;
    return {
      playerId: `bot:${name.toLowerCase()}`,
      displayName: name,
      completionScore,
      efficiencyScore,
      // The same 0.6 / 0.25 / 0.15 blend the shipped challenge uses, so a bot's
      // two scores stay consistent with each other under either ranking.
      finalScore: completionScore * 0.6 + efficiencyScore * 0.25 + 70 * 0.15,
      blocks: 4 + Math.floor(random() * 9),
      submitsAtMs: Math.floor((0.25 + random() * 0.5) * 60_000),
      utcOffsetMinutes: (Math.floor(random() * 29) - 14) * 30,
    };
  });
}

/** Deterministic 32-bit LCG, seeded by hashing the room code. */
function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (const character of seed) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * A short, unambiguous room code — no `I`/`O`/`0`/`1`.
 *
 * Six characters from a 32-symbol alphabet, matching what the server issues
 * (`rounds.rs::derive_code`), so the code input behaves the same in both modes.
 */
function roomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length])
    .join('');
}

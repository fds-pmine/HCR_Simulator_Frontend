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

  private player = { playerId: 'you', displayName: 'You' };
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly challenges: ChallengeProvider) {}

  setPlayer(player: { playerId: string; displayName: string }): void {
    this.player = player;
  }

  async createMatch(config: MatchConfig): Promise<MatchState> {
    const matchId = roomCode();
    const room: Room = {
      matchId,
      config,
      phase: 'lobby',
      players: new Map(),
      entries: new Map(),
      bots: makeBots(matchId, Math.min(3, Math.max(0, config.maxPlayers - 1))),
    };
    for (const bot of room.bots) {
      room.players.set(bot.playerId, {
        playerId: bot.playerId,
        displayName: bot.displayName,
        connected: true,
        submitted: false,
      });
    }
    this.rooms.set(matchId, room);
    return this.snapshot(room);
  }

  async joinMatch(matchId: string): Promise<MatchState> {
    const room = this.room(matchId);
    room.players.set(this.player.playerId, {
      playerId: this.player.playerId,
      displayName: this.player.displayName,
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
    room.closesAt = now + room.config.durationMs;
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
    const pinned = room.config.challengeRef;
    if (pinned) {
      return {
        challenge: await this.challenges.getChallenge(pinned.challengeId),
        version: pinned.version,
      };
    }
    const [first] = await this.challenges.listChallenges();
    if (!first) {
      throw new Error('The challenge catalog is empty.');
    }
    room.config.challengeRef = { challengeId: first.id, version: 1 };
    return {
      challenge: await this.challenges.getChallenge(first.id),
      version: 1,
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

import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices } from '../../app/servicesContext';
import type { MatchChallenge } from '../../services/contracts';
import type { ScoreResult } from '../../types/domain';
import {
  matchConfig,
  type MatchConfig,
  type MatchResults,
  type MatchState,
  type MatchSubmissionAck,
} from '../../types/match';
import type { Program } from '../blockly/programTypes';
import type { CutterGridProgramV1 } from '../cutter-grid/types';
import type { PlayerIdentity } from './identity';
import {
  currentUtcOffsetMinutes,
  loadResearchPreferences,
} from '../preferences/researchPreferences';

/**
 * How often the round state is re-read.
 *
 * Polling, not a live stream, on purpose: the eventual transport for this is
 * MQTT-over-WebSocket (`01-CONTRACT.md` §3.1), and that team is still landing
 * MQTT. Every call here goes through {@link MatchProvider}, so swapping polling
 * for a subscription later is one implementation, not a UI rewrite.
 *
 * The round state is also what *settles* a closed round server-side, so polling
 * is what moves a finished round to `results` for everyone watching it.
 */
const POLL_MS = 1_200;

/**
 * How often a closed round is re-read.
 *
 * Slower, because only one thing can still happen to it: the host reopening it
 * for another round. Watching for that is what lets everybody follow the host
 * back into the lobby without retyping the room code, and a scoreboard nobody
 * has closed yet should not poll at playing speed to find out.
 */
const RESULTS_POLL_MS = 3_000;

export interface MatchSession {
  matchId?: string;
  /**
   * Whether this client opened the room.
   *
   * There is no host on the server — the room code is the whole permission
   * model — so this is not authority, it is only "the machine that started
   * this". An endless session needs exactly one client driving the loop, and
   * the one that opened the room is the least surprising choice: it is the
   * projector.
   */
  opened: boolean;
  state?: MatchState;
  /** Arrives only once the round starts; withheld during the lobby by design. */
  challenge?: MatchChallenge;
  results?: MatchResults;
  /** Local-to-server clock offset, in ms. */
  offsetMs: number;
  /** The most recent acknowledgement — accepted or refused, never a score. */
  lastAck?: MatchSubmissionAck;
  error?: string;
  busy: boolean;
}

/** What travels with a program, beyond the program. */
export interface MatchEntry {
  /** Read only by the offline provider, which has no server to replay against. */
  clientScore?: ScoreResult;
  /** The lattice route, when the round is played in Cutter Grid. */
  cutterGridV4?: CutterGridProgramV1;
}

export interface MatchActions {
  host: (config: Partial<MatchConfig>) => Promise<void>;
  join: (code: string) => Promise<void>;
  start: () => Promise<void>;
  submit: (program: Program, entry?: MatchEntry) => Promise<void>;
  /** Reopen the finished round on a new challenge, keeping the room. */
  rematch: () => Promise<void>;
  /** Replace the room's crew assignment. Lobby only. */
  setCrews: (crews: Readonly<Record<string, string>>) => Promise<void>;
  leave: () => void;
  dismissError: () => void;
}

/**
 * Drive one competitive round.
 *
 * Holds no rules of its own. Which phase accepts a submission, whether the
 * deadline has passed, who may see the challenge — all of that is decided by the
 * service and merely displayed here, so a patched client gets refused rather
 * than getting away with something.
 */
export function useMatch(identity: PlayerIdentity): [MatchSession, MatchActions] {
  const { matchProvider } = useServices();

  const [matchId, setMatchId] = useState<string>();
  const [opened, setOpened] = useState(false);
  const [state, setState] = useState<MatchState>();
  const [challenge, setChallenge] = useState<MatchChallenge>();
  const [results, setResults] = useState<MatchResults>();
  const [offsetMs, setOffsetMs] = useState(0);
  const [lastAck, setLastAck] = useState<MatchSubmissionAck>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Read inside the polling loop, which must not restart when they change.
  const challengeRef = useRef<MatchChallenge | undefined>(undefined);
  const resultsRef = useRef<MatchResults | undefined>(undefined);
  // The phase, read by the poll loop to choose its own next delay. A ref rather
  // than the state value so the loop is not resubscribed on every tick.
  const stateRef = useRef<MatchState['phase'] | undefined>(undefined);

  useEffect(() => {
    const shareOffset = loadResearchPreferences().utcOffset;
    matchProvider.setPlayer({
      ...identity,
      ...(shareOffset ? { utcOffsetMinutes: currentUtcOffsetMinutes() } : {}),
    });
  }, [matchProvider, identity]);

  useEffect(() => {
    if (!matchId) {
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const next = await matchProvider.getMatch(matchId);
        if (!active) return;
        stateRef.current = next.phase;
        setState(next);

        if (next.phase === 'running' && !challengeRef.current) {
          const loaded = await matchProvider.getMatchChallenge(matchId);
          if (!active) return;
          challengeRef.current = loaded;
          setChallenge(loaded);
        }

        if (next.phase === 'results' && !resultsRef.current) {
          const loaded = await matchProvider.getResults(matchId);
          if (!active) return;
          resultsRef.current = loaded;
          setResults(loaded);
        }

        // The host reopened the room: the standings and the challenge belonged
        // to the round that ended, and holding either would show the last
        // round's scoreboard over the next round's lobby.
        if (next.phase === 'lobby' && (resultsRef.current || challengeRef.current)) {
          resultsRef.current = undefined;
          challengeRef.current = undefined;
          setResults(undefined);
          setChallenge(undefined);
          setLastAck(undefined);
        }

        // A cancelled round is over for good; a closed one can still be
        // reopened, so it is watched, just not at playing speed.
        if (next.phase === 'cancelled') {
          return;
        }
      } catch (reason) {
        if (!active) return;
        setError(describe(reason));
      }
      if (active) {
        const closed = stateRef.current === 'results';
        timer = setTimeout(() => void poll(), closed ? RESULTS_POLL_MS : POLL_MS);
      }
    };

    void poll();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [matchId, matchProvider]);

  const enter = useCallback(
    async (resolveMatchId: () => Promise<string>) => {
      setBusy(true);
      setError(undefined);
      try {
        const target = await resolveMatchId();
        const joined = await matchProvider.joinMatch(target);
        challengeRef.current = undefined;
        resultsRef.current = undefined;
        setChallenge(undefined);
        setResults(undefined);
        setLastAck(undefined);
        setState(joined);
        setMatchId(joined.matchId);
        // Best-effort: a countdown a little off is better than no round at all.
        void matchProvider
          .syncClock()
          .then((sample) => setOffsetMs(sample.offsetMs))
          .catch(() => setOffsetMs(0));
      } catch (reason) {
        setError(describe(reason));
      } finally {
        setBusy(false);
      }
    },
    [matchProvider],
  );

  const host = useCallback(
    (overrides: Partial<MatchConfig>) =>
      // Hosting is create-then-join: the creator is not a participant until
      // they join, exactly like everybody else. `matchConfig` fills in the
      // fields the caller did not choose — the server takes no partial config.
      enter(async () => {
        const created = await matchProvider.createMatch(matchConfig(overrides));
        setOpened(true);
        return created.matchId;
      }),
    [enter, matchProvider],
  );

  const join = useCallback(
    (code: string) => enter(async () => code.trim()),
    [enter],
  );

  const start = useCallback(async () => {
    if (!matchId) return;
    setBusy(true);
    try {
      setState(await matchProvider.startMatch(matchId));
    } catch (reason) {
      setError(describe(reason));
    } finally {
      setBusy(false);
    }
  }, [matchId, matchProvider]);

  const submit = useCallback(
    async (program: Program, entry: MatchEntry = {}) => {
      const pinned = challengeRef.current;
      if (!matchId || !pinned) return;
      setBusy(true);
      try {
        const ack = await matchProvider.submit(matchId, {
          submissionId: newSubmissionId(),
          challengeId: pinned.challenge.id,
          challengeVersion: pinned.version,
          program,
          ...(entry.clientScore ? { clientScore: entry.clientScore } : {}),
          ...(entry.cutterGridV4 ? { cutterGridV4: entry.cutterGridV4 } : {}),
        });
        setLastAck(ack);
        // Refresh at once so the roster's "submitted" tick does not wait out a
        // poll interval — the one piece of feedback a player gets mid-round.
        setState(await matchProvider.getMatch(matchId));
      } catch (reason) {
        setError(describe(reason));
      } finally {
        setBusy(false);
      }
    },
    [matchId, matchProvider],
  );

  /**
   * Reopen the finished round, keeping the room and everybody in it.
   *
   * Every client is still polling the closed round, so they follow the phase
   * back to the lobby on their own — nobody retypes the code, and the roster
   * arrives intact.
   */
  const rematch = useCallback(async () => {
    if (!matchId) return;
    setBusy(true);
    try {
      const next = await matchProvider.rematch(matchId);
      resultsRef.current = undefined;
      challengeRef.current = undefined;
      stateRef.current = next.phase;
      setResults(undefined);
      setChallenge(undefined);
      setLastAck(undefined);
      setState(next);
    } catch (reason) {
      setError(describe(reason));
    } finally {
      setBusy(false);
    }
  }, [matchId, matchProvider]);

  /**
   * Put the room into crews, for everybody rather than for this browser.
   *
   * Not `busy`-guarded like the others: teaming twenty people is twenty taps
   * and blocking the roster between each one would make it unusable. The
   * server replaces the whole map every time, so the last tap wins and a lost
   * request costs one letter rather than the assignment.
   */
  const setCrews = useCallback(
    async (crews: Readonly<Record<string, string>>) => {
      if (!matchId) return;
      try {
        setState(await matchProvider.setCrews(matchId, crews));
      } catch (reason) {
        setError(describe(reason));
      }
    },
    [matchId, matchProvider],
  );

  const leave = useCallback(() => {
    setOpened(false);
    challengeRef.current = undefined;
    resultsRef.current = undefined;
    stateRef.current = undefined;
    setMatchId(undefined);
    setState(undefined);
    setChallenge(undefined);
    setResults(undefined);
    setLastAck(undefined);
    setError(undefined);
  }, []);

  const dismissError = useCallback(() => setError(undefined), []);

  return [
    { matchId, opened, state, challenge, results, offsetMs, lastAck, error, busy },
    { host, join, start, submit, rematch, setCrews, leave, dismissError },
  ];
}

function newSubmissionId(): string {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function describe(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'The round could not be reached.';
}

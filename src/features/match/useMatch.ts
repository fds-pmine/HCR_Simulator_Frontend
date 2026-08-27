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

export interface MatchSession {
  matchId?: string;
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

export interface MatchActions {
  host: (config: Partial<MatchConfig>) => Promise<void>;
  join: (code: string) => Promise<void>;
  start: () => Promise<void>;
  submit: (program: Program, clientScore?: ScoreResult) => Promise<void>;
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

        // Nothing further can change; stop asking.
        if (next.phase === 'results' || next.phase === 'cancelled') {
          return;
        }
      } catch (reason) {
        if (!active) return;
        setError(describe(reason));
      }
      if (active) {
        timer = setTimeout(() => void poll(), POLL_MS);
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
      enter(
        async () =>
          (await matchProvider.createMatch(matchConfig(overrides))).matchId,
      ),
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
    async (program: Program, clientScore?: ScoreResult) => {
      const pinned = challengeRef.current;
      if (!matchId || !pinned) return;
      setBusy(true);
      try {
        const ack = await matchProvider.submit(matchId, {
          submissionId: newSubmissionId(),
          challengeId: pinned.challenge.id,
          challengeVersion: pinned.version,
          program,
          ...(clientScore ? { clientScore } : {}),
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

  const leave = useCallback(() => {
    challengeRef.current = undefined;
    resultsRef.current = undefined;
    setMatchId(undefined);
    setState(undefined);
    setChallenge(undefined);
    setResults(undefined);
    setLastAck(undefined);
    setError(undefined);
  }, []);

  const dismissError = useCallback(() => setError(undefined), []);

  return [
    { matchId, state, challenge, results, offsetMs, lastAck, error, busy },
    { host, join, start, submit, leave, dismissError },
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { useServices } from '../../app/servicesContext';
import { SimulationWorkbench } from '../../components/layout/SimulationWorkbench';
import type { Challenge } from '../../types/domain';
import type { NextItem, SessionSnapshot } from '../../types/session';
import type { CompiledProgram } from '../blockly/programTypes';
import { SimulationEngine } from '../simulation/SimulationEngine';
import { runHeadless } from '../simulation/headlessRun';
import { DEFAULT_CHALLENGE_ID } from '../../data/challenges/defaultChallenge';
import { initialThetaFrom } from './initialTheta';
import { PracticePanel } from './PracticePanel';

interface PracticeRunProps {
  onExit: () => void;
}

/**
 * Solo practice, as a progression rather than a menu.
 *
 * It used to open the head of the catalog and stop there: no "next", no sense
 * of getting anywhere. Now the *server* decides what comes next.
 *
 * # One fixed challenge first, then adaptation
 *
 * Practice opens on the authored challenge for everybody. With no responses θ
 * carries no information, so an "adaptively" chosen first item would come from a
 * prior rather than from the learner — and the authored challenge is the one
 * that ships a starter program, which makes it the gentlest way in.
 *
 * Its score then seeds the session (`initialThetaFrom`), and from the second
 * item onwards the CAT engine chooses: finish something easily and something
 * harder arrives.
 *
 * Offline there is no estimator, so the sequence is the lessons in written
 * order — the same shape, labelled honestly.
 */
export function PracticeRun({ onExit }: PracticeRunProps) {
  const { challengeProvider, scoreProvider, sessionProvider } = useServices();

  const [session, setSession] = useState<SessionSnapshot>();
  const [item, setItem] = useState<NextItem>();
  const [challenge, setChallenge] = useState<Challenge>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState<string>();
  const [attempted, setAttempted] = useState(0);
  /** The fixed opener is item zero; the session starts once it is scored. */
  const [introDone, setIntroDone] = useState(false);

  // Strict Mode invokes effects twice in development; without this the app
  // would open two sessions and quietly halve the item budget.
  const started = useRef(false);

  const advance = useCallback(
    async (sessionId: string) => {
      setBusy(true);
      setChallenge(undefined);
      try {
        const next = await sessionProvider.next(sessionId);
        setItem(next);
        setChallenge(await challengeProvider.getChallenge(next.challengeId));
      } catch (reason) {
        // A bank with nothing left to serve is a finish, not a fault.
        setFinished(
          reason instanceof Error ? reason.message : 'No further challenges.',
        );
      } finally {
        setBusy(false);
      }
    },
    [challengeProvider, sessionProvider],
  );

  // Load the fixed opener. No session exists yet — it is that challenge's score
  // that decides where the session starts from.
  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    void challengeProvider
      .getChallenge(DEFAULT_CHALLENGE_ID)
      .then(setChallenge)
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error ? reason.message : 'Could not start practice.',
        ),
      );
  }, [challengeProvider]);

  const engine = useMemo(() => {
    if (!challenge) {
      return undefined;
    }
    try {
      return new SimulationEngine(challenge, scoreProvider);
    } catch {
      return undefined;
    }
  }, [challenge, scoreProvider]);

  const submit = useCallback(
    async (compiled: CompiledProgram) => {
      if (!engine) {
        return;
      }
      setBusy(true);
      try {
        // The opener: score it, seed the session with what it implies, and hand
        // over to the engine from the next item on.
        if (!introDone) {
          const score = await runHeadless(engine, compiled);
          const opened = await sessionProvider.start(
            score ? initialThetaFrom(score.completionScore) : undefined,
          );
          setSession(opened);
          setAttempted(1);
          setIntroDone(true);
          await advance(opened.sessionId);
          return;
        }

        if (!session || !item) {
          return;
        }
        // Evaluated locally for immediate feedback. The score that moves the
        // ability estimate is the server's own replay of this same IR — the
        // client never reports one.
        await runHeadless(engine, compiled);
        const outcome = await sessionProvider.respond(
          session.sessionId,
          item.itemRef,
          `practice-${session.sessionId}-${attempted}`,
        );
        setAttempted((count) => count + 1);
        setSession((current) =>
          current
            ? {
                ...current,
                theta: outcome.theta,
                standardError: outcome.standardError,
              }
            : current,
        );
        if (outcome.terminated) {
          setFinished(outcome.terminationReason ?? 'Practice complete.');
        } else {
          await advance(session.sessionId);
        }
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : 'Could not record that attempt.',
        );
      } finally {
        setBusy(false);
      }
    },
    [advance, attempted, engine, introDone, item, session, sessionProvider],
  );

  if (error) {
    return (
      <main className="bootstrap-screen" role="alert">
        <AlertTriangle size={30} />
        <p className="phase-kicker">PRACTICE</p>
        <h1>Practice could not continue</h1>
        <p>{error}</p>
        <button type="button" onClick={onExit}>
          Back to Menu
        </button>
      </main>
    );
  }

  if (finished) {
    return (
      <main className="bootstrap-screen">
        <p className="phase-kicker">PRACTICE COMPLETE</p>
        <h1>
          {attempted} challenge{attempted === 1 ? '' : 's'} done
        </h1>
        <p>{finished}</p>
        <button type="button" onClick={onExit}>
          Back to Menu
        </button>
      </main>
    );
  }

  if (!challenge || !engine) {
    return (
      <main className="bootstrap-screen">
        <LoaderCircle className="spin" size={30} />
        <p className="phase-kicker">PRACTICE</p>
        <h1>Choosing your next challenge…</h1>
      </main>
    );
  }

  return (
    <SimulationWorkbench
      challenge={challenge}
      engine={engine}
      modeLabel="PRACTICE"
      onExit={onExit}
      match={{
        hud: (
          <PracticePanel
            kind={sessionProvider.kind}
            attempted={attempted}
            theta={session?.theta ?? 0}
            intro={!introDone}
            {...(item?.expectedRemaining === undefined
              ? {}
              : { remaining: item.expectedRemaining })}
            busy={busy}
          />
        ),
        canSubmit: !busy,
        submitting: busy,
        onSubmit: (compiled) => void submit(compiled),
      }}
    />
  );
}

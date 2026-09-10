import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Infinity as InfinityIcon,
  LoaderCircle,
} from 'lucide-react';
import { useServices } from '../../app/servicesContext';
import type { ProgrammingMode } from '../blockly/programmingMode';
import { SimulationWorkbench } from '../../components/layout/SimulationWorkbench';
import type { Challenge } from '../../types/domain';
import type { NextItem, SessionSnapshot } from '../../types/session';
import type { CompiledProgram } from '../blockly/programTypes';
import { SimulationEngine } from '../simulation/SimulationEngine';
import { runHeadless } from '../simulation/headlessRun';
import { withFreshCanvas } from '../blockly/blankCanvas';
import { PracticePanel } from './PracticePanel';
import { useLocalization } from '../preferences/localization';

interface PracticeRunProps {
  onExit: () => void;
}

/**
 * Solo practice, as a progression rather than a menu.
 *
 * It used to open the head of the catalog and stop there: no "next", no sense
 * of getting anywhere. Now the *server* decides what comes next.
 *
 * # The server owns warmup and adaptation
 *
 * The CAT engine already has a warmup selector and an EAP prior. Starting with
 * a client-scored fixed opener bypassed both, seeded θ from an unpinned local
 * score, and made the first recorded response invisible to the server. A
 * session now starts before any item is served and every response follows the
 * signed itemRef path.
 *
 * Offline there is no estimator, so the sequence is the lessons in written
 * order — the same shape, labelled honestly.
 */
/**
 * How long the finished screen holds before an endless run opens the next
 * session. Shorter than the versus loop's ten seconds: there is no scoreboard
 * to read here, only a total, and a learner who wanted to stop has a button.
 */
const ENDLESS_GAP_MS = 5_000;

export function PracticeRun({ onExit }: PracticeRunProps) {
  const { t } = useLocalization();
  const { challengeProvider, scoreProvider, sessionProvider } = useServices();

  const [session, setSession] = useState<SessionSnapshot>();
  const [item, setItem] = useState<NextItem>();
  const [challenge, setChallenge] = useState<Challenge>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState<string>();
  const [attempted, setAttempted] = useState(0);
  // Kept apart from `attempted`, which resets with each session.
  const [completedTotal, setCompletedTotal] = useState(0);
  const [endless, setEndless] = useState(false);
  const [sessionsRun, setSessionsRun] = useState(1);
  const [resumeIn, setResumeIn] = useState(0);
  const [programmingMode, setProgrammingMode] = useState<ProgrammingMode>('servo');

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
        // Fresh, not merely blank: an endless run can serve the same item
        // again, and the editor remembers a canvas by challenge signature —
        // so the "next" challenge would open on the program that just solved
        // it.
        setChallenge(
          withFreshCanvas(await challengeProvider.getChallenge(next.challengeId)),
        );
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

  /*
    Open one mode-pinned session, then let its CAT selector serve item zero.

    A session is single-mode on purpose: it estimates one ability, and the same
    challenge is a different task in each mode — one Cutter Grid command crosses
    a lattice cell, one servo command drives a joint — so mixing them would
    average two abilities into a number that describes neither.
  */
  const beginSession = useCallback(async (
    mode: ProgrammingMode = programmingMode,
    { practice = false }: { practice?: boolean } = {},
  ) => {
    setFinished(undefined);
    setAttempted(0);
    try {
      const opened = await sessionProvider.start({
        programmingMode: mode,
        practice,
      });
      setSession(opened);
      await advance(opened.sessionId);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not start practice.',
      );
    }
  }, [advance, programmingMode, sessionProvider]);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    void beginSession();
  }, [beginSession]);

  /*
    Endless practice.

    A session stops on purpose: the adaptive terminator ends it once the
    ability estimate is precise enough, or at its item ceiling. That is right
    for *measuring* somebody and wrong for somebody who just wants to keep
    cutting hair, so endless does not disable the terminator — it opens a fresh
    session when the last one closes. Each session still measures honestly, and
    the running total below the ability figure is what carries across them.
  */
  useEffect(() => {
    if (!endless || !finished) {
      return;
    }
    // The deadline is a local, and every read of the clock happens inside a
    // timer callback: rendering stays pure and the effect body sets no state.
    const deadline = Date.now() + ENDLESS_GAP_MS;
    const update = () => {
      setResumeIn(Math.max(0, Math.ceil((deadline - Date.now()) / 1_000)));
    };
    const immediate = setTimeout(update, 0);
    const tick = setInterval(update, 250);
    const timer = setTimeout(() => {
      setSessionsRun((run) => run + 1);
      void beginSession(programmingMode, { practice: true });
    }, ENDLESS_GAP_MS);
    return () => {
      clearTimeout(immediate);
      clearInterval(tick);
      clearTimeout(timer);
    };
  }, [beginSession, endless, finished, programmingMode]);

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
      if (!engine || !challenge) {
        return;
      }
      setBusy(true);
      try {
        if (!session || !item) {
          return;
        }
        // Evaluated locally for immediate feedback. The score that moves the
        // ability estimate is the server's own replay of this same IR — the
        // client never reports one.
        await runHeadless(engine, compiled);

        // Hand the program over *before* recording the attempt. `respond` reads
        // the score from a submission the server has already replayed, so
        // without this it has nothing to look up and practice stops on
        // "the referenced submission has not been scored".
        const submissionId = `practice-${session.sessionId}-${attempted}`;
        await sessionProvider.submit(session.sessionId, {
          submissionId,
          challengeId: item.challengeId,
          challengeVersion: item.challengeVersion,
          program: compiled.program,
        });
        setCompletedTotal((total) => total + 1);
        const outcome = await sessionProvider.respond(
          session.sessionId,
          item.itemRef,
          submissionId,
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
    [
      advance,
      attempted,
      challenge,
      engine,
      item,
      session,
      sessionProvider,
    ],
  );

  if (error) {
    return (
      <main className="bootstrap-screen" role="alert">
        <AlertTriangle size={30} />
        <p className="phase-kicker">{t('practice')}</p>
        <h1>{t('practiceFailed')}</h1>
        <p>{error}</p>
        <button type="button" onClick={onExit}>
          {t('backToMenu')}
        </button>
      </main>
    );
  }

  if (finished) {
    return (
      <main className="bootstrap-screen">
        <p className="phase-kicker">{t('practiceComplete')}</p>
        <h1>
          {completedTotal} challenge{completedTotal === 1 ? '' : 's'} done
        </h1>
        {sessionsRun > 1 ? (
          <p className="practice-endless__runs">
            {sessionsRun} {t('practiceSessions')}
          </p>
        ) : null}
        <p>{finished}</p>

        {endless ? (
          <div className="practice-endless" data-testid="practice-endless-loop">
            <p className="practice-endless__countdown">
              {t('nextChallengeIn')} <strong>{resumeIn}s</strong>
            </p>
            <button
              type="button"
              data-testid="practice-endless-stop"
              onClick={() => setEndless(false)}
            >
              {t('stopLoop')}
            </button>
          </div>
        ) : (
          <div className="practice-endless">
            <button
              type="button"
              className="practice-endless__go"
              data-testid="practice-endless-start"
              onClick={() => {
                setEndless(true);
                setSessionsRun((run) => run + 1);
                void beginSession(programmingMode, { practice: true });
              }}
            >
              <InfinityIcon size={15} />
              {t('keepPractising')}
            </button>
            <button
              type="button"
              data-testid="practice-switch-mode"
              onClick={() => {
                const next: ProgrammingMode =
                  programmingMode === 'servo' ? 'cutter-grid' : 'servo';
                setProgrammingMode(next);
                setSessionsRun((run) => run + 1);
                void beginSession(next);
              }}
            >
              {programmingMode === 'servo'
                ? t('cutterGridMode')
                : t('servoAnglesMode')}
            </button>
            <button type="button" onClick={onExit}>
              {t('backToMenu')}
            </button>
          </div>
        )}
      </main>
    );
  }

  if (!challenge || !engine) {
    return (
      <main className="bootstrap-screen">
        <LoaderCircle className="spin" size={30} />
        <p className="phase-kicker">{t('practice')}</p>
        <h1>{t('choosingChallenge')}</h1>
      </main>
    );
  }

  return (
    <SimulationWorkbench
      challenge={challenge}
      engine={engine}
      modeLabel={t('practice')}
      onExit={onExit}
      availableProgrammingModes={[programmingMode]}
      cutterGridPlannerMode={
        sessionProvider.kind === 'adaptive' ? 'remote' : 'local'
      }
      challengeVersion={item?.challengeVersion ?? 1}
      match={{
        hud: (
          <PracticePanel
            kind={sessionProvider.kind}
            attempted={attempted}
            theta={session?.theta ?? 0}
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

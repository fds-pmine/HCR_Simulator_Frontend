import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { useServices } from '../../app/servicesContext';
import { SimulationWorkbench } from '../../components/layout/SimulationWorkbench';
import type { Challenge } from '../../types/domain';
import type { NextItem, SessionSnapshot } from '../../types/session';
import type { CompiledProgram } from '../blockly/programTypes';
import { SimulationEngine } from '../simulation/SimulationEngine';
import { runHeadless } from '../simulation/headlessRun';
import { withBlankCanvas } from '../blockly/blankCanvas';
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
        setChallenge(
          withBlankCanvas(await challengeProvider.getChallenge(next.challengeId)),
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

  // Open one mode-pinned session, then let its CAT selector serve item zero.
  // Cutter Grid remains unavailable here until V4 submissions are accepted by
  // the backend; planning alone is not an authoritative CAT response.
  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    void sessionProvider
      .start({ programmingMode: 'servo' })
      .then(async (opened) => {
        setSession(opened);
        await advance(opened.sessionId);
      })
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error ? reason.message : 'Could not start practice.',
        );
      });
  }, [advance, sessionProvider]);

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
          {attempted} challenge{attempted === 1 ? '' : 's'} done
        </h1>
        <p>{finished}</p>
        <button type="button" onClick={onExit}>
          {t('backToMenu')}
        </button>
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
      availableProgrammingModes={['servo']}
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

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, LoaderCircle, RotateCcw } from 'lucide-react';
import type { Challenge } from '../types/domain';
import { SimulationEngine } from '../features/simulation/SimulationEngine';
import { SimulationWorkbench } from '../components/layout/SimulationWorkbench';
import { useServices } from './servicesContext';
import { useLocalization } from '../features/preferences/localization';

interface WorkbenchBootstrapProps {
  /** Which challenge to open. Falls back to the head of the listing. */
  challengeId?: string;
  /** Return to the menu. Absent when the workbench is the whole app. */
  onExit?: () => void;
}

export function WorkbenchBootstrap({
  challengeId,
  onExit,
}: WorkbenchBootstrapProps = {}) {
  const { t } = useLocalization();
  const { challengeProvider, scoreProvider } = useServices();
  const [challenge, setChallenge] = useState<Challenge>();
  const [error, setError] = useState<string>();
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let active = true;

    void challengeProvider
      .listChallenges()
      .then((summaries) => {
        // A caller that named one wins. Otherwise fall back to the head of the
        // listing, whose order is contractual — authored first, then generated
        // (`hcr-backend/docs/01-CONTRACT.md` §3.2).
        const chosen = challengeId ?? summaries[0]?.id;
        if (!chosen) {
          throw new Error('The challenge list is empty.');
        }
        return challengeProvider.getChallenge(chosen);
      })
      .then((loadedChallenge) => {
        if (active) {
          setChallenge(loadedChallenge);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : 'Failed to load the challenge.',
          );
        }
      });

    return () => {
      active = false;
    };
  }, [challengeProvider, challengeId, retryToken]);

  const engine = useMemo(
    () =>
      challenge
        ? new SimulationEngine(challenge, scoreProvider)
        : undefined,
    [challenge, scoreProvider],
  );

  if (error) {
    return (
      <main className="bootstrap-screen" role="alert">
        <AlertTriangle size={30} />
        <p className="phase-kicker">HCR / {t('programError')}</p>
        <h1>{t('practiceFailed')}</h1>
        <p>{error}</p>
        <button
          type="button"
          onClick={() => {
            setChallenge(undefined);
            setError(undefined);
            setRetryToken((token) => token + 1);
          }}
        >
          <RotateCcw size={16} />
          {t('retry')}
        </button>
      </main>
    );
  }

  if (!challenge || !engine) {
    return (
      <main className="bootstrap-screen">
        <LoaderCircle className="spin" size={30} />
        <p className="phase-kicker">HCR / {t('local')}</p>
        <h1>HCR Simulator</h1>
        <p>{t('loading')}…</p>
      </main>
    );
  }

  return (
    <SimulationWorkbench
      challenge={challenge}
      engine={engine}
      modeLabel="SOLO"
      {...(onExit ? { onExit } : {})}
    />
  );
}

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, LoaderCircle, RotateCcw } from 'lucide-react';
import type { Challenge } from '../types/domain';
import { SimulationEngine } from '../features/simulation/SimulationEngine';
import { SimulationWorkbench } from '../components/layout/SimulationWorkbench';
import { useServices } from './servicesContext';

interface WorkbenchBootstrapProps {
  /** Return to the menu. Absent when the workbench is the whole app. */
  onExit?: () => void;
}

export function WorkbenchBootstrap({ onExit }: WorkbenchBootstrapProps = {}) {
  const { challengeProvider, scoreProvider } = useServices();
  const [challenge, setChallenge] = useState<Challenge>();
  const [error, setError] = useState<string>();
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let active = true;

    void challengeProvider
      .listChallenges()
      .then((summaries) => {
        // The listing's order is part of the contract, not an accident:
        // hand-authored challenges lead, then generated ones
        // (`hcr-backend/docs/01-CONTRACT.md` §3.2). So the head is the
        // challenge to open on, rather than whichever id sorts first.
        const first = summaries[0];
        if (!first) {
          throw new Error('The challenge list is empty.');
        }
        return challengeProvider.getChallenge(first.id);
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
  }, [challengeProvider, retryToken]);

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
        <p className="phase-kicker">HCR / PROVIDER ERROR</p>
        <h1>Unable to Load Challenge</h1>
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
          Retry
        </button>
      </main>
    );
  }

  if (!challenge || !engine) {
    return (
      <main className="bootstrap-screen">
        <LoaderCircle className="spin" size={30} />
        <p className="phase-kicker">HCR / LOCAL PROVIDER</p>
        <h1>HCR Simulator</h1>
        <p>Loading the local challenge and simulation engine…</p>
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

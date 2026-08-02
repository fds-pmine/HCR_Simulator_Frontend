import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { SimulationWorkbench } from '../../components/layout/SimulationWorkbench';
import { LocalChallengeProvider } from '../../services/local/LocalChallengeProvider';
import { LocalScoreProvider } from '../../services/local/LocalScoreProvider';
import { DEFAULT_CHALLENGE_ID } from '../../data/challenges/defaultChallenge';
import type { Challenge } from '../../types/domain';
import type { Program } from '../blockly/programTypes';
import { SimulationEngine } from '../simulation/SimulationEngine';
import { useSimulationSnapshot } from '../simulation/useSimulationSnapshot';
import { LESSONS } from './lessons';
import { TutorialPanel } from './TutorialPanel';
import { withBlankCanvas } from '../blockly/blankCanvas';

interface TutorialRunProps {
  onExit: () => void;
}

/**
 * The guided tutorial, over the real workbench.
 *
 * Pinned to the **shipped local challenge** rather than whatever the catalog
 * serves, and to the local score provider, for two reasons: the lesson text
 * names specific angles that only mean anything against that arm's geometry and
 * head position, and a tutorial should not stop working because a backend is
 * down or because the catalog's first entry changed.
 */
export function TutorialRun({ onExit }: TutorialRunProps) {
  const [challenge, setChallenge] = useState<Challenge>();
  const [error, setError] = useState<string>();

  const [step, setStep] = useState(0);
  const [program, setProgram] = useState<Program>();
  const [blockCount, setBlockCount] = useState(0);
  const [testCount, setTestCount] = useState(0);

  useEffect(() => {
    let active = true;
    void new LocalChallengeProvider()
      .getChallenge(DEFAULT_CHALLENGE_ID)
      .then((loaded) => {
        if (active) setChallenge(loaded);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error ? reason.message : 'Failed to load the tutorial.',
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  /**
   * The challenge with its starter program removed.
   *
   * The shipped challenge opens with five blocks already placed, which would
   * satisfy "add your first command" before the learner had done anything and
   * leave the later steps editing somebody else's program. A tutorial has to
   * start from an empty canvas to be a tutorial at all.
   *
   * Only the workspace is dropped — geometry, target and scoring are the real
   * challenge's, so what is learned here transfers directly to Solo.
   */
  const blankChallenge = useMemo(
    () => (challenge ? withBlankCanvas(challenge) : undefined),
    [challenge],
  );

  const engine = useMemo(() => {
    if (!challenge) return undefined;
    try {
      return new SimulationEngine(challenge, new LocalScoreProvider());
    } catch {
      return undefined;
    }
  }, [challenge]);

  const onProgramChange = useCallback(
    (next: Program | undefined, blocks: number) => {
      setProgram(next);
      setBlockCount(blocks);
    },
    [],
  );
  const onTested = useCallback(() => setTestCount((count) => count + 1), []);

  if (error) {
    return (
      <main className="bootstrap-screen" role="alert">
        <AlertTriangle size={30} />
        <p className="phase-kicker">TUTORIAL</p>
        <h1>Could not start</h1>
        <p>{error}</p>
        <button type="button" onClick={onExit}>
          Back to Menu
        </button>
      </main>
    );
  }

  if (!blankChallenge || !engine) {
    return (
      <main className="bootstrap-screen">
        <LoaderCircle className="spin" size={30} />
        <p className="phase-kicker">TUTORIAL</p>
        <h1>Setting up…</h1>
      </main>
    );
  }

  return (
    <TutorialStage
      challenge={blankChallenge}
      engine={engine}
      step={step}
      program={program}
      blockCount={blockCount}
      testCount={testCount}
      onProgramChange={onProgramChange}
      onTested={onTested}
      onNext={() =>
        setStep((current) =>
          current + 1 >= LESSONS.length ? current : current + 1,
        )
      }
      onFinish={onExit}
      onExit={onExit}
    />
  );
}

/**
 * Split out so the engine snapshot can be subscribed to with a hook.
 *
 * `useSimulationSnapshot` needs an engine, and the engine does not exist until
 * the challenge has loaded — hooks cannot be called conditionally, so the part
 * that needs one lives below the guard rather than above it.
 */
function TutorialStage({
  challenge,
  engine,
  step,
  program,
  blockCount,
  testCount,
  onProgramChange,
  onTested,
  onNext,
  onFinish,
  onExit,
}: {
  challenge: Challenge;
  engine: SimulationEngine;
  step: number;
  program?: Program;
  blockCount: number;
  testCount: number;
  onProgramChange: (program: Program | undefined, blockCount: number) => void;
  onTested: () => void;
  onNext: () => void;
  onFinish: () => void;
  onExit: () => void;
}) {
  const snapshot = useSimulationSnapshot(engine);
  const lesson = LESSONS[step];
  const satisfied =
    lesson.done?.({ program, blockCount, snapshot, testCount }) ?? true;
  const last = step + 1 === LESSONS.length;

  return (
    <SimulationWorkbench
      challenge={challenge}
      engine={engine}
      modeLabel="TUTORIAL"
      onExit={onExit}
      tutorial={{
        panel: (
          <TutorialPanel
            key={lesson.id}
            lesson={lesson}
            index={step}
            total={LESSONS.length}
            satisfied={satisfied}
            onNext={last ? onFinish : onNext}
            onExit={onExit}
          />
        ),
        onProgramChange,
        onTested,
      }}
    />
  );
}

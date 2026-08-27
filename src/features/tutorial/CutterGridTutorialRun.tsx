import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { SimulationWorkbench } from '../../components/layout/SimulationWorkbench';
import { DEFAULT_CHALLENGE_ID } from '../../data/challenges/defaultChallenge';
import { LocalChallengeProvider } from '../../services/local/LocalChallengeProvider';
import { LocalScoreProvider } from '../../services/local/LocalScoreProvider';
import type { Challenge } from '../../types/domain';
import type { EditorCompilation } from '../blockly/editorCompilation';
import { withBlankCanvas } from '../blockly/blankCanvas';
import type { CutterGridProgramV1 } from '../cutter-grid/types';
import { SimulationEngine } from '../simulation/SimulationEngine';
import { useSimulationSnapshot } from '../simulation/useSimulationSnapshot';
import {
  CUTTER_GRID_TUTORIAL_STEPS,
  cutterGridProgramFromCompilation,
} from './cutterGridTutorial';
import { TutorialPanel } from './TutorialPanel';
import { useLocalization } from '../preferences/localization';

export function CutterGridTutorialRun({ onExit }: { onExit: () => void }) {
  const { t } = useLocalization();
  const [challenge, setChallenge] = useState<Challenge>();
  const [error, setError] = useState<string>();
  const [step, setStep] = useState(0);
  const [program, setProgram] = useState<CutterGridProgramV1>();
  const [blockCount, setBlockCount] = useState(0);
  const [testCount, setTestCount] = useState(0);

  useEffect(() => {
    let active = true;
    void new LocalChallengeProvider()
      .getChallenge(DEFAULT_CHALLENGE_ID)
      .then((loaded) => {
        if (active) setChallenge(withBlankCanvas(loaded));
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : 'Failed to load the tutorial.');
        }
      });
    return () => { active = false; };
  }, []);

  const engine = useMemo(
    () => challenge ? new SimulationEngine(challenge, new LocalScoreProvider()) : undefined,
    [challenge],
  );
  const onProgramChange = useCallback(
    (compilation: EditorCompilation | undefined, blocks: number) => {
      setProgram(cutterGridProgramFromCompilation(compilation));
      setBlockCount(blocks);
    },
    [],
  );

  if (error) {
    return (
      <main className="bootstrap-screen" role="alert">
        <AlertTriangle size={30} />
        <p className="phase-kicker">{t('gridTutorial')}</p>
        <h1>{t('programError')}</h1>
        <p>{error}</p>
        <button type="button" onClick={onExit}>{t('back')}</button>
      </main>
    );
  }
  if (!challenge || !engine) {
    return (
      <main className="bootstrap-screen">
        <LoaderCircle className="spin" size={30} />
        <p className="phase-kicker">{t('gridTutorial')}</p>
        <h1>{t('loading')}…</h1>
      </main>
    );
  }

  return (
    <CutterGridTutorialStage
      challenge={challenge}
      engine={engine}
      step={step}
      program={program}
      blockCount={blockCount}
      testCount={testCount}
      onProgramChange={onProgramChange}
      onTested={() => setTestCount((count) => count + 1)}
      onNext={() => setStep((current) => Math.min(current + 1, CUTTER_GRID_TUTORIAL_STEPS.length - 1))}
      onFinish={onExit}
      onExit={onExit}
    />
  );
}

function CutterGridTutorialStage({
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
  program?: CutterGridProgramV1;
  blockCount: number;
  testCount: number;
  onProgramChange: (compilation: EditorCompilation | undefined, blocks: number) => void;
  onTested: () => void;
  onNext: () => void;
  onFinish: () => void;
  onExit: () => void;
}) {
  const snapshot = useSimulationSnapshot(engine);
  const lesson = CUTTER_GRID_TUTORIAL_STEPS[step];
  const satisfied = lesson.done?.({ program, blockCount, snapshot, testCount }) ?? true;
  const last = step === CUTTER_GRID_TUTORIAL_STEPS.length - 1;

  return (
    <SimulationWorkbench
      challenge={challenge}
      engine={engine}
      modeLabel="CUTTER GRID TUTORIAL"
      onExit={onExit}
      availableProgrammingModes={['cutter-grid']}
      initialProgrammingMode="cutter-grid"
      tutorial={{
        panel: (
          <TutorialPanel
            key={lesson.id}
            lesson={lesson}
            index={step}
            total={CUTTER_GRID_TUTORIAL_STEPS.length}
            satisfied={satisfied}
            onNext={last ? onFinish : onNext}
            onExit={onExit}
            badge="CUTTER GRID"
          />
        ),
        onProgramChange,
        onTested,
      }}
    />
  );
}

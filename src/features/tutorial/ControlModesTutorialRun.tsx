import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { SimulationWorkbench } from '../../components/layout/SimulationWorkbench';
import { DEFAULT_CHALLENGE_ID } from '../../data/challenges/defaultChallenge';
import { LocalChallengeProvider } from '../../services/local/LocalChallengeProvider';
import { LocalScoreProvider } from '../../services/local/LocalScoreProvider';
import type { Challenge } from '../../types/domain';
import { withBlankCanvas } from '../blockly/blankCanvas';
import type { EditorCompilation } from '../blockly/editorCompilation';
import type { ProgrammingMode } from '../blockly/programmingMode';
import { programmingWorkspaceMemory } from '../blockly/workspaceMemory';
import { SimulationEngine } from '../simulation/SimulationEngine';
import { CONTROL_MODES_TUTORIAL_STEPS } from './controlModesTutorial';
import { TutorialPanel } from './TutorialPanel';
import { useLocalization } from '../preferences/localization';

export function ControlModesTutorialRun({ onExit }: { onExit: () => void }) {
  const { t } = useLocalization();
  const [challenge, setChallenge] = useState<Challenge>();
  const [error, setError] = useState<string>();
  const [step, setStep] = useState(0);
  const [compilation, setCompilation] = useState<EditorCompilation>();
  const [programmingMode, setProgrammingMode] = useState<ProgrammingMode>('cutter-grid');

  useEffect(() => {
    let active = true;
    void new LocalChallengeProvider()
      .getChallenge(DEFAULT_CHALLENGE_ID)
      .then((loaded) => {
        if (!active) return;
        const blank = withBlankCanvas(loaded);
        // The bridge demonstrates isolation, so both workspaces must start
        // empty rather than inheriting programs authored in another screen.
        programmingWorkspaceMemory.forget(blank, 'cutter-grid');
        programmingWorkspaceMemory.forget(blank, 'servo');
        setChallenge(blank);
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
    (next: EditorCompilation | undefined) => setCompilation(next),
    [],
  );

  if (error) {
    return (
      <main className="bootstrap-screen" role="alert">
        <AlertTriangle size={30} />
        <p className="phase-kicker">{t('controlModesTutorial')}</p>
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
        <p className="phase-kicker">{t('controlModesTutorial')}</p>
        <h1>{t('loading')}…</h1>
      </main>
    );
  }

  const lesson = CONTROL_MODES_TUTORIAL_STEPS[step];
  const satisfied = lesson.done?.({ compilation, programmingMode }) ?? true;
  const last = step === CONTROL_MODES_TUTORIAL_STEPS.length - 1;

  return (
    <SimulationWorkbench
      challenge={challenge}
      engine={engine}
      modeLabel="GRID → ANGLES"
      onExit={onExit}
      availableProgrammingModes={['cutter-grid', 'servo']}
      initialProgrammingMode="cutter-grid"
      tutorial={{
        panel: (
          <TutorialPanel
            key={lesson.id}
            lesson={lesson}
            index={step}
            total={CONTROL_MODES_TUTORIAL_STEPS.length}
            satisfied={satisfied}
            onNext={last
              ? onExit
              : () => setStep((current) => current + 1)}
            onExit={onExit}
            badge="GRID → ANGLES"
          />
        ),
        onProgramChange,
        onTested: () => {},
        onProgrammingModeChange: setProgrammingMode,
      }}
    />
  );
}

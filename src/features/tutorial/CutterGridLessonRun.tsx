import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { DEFAULT_CHALLENGE_ID } from '../../data/challenges/defaultChallenge';
import { SimulationWorkbench } from '../../components/layout/SimulationWorkbench';
import { LocalChallengeProvider } from '../../services/local/LocalChallengeProvider';
import { LocalScoreProvider } from '../../services/local/LocalScoreProvider';
import type { Challenge } from '../../types/domain';
import { withBlankCanvas } from '../blockly/blankCanvas';
import { SimulationEngine } from '../simulation/SimulationEngine';
import { CUTTER_GRID_LESSONS } from './cutterGridLessons';
import { CutterGridLessonPanel } from './CutterGridLessonPanel';

export function CutterGridLessonRun({
  lessonId,
  onExit,
  onNext,
}: {
  lessonId: string;
  onExit: () => void;
  onNext?: () => void;
}) {
  const lesson = CUTTER_GRID_LESSONS.find((item) => item.id === lessonId);
  const lessonIndex = CUTTER_GRID_LESSONS.findIndex((item) => item.id === lessonId);
  const [sectionProgress, setSectionProgress] = useState({ lessonId, index: 0 });
  const sectionIndex = sectionProgress.lessonId === lessonId
    ? sectionProgress.index
    : 0;
  const [challenge, setChallenge] = useState<Challenge>();
  useEffect(() => {
    let active = true;
    void new LocalChallengeProvider()
      .getChallenge(DEFAULT_CHALLENGE_ID)
      .then((loaded) => {
        if (active) setChallenge(withBlankCanvas(loaded));
      });
    return () => { active = false; };
  }, []);
  const engine = useMemo(
    () =>
      challenge
        ? new SimulationEngine(challenge, new LocalScoreProvider())
        : undefined,
    [challenge],
  );
  if (!lesson) {
    return (
      <main className="bootstrap-screen" role="alert">
        <AlertTriangle size={30} />
        <h1>Could not start this Cutter Grid lesson</h1>
        <button type="button" onClick={onExit}>Back</button>
      </main>
    );
  }
  if (!challenge || !engine) {
    return (
      <main className="bootstrap-screen">
        <LoaderCircle className="spin" size={30} />
        <h1>Preparing Cutter Grid…</h1>
      </main>
    );
  }
  return (
    <SimulationWorkbench
      challenge={challenge}
      engine={engine}
      modeLabel="CUTTER GRID LESSON"
      onExit={onExit}
      availableProgrammingModes={['cutter-grid']}
      initialProgrammingMode="cutter-grid"
      tutorial={{
        panel: (
          <CutterGridLessonPanel
            lesson={lesson}
            lessonIndex={lessonIndex}
            lessonTotal={CUTTER_GRID_LESSONS.length}
            sectionIndex={sectionIndex}
            onPreviousSection={() =>
              setSectionProgress({ lessonId, index: Math.max(0, sectionIndex - 1) })
            }
            onNextSection={() =>
              setSectionProgress({
                lessonId,
                index: Math.min(lesson.sections.length - 1, sectionIndex + 1),
              })
            }
            {...(onNext ? { onNextLesson: onNext } : {})}
            onExit={onExit}
          />
        ),
        onProgramChange: () => {},
        onTested: () => {},
      }}
    />
  );
}

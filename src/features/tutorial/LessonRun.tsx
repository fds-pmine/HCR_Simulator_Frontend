import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { SimulationWorkbench } from '../../components/layout/SimulationWorkbench';
import {
  ALL_LESSONS,
  buildLessonChallenge,
  isScalpPathLesson,
  type CurriculumLesson,
} from '../../services/local/lessonChallenges';
import { LocalScoreProvider } from '../../services/local/LocalScoreProvider';
import { normalizeChallenge } from '../../services/normalizeChallenge';
import { SimulationEngine } from '../simulation/SimulationEngine';
import { useSimulationSnapshot } from '../simulation/useSimulationSnapshot';
import { LessonGoal } from './LessonGoal';

interface LessonRunProps {
  lessonId: string;
  onSolved: (lessonId: string) => void;
  /** Open the following lesson. Absent on the last one. */
  onNext?: () => void;
  onExit: () => void;
}

export function LessonRun({ lessonId, onSolved, onNext, onExit }: LessonRunProps) {
  const lesson = ALL_LESSONS.find((entry) => entry.id === lessonId);

  const built = useMemo(() => {
    if (!lesson) return undefined;
    try {
      return normalizeChallenge(buildLessonChallenge(lesson));
    } catch {
      return undefined;
    }
  }, [lesson]);

  const engine = useMemo(() => {
    if (!built) return undefined;
    try {
      return new SimulationEngine(built, new LocalScoreProvider());
    } catch {
      return undefined;
    }
  }, [built]);

  if (!lesson || !built || !engine) {
    return (
      <main className="bootstrap-screen" role="alert">
        <AlertTriangle size={30} />
        <p className="phase-kicker">LESSON</p>
        <h1>Could not start this lesson</h1>
        <button type="button" onClick={onExit}>
          Back
        </button>
      </main>
    );
  }

  return (
    <LessonStage
      lesson={lesson}
      challenge={built}
      engine={engine}
      onSolved={onSolved}
      {...(onNext ? { onNext } : {})}
      onExit={onExit}
    />
  );
}

function LessonStage({
  lesson,
  challenge,
  engine,
  onSolved,
  onNext,
  onExit,
}: {
  lesson: CurriculumLesson;
  challenge: ReturnType<typeof normalizeChallenge>;
  engine: SimulationEngine;
  onSolved: (lessonId: string) => void;
  onNext?: () => void;
  onExit: () => void;
}) {
  const snapshot = useSimulationSnapshot(engine);
  const [revealed, setRevealed] = useState(false);

  const completion = snapshot.scoreResult?.completionScore ?? 0;
  const solved = completion >= 99.995;

  // In an effect, not in the render body: `onSolved` sets state on the parent,
  // and doing that while rendering a child is exactly the "cannot update a
  // component while rendering a different component" fault.
  useEffect(() => {
    if (solved) {
      onSolved(lesson.id);
    }
  }, [solved, lesson.id, onSolved]);

  const noop = useCallback(() => {}, []);

  return (
    <SimulationWorkbench
      challenge={challenge}
      engine={engine}
      initialProgrammingMode={isScalpPathLesson(lesson) ? 'scalp-path' : 'servo'}
      modeLabel="LESSON"
      onExit={onExit}
      tutorial={{
        panel: (
          <LessonGoal
            lesson={lesson}
            completion={snapshot.scoreResult ? completion : undefined}
            solved={solved}
            revealed={revealed}
            onReveal={() => setRevealed(true)}
            {...(onNext ? { onNext } : {})}
            onExit={onExit}
          />
        ),
        onProgramChange: noop,
        onTested: noop,
      }}
    />
  );
}

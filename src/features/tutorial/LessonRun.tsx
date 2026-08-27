import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { SimulationWorkbench } from '../../components/layout/SimulationWorkbench';
import { LESSONS } from '../../data/challenges/lessons';
import { buildLessonChallenge } from '../../services/local/lessonChallenges';
import { LocalScoreProvider } from '../../services/local/LocalScoreProvider';
import { normalizeChallenge } from '../../services/normalizeChallenge';
import { SimulationEngine } from '../simulation/SimulationEngine';
import { useSimulationSnapshot } from '../simulation/useSimulationSnapshot';
import type { EditorCompilation } from '../blockly/editorCompilation';
import { LessonGoal } from './LessonGoal';
import {
  lessonSectionRequirement,
  meetsServoSectionRequirement,
} from './lessonAssessments';
import {
  loadStoredLessonState,
  saveStoredLessonState,
} from './lessonProgress';
import { useLocalization } from '../preferences/localization';

interface LessonRunProps {
  lessonId: string;
  onSolved: (lessonId: string) => void;
  /** Open the following lesson. Absent on the last one. */
  onNext?: () => void;
  onExit: () => void;
}

export function LessonRun({ lessonId, onSolved, onNext, onExit }: LessonRunProps) {
  const { t } = useLocalization();
  const lesson = LESSONS.find((entry) => entry.id === lessonId);

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
        <p className="phase-kicker">{t('lessonsHeading')}</p>
        <h1>{t('programError')}</h1>
        <button type="button" onClick={onExit}>
          {t('back')}
        </button>
      </main>
    );
  }

  return (
    <LessonStage
      key={lesson.id}
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
  lesson: (typeof LESSONS)[number];
  challenge: ReturnType<typeof normalizeChallenge>;
  engine: SimulationEngine;
  onSolved: (lessonId: string) => void;
  onNext?: () => void;
  onExit: () => void;
}) {
  const snapshot = useSimulationSnapshot(engine);
  const savedProgress = useMemo(() => loadStoredLessonState(lesson.id), [lesson.id]);
  const [sectionIndex, setSectionIndex] = useState(() =>
    Math.min(savedProgress.sectionIndex, lesson.sections.length - 1),
  );
  const [quizPassed, setQuizPassed] = useState(savedProgress.quizPassed);
  // What the workspace currently holds and how often Test has completed —
  // the evidence the build and observe sections are gated on.
  const [executedCommandCount, setExecutedCommandCount] = useState(0);
  const [testCount, setTestCount] = useState(0);

  const completion = snapshot.scoreResult?.completionScore ?? 0;
  const practicalPassed = completion >= 99.995;
  const solved = quizPassed && practicalPassed;

  // In an effect, not in the render body: `onSolved` sets state on the parent,
  // and doing that while rendering a child is exactly the "cannot update a
  // component while rendering a different component" fault.
  useEffect(() => {
    if (solved) {
      onSolved(lesson.id);
    }
  }, [solved, lesson.id, onSolved]);

  const onProgramChange = useCallback((compilation: EditorCompilation | undefined) => {
    setExecutedCommandCount(
      compilation?.mode === 'servo' ? compilation.compiled.executedCommandCount : 0,
    );
  }, []);
  const onTested = useCallback(() => setTestCount((count) => count + 1), []);
  const sectionSatisfied = meetsServoSectionRequirement(
    lessonSectionRequirement(lesson.sections[sectionIndex].activity),
    executedCommandCount,
    testCount,
  );
  const updateSection = (index: number) => {
    setSectionIndex(index);
    saveStoredLessonState(lesson.id, { sectionIndex: index, quizPassed });
  };

  return (
    <SimulationWorkbench
      challenge={challenge}
      engine={engine}
      modeLabel="LESSON"
      onExit={onExit}
      tutorial={{
        ...(sectionIndex === lesson.sections.length - 2
          ? { clearWorkspaceKey: `${lesson.id}:quiz` }
          : {}),
        panel: (
          <LessonGoal
            lesson={lesson}
            completion={snapshot.scoreResult ? completion : undefined}
            solved={solved}
            quizPassed={quizPassed}
            onQuizPassed={() => {
              setQuizPassed(true);
              saveStoredLessonState(lesson.id, { sectionIndex, quizPassed: true });
            }}
            sectionSatisfied={sectionSatisfied}
            sectionIndex={sectionIndex}
            onPreviousSection={() => updateSection(Math.max(0, sectionIndex - 1))}
            onNextSection={() =>
              updateSection(Math.min(lesson.sections.length - 1, sectionIndex + 1))
            }
            {...(onNext ? { onNext } : {})}
            onExit={onExit}
          />
        ),
        onProgramChange,
        onTested,
      }}
    />
  );
}

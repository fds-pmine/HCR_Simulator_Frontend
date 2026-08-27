import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { DEFAULT_CHALLENGE_ID } from '../../data/challenges/defaultChallenge';
import { SimulationWorkbench } from '../../components/layout/SimulationWorkbench';
import { LocalChallengeProvider } from '../../services/local/LocalChallengeProvider';
import { LocalScoreProvider } from '../../services/local/LocalScoreProvider';
import type { Challenge } from '../../types/domain';
import type { EditorCompilation } from '../blockly/editorCompilation';
import { withBlankCanvas } from '../blockly/blankCanvas';
import { SimulationEngine } from '../simulation/SimulationEngine';
import { useSimulationSnapshot } from '../simulation/useSimulationSnapshot';
import { CUTTER_GRID_LESSONS } from './cutterGridLessons';
import { CutterGridLessonPanel } from './CutterGridLessonPanel';
import { cutterGridProgramFromCompilation } from './cutterGridTutorial';
import {
  lessonSectionRequirement,
  meetsCutterGridSectionRequirement,
  passesCutterGridPractical,
} from './lessonAssessments';
import {
  loadStoredLessonState,
  saveStoredLessonState,
} from './lessonProgress';
import { useLocalization } from '../preferences/localization';

/** Structural equality, so an unchanged workspace never re-renders the run. */
function sameCutterGridProgram(
  left: ReturnType<typeof cutterGridProgramFromCompilation>,
  right: ReturnType<typeof cutterGridProgramFromCompilation>,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

export function CutterGridLessonRun({
  lessonId,
  onExit,
  onNext,
  onSolved,
}: {
  lessonId: string;
  onExit: () => void;
  onNext?: () => void;
  onSolved: (lessonId: string) => void;
}) {
  const { t } = useLocalization();
  const lesson = CUTTER_GRID_LESSONS.find((item) => item.id === lessonId);
  const lessonIndex = CUTTER_GRID_LESSONS.findIndex((item) => item.id === lessonId);
  const savedProgress = useMemo(() => loadStoredLessonState(lessonId), [lessonId]);
  const maximumSectionIndex = Math.max(0, (lesson?.sections.length ?? 1) - 1);
  const savedSectionIndex = Math.min(savedProgress.sectionIndex, maximumSectionIndex);
  const [sectionProgress, setSectionProgress] = useState({
    lessonId,
    index: savedSectionIndex,
  });
  const sectionIndex = sectionProgress.lessonId === lessonId
    ? sectionProgress.index
    : savedSectionIndex;
  const [challenge, setChallenge] = useState<Challenge>();
  const [programProgress, setProgramProgress] = useState<{
    lessonId: string;
    program: ReturnType<typeof cutterGridProgramFromCompilation>;
  }>({ lessonId, program: undefined });
  const [testProgress, setTestProgress] = useState<{
    lessonId: string;
    count: number;
    testedProgram: ReturnType<typeof cutterGridProgramFromCompilation>;
  }>({ lessonId, count: 0, testedProgram: undefined });
  const [quizProgress, setQuizProgress] = useState({
    lessonId,
    passed: savedProgress.quizPassed,
  });
  const quizPassed = quizProgress.lessonId === lessonId
    ? quizProgress.passed
    : savedProgress.quizPassed;
  // Memoized, and idempotent when the workspace has not actually changed: the
  // Workbench re-subscribes its Blockly listener whenever this identity moves,
  // and re-subscribing publishes immediately — a fresh arrow plus a fresh state
  // object turned that into an unbounded render loop.
  const onProgramChange = useCallback((compilation: EditorCompilation | undefined) => {
    const program = cutterGridProgramFromCompilation(compilation);
    setProgramProgress((current) =>
      current.lessonId === lessonId && sameCutterGridProgram(current.program, program)
        ? current
        : { lessonId, program },
    );
  }, [lessonId]);

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
  const updateSection = (index: number) => {
    setSectionProgress({ lessonId, index });
    saveStoredLessonState(lessonId, { sectionIndex: index, quizPassed });
  };
  if (!lesson) {
    return (
      <main className="bootstrap-screen" role="alert">
        <AlertTriangle size={30} />
        <h1>{t('programError')}</h1>
        <button type="button" onClick={onExit}>{t('back')}</button>
      </main>
    );
  }
  if (!challenge || !engine) {
    return (
      <main className="bootstrap-screen">
        <LoaderCircle className="spin" size={30} />
        <h1>{t('loading')}…</h1>
      </main>
    );
  }
  return (
    <CutterGridLessonStage
      lesson={lesson}
      lessonIndex={lessonIndex}
      lessonId={lessonId}
      sectionIndex={sectionIndex}
      challenge={challenge}
      engine={engine}
      program={testProgress.lessonId === lessonId ? testProgress.testedProgram : undefined}
      currentProgram={programProgress.lessonId === lessonId ? programProgress.program : undefined}
      successfulTestCount={testProgress.lessonId === lessonId ? testProgress.count : 0}
      quizPassed={quizPassed}
      onQuizPassed={() => {
        setQuizProgress({ lessonId, passed: true });
        saveStoredLessonState(lessonId, { sectionIndex, quizPassed: true });
      }}
      onProgramChange={onProgramChange}
      onTested={() => setTestProgress((current) => ({
        lessonId,
        count: current.lessonId === lessonId ? current.count + 1 : 1,
        testedProgram: programProgress.lessonId === lessonId
          ? programProgress.program
          : undefined,
      }))}
      onSolved={onSolved}
      onPreviousSection={() =>
        updateSection(Math.max(0, sectionIndex - 1))
      }
      onNextSection={() =>
        updateSection(Math.min(lesson.sections.length - 1, sectionIndex + 1))
      }
      {...(onNext ? { onNext } : {})}
      onExit={onExit}
    />
  );
}

function CutterGridLessonStage({
  lesson,
  lessonIndex,
  lessonId,
  sectionIndex,
  challenge,
  engine,
  program,
  currentProgram,
  successfulTestCount,
  quizPassed,
  onQuizPassed,
  onProgramChange,
  onTested,
  onSolved,
  onPreviousSection,
  onNextSection,
  onNext,
  onExit,
}: {
  lesson: (typeof CUTTER_GRID_LESSONS)[number];
  lessonIndex: number;
  lessonId: string;
  sectionIndex: number;
  challenge: Challenge;
  engine: SimulationEngine;
  program: ReturnType<typeof cutterGridProgramFromCompilation>;
  currentProgram: ReturnType<typeof cutterGridProgramFromCompilation>;
  successfulTestCount: number;
  quizPassed: boolean;
  onQuizPassed: () => void;
  onProgramChange: (compilation: EditorCompilation | undefined) => void;
  onTested: () => void;
  onSolved: (lessonId: string) => void;
  onPreviousSection: () => void;
  onNextSection: () => void;
  onNext?: () => void;
  onExit: () => void;
}) {
  const snapshot = useSimulationSnapshot(engine);
  const practicalPassed = passesCutterGridPractical(
    lessonId,
    program,
    successfulTestCount,
    snapshot.scoreResult?.completionScore,
    snapshot.status,
  );
  const solved = quizPassed && practicalPassed;
  // Sections that ask for a program or a Test hold Next until the learner has
  // actually done it, so a lesson cannot be clicked through unpractised.
  const section = lesson.sections[sectionIndex];
  const sectionSatisfied = meetsCutterGridSectionRequirement(
    lessonSectionRequirement(section.activity),
    lessonId,
    currentProgram,
    successfulTestCount,
  );

  useEffect(() => {
    if (solved) onSolved(lessonId);
  }, [lessonId, onSolved, solved]);

  return (
    <SimulationWorkbench
      challenge={challenge}
      engine={engine}
      modeLabel="CUTTER GRID LESSON"
      onExit={onExit}
      availableProgrammingModes={['cutter-grid']}
      initialProgrammingMode="cutter-grid"
      tutorial={{
        // Clearing is keyed, so the workspace and the engine reset exactly
        // twice: when a lesson opens, and when its quiz starts.
        //
        // Only the quiz used to clear, which meant the next lesson opened on
        // the finished program and completed run of the one before it. Several
        // practicals ask for little more than "a program that moves on two
        // axes", so the leftovers passed them: finish one lesson and the rest
        // fell over on a single Test press.
        clearWorkspaceKey: sectionIndex >= lesson.sections.length - 2
          ? `${lessonId}:quiz`
          : `${lessonId}:start`,
        panel: (
          <CutterGridLessonPanel
            lesson={lesson}
            lessonIndex={lessonIndex}
            lessonTotal={CUTTER_GRID_LESSONS.length}
            sectionIndex={sectionIndex}
            quizPassed={quizPassed}
            practicalPassed={solved}
            practicalAttempted={successfulTestCount > 0}
            sectionSatisfied={sectionSatisfied}
            onQuizPassed={onQuizPassed}
            onPreviousSection={onPreviousSection}
            onNextSection={onNextSection}
            {...(onNext ? { onNextLesson: onNext } : {})}
            onExit={onExit}
          />
        ),
        onProgramChange,
        onTested,
      }}
    />
  );
}

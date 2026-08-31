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
import { starterWorkspaceFor } from './starterWorkspace';
import {
  lessonSectionRequirement,
  meetsCutterGridSectionRequirement,
  passesCutterGridPractical,
  type LessonSectionEvidence,
} from './lessonAssessments';
import {
  loadStoredLessonState,
  saveStoredLessonState,
} from './lessonProgress';
import { useLocalization } from '../preferences/localization';

/** Records a section index once; the same section can be practised repeatedly. */
function withSection(
  sections: readonly number[],
  index: number,
): readonly number[] {
  return sections.includes(index) ? sections : [...sections, index];
}

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
  // `testedSections` and `steppedSections` are the per-section evidence the
  // observe and challenge gates read; `count` stays lesson-wide because the
  // practical only asks that the real Test path has run at all.
  const [testProgress, setTestProgress] = useState<{
    lessonId: string;
    count: number;
    testedSections: readonly number[];
    steppedSections: readonly number[];
    testedProgram: ReturnType<typeof cutterGridProgramFromCompilation>;
  }>({
    lessonId,
    count: 0,
    testedSections: [],
    steppedSections: [],
    testedProgram: undefined,
  });
  // Sections that ask the learner to read the overlay are satisfied by the
  // overlay being shown; a section already read stays satisfied if it is then
  // hidden again.
  const [overlayProgress, setOverlayProgress] = useState<{
    lessonId: string;
    visible: boolean;
    shownSections: readonly number[];
  }>({ lessonId, visible: false, shownSections: [] });
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
  // Keyed on the section as well as the lesson: the Workbench republishes the
  // overlay state whenever this identity moves, so arriving at a section with
  // the overlay already up records it, and reading it is not undone by hiding
  // the overlay again afterwards.
  const onGridOverlayChange = useCallback((visible: boolean) => {
    setOverlayProgress((current) => {
      const sameLesson = current.lessonId === lessonId;
      const shownSections = sameLesson ? current.shownSections : [];
      const next = visible ? withSection(shownSections, sectionIndex) : shownSections;
      return sameLesson && current.visible === visible && next === current.shownSections
        ? current
        : { lessonId, visible, shownSections: next };
    });
  }, [lessonId, sectionIndex]);
  const onProgramChange = useCallback((compilation: EditorCompilation | undefined) => {
    const program = cutterGridProgramFromCompilation(compilation);
    setProgramProgress((current) =>
      current.lessonId === lessonId && sameCutterGridProgram(current.program, program)
        ? current
        : { lessonId, program },
    );
  }, [lessonId]);

  const overlayVisible = overlayProgress.lessonId === lessonId
    && overlayProgress.visible;

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
      sectionEvidence={{
        tested: testProgress.lessonId === lessonId
          && testProgress.testedSections.includes(sectionIndex),
        stepped: testProgress.lessonId === lessonId
          && testProgress.steppedSections.includes(sectionIndex),
        overlayShown: overlayVisible
          || (overlayProgress.lessonId === lessonId
            && overlayProgress.shownSections.includes(sectionIndex)),
      }}
      quizPassed={quizPassed}
      onQuizPassed={() => {
        setQuizProgress({ lessonId, passed: true });
        saveStoredLessonState(lessonId, { sectionIndex, quizPassed: true });
      }}
      onProgramChange={onProgramChange}
      onGridOverlayChange={onGridOverlayChange}
      onTested={() => setTestProgress((current) => {
        const sameLesson = current.lessonId === lessonId;
        const tested = sameLesson ? current.testedSections : [];
        return {
          lessonId,
          count: sameLesson ? current.count + 1 : 1,
          testedSections: withSection(tested, sectionIndex),
          steppedSections: sameLesson ? current.steppedSections : [],
          testedProgram: programProgress.lessonId === lessonId
            ? programProgress.program
            : undefined,
        };
      })}
      onStepped={() => setTestProgress((current) => {
        const sameLesson = current.lessonId === lessonId;
        return sameLesson
          ? {
            ...current,
            steppedSections: withSection(current.steppedSections, sectionIndex),
          }
          : {
            lessonId,
            count: 0,
            testedSections: [],
            steppedSections: [sectionIndex],
            testedProgram: undefined,
          };
      })}
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
  sectionEvidence,
  quizPassed,
  onQuizPassed,
  onProgramChange,
  onGridOverlayChange,
  onTested,
  onStepped,
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
  /** What the learner has done while this very section was open. */
  sectionEvidence: LessonSectionEvidence;
  quizPassed: boolean;
  onQuizPassed: () => void;
  onProgramChange: (compilation: EditorCompilation | undefined) => void;
  onGridOverlayChange: (visible: boolean) => void;
  onTested: () => void;
  onStepped: () => void;
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
  const sectionSatisfied = meetsCutterGridSectionRequirement({
    requirement: lessonSectionRequirement(section),
    lessonId,
    expectedRoute: section.expected ?? lesson.example,
    program: currentProgram,
    evidence: sectionEvidence,
  });
  // A drill hands the learner a route to change or repair, so it seeds the
  // canvas on arrival. The key is what marks a new exercise; the quiz and the
  // closing checkpoint keep clearing it instead.
  const starter = section.starter
    ? starterWorkspaceFor(section.starter)
    : undefined;

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
        clearWorkspaceKey: starter
          ? `${lessonId}:drill-${sectionIndex}`
          : sectionIndex >= lesson.sections.length - 2
            ? `${lessonId}:quiz`
            : `${lessonId}:start`,
        ...(starter ? { starterWorkspace: starter } : {}),
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
        onGridOverlayChange,
        onTested,
        onStepped,
      }}
    />
  );
}

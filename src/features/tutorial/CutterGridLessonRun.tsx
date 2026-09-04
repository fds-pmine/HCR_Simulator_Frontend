import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useLessonTelemetry } from './lessonTelemetry';
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
    // The furthest section reached. Everything below it was released by its own
    // gate, so it stays released: going back to re-read an earlier card must
    // not make the learner earn their way forward a second time.
    furthest: savedSectionIndex,
  });
  const sameSectionLesson = sectionProgress.lessonId === lessonId;
  const sectionIndex = sameSectionLesson ? sectionProgress.index : savedSectionIndex;
  const furthestSectionIndex = sameSectionLesson
    ? sectionProgress.furthest
    : savedSectionIndex;
  const [challenge, setChallenge] = useState<Challenge>();
  // The stage is what works out that the lesson is solved, but the telemetry
  // that reports leaving lives up here — and leaving a finished lesson is not
  // the same event as giving up on one. Keyed by lesson, like every other piece
  // of progress here, so opening the next one starts unsolved.
  const [solvedLessonId, setSolvedLessonId] = useState<string>();
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
  const successfulTestCount = testProgress.lessonId === lessonId
    ? testProgress.count
    : 0;
  const reportLesson = useLessonTelemetry(lessonId, 'cutter-grid', {
    section: sectionIndex,
    tests: successfulTestCount,
    completed: solvedLessonId === lessonId,
  });
  // Where the learner is, for the one caller that must not be rebuilt when they
  // move: the stage reports solving from an effect keyed on this handler, so a
  // fresh arrow each render would call back on every render.
  const positionRef = useRef({ section: sectionIndex, tests: successfulTestCount });
  useEffect(() => {
    positionRef.current = { section: sectionIndex, tests: successfulTestCount };
  }, [sectionIndex, successfulTestCount]);
  const handleSolved = useCallback(
    (solved: string) => {
      setSolvedLessonId(solved);
      reportLesson({ outcome: 'completed', ...positionRef.current });
      onSolved(solved);
    },
    [onSolved, reportLesson],
  );

  const updateSection = (index: number) => {
    // Moving the frontier is the only move that means a gate was met: Next is
    // held closed until the section's own requirement is satisfied, while going
    // back to re-read something already passed is free and reports nothing.
    if (lesson && index > furthestSectionIndex) {
      const passed = lesson.sections[sectionIndex];
      reportLesson({
        outcome: 'section-passed',
        section: sectionIndex,
        tests: successfulTestCount,
        ...(passed ? { activity: passed.activity } : {}),
      });
    }
    setSectionProgress({
      lessonId,
      index,
      furthest: Math.max(furthestSectionIndex, index),
    });
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
      key={lessonId}
      lesson={lesson}
      lessonIndex={lessonIndex}
      lessonId={lessonId}
      sectionIndex={sectionIndex}
      furthestSectionIndex={furthestSectionIndex}
      challenge={challenge}
      engine={engine}
      program={testProgress.lessonId === lessonId ? testProgress.testedProgram : undefined}
      currentProgram={programProgress.lessonId === lessonId ? programProgress.program : undefined}
      successfulTestCount={successfulTestCount}
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
        reportLesson({
          outcome: 'quiz-passed',
          section: sectionIndex,
          tests: successfulTestCount,
        });
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
      onSolved={handleSolved}
      onPreviousSection={() =>
        updateSection(Math.max(0, sectionIndex - 1))
      }
      onNextSection={() =>
        updateSection(Math.min(lesson.sections.length - 1, sectionIndex + 1))
      }
      onSelectSection={updateSection}
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
  furthestSectionIndex,
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
  onSelectSection,
  onNext,
  onExit,
}: {
  lesson: (typeof CUTTER_GRID_LESSONS)[number];
  lessonIndex: number;
  lessonId: string;
  sectionIndex: number;
  /** The furthest section reached, so finished ones stay open to review. */
  furthestSectionIndex: number;
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
  onSelectSection: (index: number) => void;
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
  // canvas the first time that drill is opened.
  const starter = section.starter
    ? starterWorkspaceFor(section.starter)
    : undefined;

  // Clearing is keyed, so the workspace and the engine reset exactly when a new
  // exercise starts: when the lesson opens, when a drill seeds its route, and
  // when the closed-book quiz begins.
  const exerciseKey = starter
    ? `${lessonId}:drill-${sectionIndex}`
    : sectionIndex >= lesson.sections.length - 2
      ? `${lessonId}:quiz`
      : `${lessonId}:start`;
  // Each key is issued once. Deriving it from the current section alone meant
  // stepping back one card to check what the lesson said cleared the canvas,
  // and stepping forward again re-seeded the drill's broken starter — so going
  // back to look at anything cost the learner the work they had done.
  const [clearWorkspaceKey, setClearWorkspaceKey] = useState(exerciseKey);
  const issuedKeys = useRef(new Set([exerciseKey]));
  useEffect(() => {
    if (issuedKeys.current.has(exerciseKey)) return;
    issuedKeys.current.add(exerciseKey);
    setClearWorkspaceKey(exerciseKey);
  }, [exerciseKey]);

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
        // Only the quiz used to clear, which meant the next lesson opened on
        // the finished program and completed run of the one before it. Several
        // practicals ask for little more than "a program that moves on two
        // axes", so the leftovers passed them: finish one lesson and the rest
        // fell over on a single Test press.
        clearWorkspaceKey,
        ...(starter ? { starterWorkspace: starter } : {}),
        panel: (
          <CutterGridLessonPanel
            lesson={lesson}
            lessonIndex={lessonIndex}
            lessonTotal={CUTTER_GRID_LESSONS.length}
            sectionIndex={sectionIndex}
            furthestSectionIndex={furthestSectionIndex}
            quizPassed={quizPassed}
            practicalPassed={solved}
            practicalAttempted={successfulTestCount > 0}
            sectionSatisfied={sectionSatisfied || sectionIndex < furthestSectionIndex}
            onQuizPassed={onQuizPassed}
            onPreviousSection={onPreviousSection}
            onNextSection={onNextSection}
            onSelectSection={onSelectSection}
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

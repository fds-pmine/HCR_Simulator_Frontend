import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LESSONS } from '../../src/data/challenges/lessons';
import { LessonPicker } from '../../src/features/tutorial/LessonPicker';
import { LessonGoal } from '../../src/features/tutorial/LessonGoal';
import { CUTTER_GRID_LESSONS } from '../../src/features/tutorial/cutterGridLessons';
import { TutorialPicker } from '../../src/features/tutorial/TutorialPicker';
import { CutterGridLessonPanel } from '../../src/features/tutorial/CutterGridLessonPanel';
import { LocalizationProvider } from '../../src/features/preferences/localization';
import { localizeCutterGridLessons } from '../../src/features/tutorial/cutterGridLessonLocalization';
import { localizeServoLessons } from '../../src/features/tutorial/servoLessonLocalization';
import { TutorialPanel } from '../../src/features/tutorial/TutorialPanel';
import { CUTTER_GRID_TUTORIAL_STEPS } from '../../src/features/tutorial/cutterGridTutorial';

afterEach(() => {
  localStorage.removeItem('hcr.locale.v1');
});

describe('lesson picker', () => {
  it('lists every lesson without exposing solution block counts', () => {
    const completed = new Set([
      ...CUTTER_GRID_LESSONS.map((lesson) => lesson.id),
      ...LESSONS.map((lesson) => lesson.id),
    ]);
    render(<LessonPicker completed={completed} onPick={() => {}} onBack={() => {}} />);

    for (const lesson of LESSONS) {
      expect(
        screen.getByText(lesson.name.replace(/^\d+\s·\s/, '')),
      ).toBeInTheDocument();
    }
    expect(screen.getAllByText('Quiz + Blockly practical')).toHaveLength(18);
    expect(screen.queryByText(/sections · \d+ blocks?/)).not.toBeInTheDocument();
  });

  it('reports which lesson was chosen', () => {
    const onPick = vi.fn();
    render(
      <LessonPicker
        completed={new Set(CUTTER_GRID_LESSONS.map((lesson) => lesson.id))}
        onPick={onPick}
        onBack={() => {}}
      />,
    );

    fireEvent.click(screen.getByText('First Cut'));

    expect(onPick).toHaveBeenCalledWith(LESSONS[0].id);
  });

  /**
   * Cutter Grid is taught first.
   *
   * It asks where the tool should go; Servo Angles asks which joint reaches
   * there, which is the harder question and the one the cutter answers for the
   * learner. The order is a teaching decision, so it is pinned here rather than
   * left to whichever section happens to be rendered first.
   */
  it('puts the Cutter Grid lessons before the Servo ones', () => {
    const { container } = render(
      <LessonPicker
        completed={new Set()}
        onPick={() => {}}
        onPickCutterGrid={() => {}}
        onBack={() => {}}
      />,
    );

    const rows = [...container.querySelectorAll('.lesson-row')];
    const isCutter = rows.map((row) =>
      row.classList.contains('lesson-row--cutter-grid'),
    );
    const firstServo = isCutter.indexOf(false);
    const lastCutter = isCutter.lastIndexOf(true);

    expect(lastCutter).toBeGreaterThanOrEqual(0);
    expect(firstServo).toBeGreaterThan(lastCutter);
    expect(rows).toHaveLength(CUTTER_GRID_LESSONS.length + LESSONS.length);

    // The very first thing offered is the first Cutter Grid lesson.
    expect(rows[0].textContent).toContain(
      CUTTER_GRID_LESSONS[0].name.replace(/^Grid \d+\s·\s/, ''),
    );
  });

  it('marks solved lessons', () => {
    const { container } = render(
      <LessonPicker completed={new Set([LESSONS[0].id])} onPick={() => {}} onBack={() => {}} />,
    );
    expect(container.querySelectorAll('.lesson-row.is-done')).toHaveLength(1);
  });

  it('locks the curriculum in order', () => {
    const { rerender } = render(
      <LessonPicker
        completed={new Set()}
        onPick={() => {}}
        onPickCutterGrid={() => {}}
        onBack={() => {}}
      />,
    );
    const rows = screen.getAllByRole('button').filter((button) =>
      button.classList.contains('lesson-row'),
    );
    expect(rows.filter((row) => !row.hasAttribute('disabled'))).toHaveLength(1);

    rerender(
      <LessonPicker
        completed={new Set([CUTTER_GRID_LESSONS[0].id])}
        onPick={() => {}}
        onPickCutterGrid={() => {}}
        onBack={() => {}}
      />,
    );
    const updatedRows = screen.getAllByRole('button').filter((button) =>
      button.classList.contains('lesson-row'),
    );
    expect(updatedRows.filter((row) => !row.hasAttribute('disabled'))).toHaveLength(2);
  });

  it('lists and routes all dedicated Cutter Grid lessons', () => {
    const onPickCutterGrid = vi.fn();
    render(
      <LessonPicker
        completed={new Set()}
        onPick={() => {}}
        onPickCutterGrid={onPickCutterGrid}
        onBack={() => {}}
      />,
    );

    expect(document.querySelectorAll('.lesson-row--cutter-grid')).toHaveLength(
      CUTTER_GRID_LESSONS.length,
    );
    fireEvent.click(screen.getByText('Fixed World Axes'));
    expect(onPickCutterGrid).toHaveBeenCalledWith(
      CUTTER_GRID_LESSONS[0].id,
    );
  });

  it('includes the expanded ten-lesson Cutter Grid curriculum', () => {
    expect(CUTTER_GRID_LESSONS).toHaveLength(10);
    expect(CUTTER_GRID_LESSONS.map((lesson) => lesson.id)).toEqual(
      expect.arrayContaining([
        'cutter-grid-opposites',
        'cutter-grid-wait',
        'cutter-grid-route-order',
        'cutter-grid-compress',
        'cutter-grid-certified-cut',
      ]),
    );
    expect(new Set(CUTTER_GRID_LESSONS.map((lesson) => lesson.id)).size).toBe(10);
    expect(CUTTER_GRID_LESSONS.every((lesson) => lesson.example.length > 0)).toBe(true);
    expect(
      CUTTER_GRID_LESSONS.every((lesson) => lesson.sections.length >= 20),
    ).toBe(true);
    for (const lesson of CUTTER_GRID_LESSONS) {
      expect(lesson.assessments.multipleChoice.options).toHaveLength(3);
      expect(lesson.assessments.practicalPrompt.length).toBeGreaterThan(0);
      expect(new Set(lesson.sections.map((section) => section.id)).size).toBe(
        lesson.sections.length,
      );
    }
    for (const lesson of LESSONS) {
      expect(lesson.assessments.multipleChoice.options).toHaveLength(3);
      expect(lesson.assessments.practicalPrompt.length).toBeGreaterThan(0);
    }
  });

  it('keeps the Simplified Chinese lesson lists free of English copy and Traditional-only glyphs', () => {
    const grid = localizeCutterGridLessons(CUTTER_GRID_LESSONS, 'zh-CN');
    const servo = localizeServoLessons(LESSONS, 'zh-CN');
    const visibleGridCopy = grid.flatMap((lesson) => [
      lesson.name,
      lesson.description,
      ...lesson.sections.flatMap((section) => [section.title, section.body]),
    ]).join(' ');

    expect(visibleGridCopy).not.toMatch(/[複徑簡圖運勢線髮]/);
    expect(servo[0]?.name).toBe('1 · 第一次切割');
    expect(servo[0]?.description).not.toMatch(/Every motor|First Cut/);
    expect(servo.every((lesson) => lesson.sections.length === 20)).toBe(true);

    const traditionalServo = localizeServoLessons(LESSONS, 'zh-TW');
    expect(traditionalServo[0]?.name).toBe('1 · 第一次切割');
    expect(traditionalServo[0]?.description).toContain('伺服馬達');
    expect(traditionalServo[0]?.description).not.toMatch(/Every motor|舵机/);
  });
});

describe('Cutter Grid lesson sections', () => {
  const lesson = CUTTER_GRID_LESSONS[0];

  it('localizes the lesson name, section title, and body for Traditional Chinese', () => {
    localStorage.setItem('hcr.locale.v1', 'zh-TW');
    render(
      <LocalizationProvider>
        <CutterGridLessonPanel
          lesson={lesson}
          lessonIndex={0}
          lessonTotal={CUTTER_GRID_LESSONS.length}
          sectionIndex={0}
          onPreviousSection={() => {}}
          onNextSection={() => {}}
          onNextLesson={() => {}}
          onExit={() => {}}
          quizPassed={false}
          practicalPassed={false}
          practicalAttempted={false}
          sectionSatisfied={true}
          onQuizPassed={() => {}}
        />
      </LocalizationProvider>,
    );

    expect(screen.getByText('Grid 1 · 固定世界座標軸')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '為何重要' })).toBeInTheDocument();
    expect(
      screen.getByText('認識固定世界座標系中的六個移動方向。'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Why this matters')).not.toBeInTheDocument();
  });

  it('starts at section 1 and advances within the lesson', () => {
    const onNextSection = vi.fn();
    render(
      <CutterGridLessonPanel
        lesson={lesson}
        lessonIndex={0}
        lessonTotal={CUTTER_GRID_LESSONS.length}
        sectionIndex={0}
        onPreviousSection={() => {}}
        onNextSection={onNextSection}
        onNextLesson={() => {}}
        onExit={() => {}}
        quizPassed={false}
        practicalPassed={false}
        practicalAttempted={false}
        sectionSatisfied={true}
        onQuizPassed={() => {}}
      />,
    );

    expect(screen.getByText(/Lesson 1 \/ 10 · Section 1/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Why this matters' })).toBeInTheDocument();
    expect(screen.queryByTestId('previous-grid-section')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('next-grid-section'));
    expect(onNextSection).toHaveBeenCalledOnce();
  });

  it('supports going back from a middle section', () => {
    const onPreviousSection = vi.fn();
    render(
      <CutterGridLessonPanel
        lesson={lesson}
        lessonIndex={0}
        lessonTotal={CUTTER_GRID_LESSONS.length}
        sectionIndex={7}
        onPreviousSection={onPreviousSection}
        onNextSection={() => {}}
        onNextLesson={() => {}}
        onExit={() => {}}
        quizPassed={false}
        practicalPassed={false}
        practicalAttempted={false}
        sectionSatisfied={true}
        onQuizPassed={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('previous-grid-section'));
    expect(onPreviousSection).toHaveBeenCalledOnce();
  });

  it('offers the next lesson only after the final section', () => {
    const onNextLesson = vi.fn();
    render(
      <CutterGridLessonPanel
        lesson={lesson}
        lessonIndex={0}
        lessonTotal={CUTTER_GRID_LESSONS.length}
        sectionIndex={lesson.sections.length - 1}
        onPreviousSection={() => {}}
        onNextSection={() => {}}
        onNextLesson={onNextLesson}
        onExit={() => {}}
        quizPassed
        practicalPassed
        practicalAttempted
        onQuizPassed={() => {}}
        sectionSatisfied={true}
      />,
    );
    expect(screen.queryByTestId('next-grid-section')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('next-grid-lesson'));
    expect(onNextLesson).toHaveBeenCalledOnce();
  });

  it('requires the multiple-choice check and never reveals the answer', () => {
    const onQuizPassed = vi.fn();
    const quiz = lesson.assessments.multipleChoice;
    const wrongIndex = quiz.correctOptionIndex === 0 ? 1 : 0;
    const { rerender } = render(
      <CutterGridLessonPanel
        lesson={lesson}
        lessonIndex={0}
        lessonTotal={CUTTER_GRID_LESSONS.length}
        sectionIndex={lesson.sections.length - 2}
        onPreviousSection={() => {}}
        onNextSection={() => {}}
        onNextLesson={() => {}}
        onExit={() => {}}
        quizPassed={false}
        practicalPassed={false}
        practicalAttempted={false}
        sectionSatisfied={true}
        onQuizPassed={onQuizPassed}
      />,
    );

    const next = screen.getByTestId('next-grid-section');
    expect(next).toBeDisabled();
    expect(screen.queryByTestId('previous-grid-section')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(quiz.options[wrongIndex]));
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(screen.getByRole('alert')).toHaveTextContent('try again');
    expect(onQuizPassed).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(quiz.options[quiz.correctOptionIndex]));
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(onQuizPassed).toHaveBeenCalledOnce();
    expect(screen.queryByText(/correct answer|answer is/i)).not.toBeInTheDocument();

    rerender(
      <CutterGridLessonPanel
        lesson={lesson}
        lessonIndex={0}
        lessonTotal={CUTTER_GRID_LESSONS.length}
        sectionIndex={lesson.sections.length - 2}
        onPreviousSection={() => {}}
        onNextSection={() => {}}
        onNextLesson={() => {}}
        onExit={() => {}}
        quizPassed
        practicalPassed={false}
        practicalAttempted={false}
        sectionSatisfied={true}
        onQuizPassed={onQuizPassed}
      />,
    );
    expect(screen.getByTestId('next-grid-section')).toBeEnabled();
  });

  it('keeps the next Grid lesson hidden until Blockly Test passes', () => {
    const { rerender } = render(
      <CutterGridLessonPanel
        lesson={lesson}
        lessonIndex={0}
        lessonTotal={CUTTER_GRID_LESSONS.length}
        sectionIndex={lesson.sections.length - 1}
        onPreviousSection={() => {}}
        onNextSection={() => {}}
        onNextLesson={() => {}}
        onExit={() => {}}
        quizPassed
        practicalPassed={false}
        practicalAttempted={false}
        sectionSatisfied={true}
        onQuizPassed={() => {}}
      />,
    );
    expect(screen.getByTestId('lesson-blockly-practical')).toBeInTheDocument();
    expect(screen.getByText('Press Test')).toBeInTheDocument();
    expect(screen.queryByTestId('next-grid-lesson')).not.toBeInTheDocument();

    rerender(
      <CutterGridLessonPanel
        lesson={lesson}
        lessonIndex={0}
        lessonTotal={CUTTER_GRID_LESSONS.length}
        sectionIndex={lesson.sections.length - 1}
        onPreviousSection={() => {}}
        onNextSection={() => {}}
        onNextLesson={() => {}}
        onExit={() => {}}
        quizPassed
        practicalPassed={false}
        practicalAttempted
        onQuizPassed={() => {}}
        sectionSatisfied={true}
      />,
    );
    expect(
      screen.getByText('Test complete. The program does not meet the practical requirements yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('next-grid-lesson')).not.toBeInTheDocument();

    rerender(
      <CutterGridLessonPanel
        lesson={lesson}
        lessonIndex={0}
        lessonTotal={CUTTER_GRID_LESSONS.length}
        sectionIndex={lesson.sections.length - 1}
        onPreviousSection={() => {}}
        onNextSection={() => {}}
        onNextLesson={() => {}}
        onExit={() => {}}
        quizPassed
        practicalPassed
        practicalAttempted
        onQuizPassed={() => {}}
        sectionSatisfied={true}
      />,
    );
    expect(screen.getByTestId('next-grid-lesson')).toBeEnabled();
  });
});

describe('tutorial picker', () => {
  it('routes Cutter Grid and Servo tutorials independently', () => {
    const onPickCutterGrid = vi.fn();
    const onPickServo = vi.fn();
    const onPickControlModes = vi.fn();
    render(
      <TutorialPicker
        onPickCutterGrid={onPickCutterGrid}
        onPickServo={onPickServo}
        onPickControlModes={onPickControlModes}
        onBack={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Cutter Grid tutorial/ }));
    fireEvent.click(screen.getByRole('button', { name: /Servo Angles tutorial/ }));
    fireEvent.click(screen.getByRole('button', { name: /Grid → Servo Angles/ }));
    expect(onPickCutterGrid).toHaveBeenCalledOnce();
    expect(onPickServo).toHaveBeenCalledOnce();
    expect(onPickControlModes).toHaveBeenCalledOnce();
  });

  it('localizes the dynamic Cutter Grid tutorial card', () => {
    localStorage.setItem('hcr.locale.v1', 'zh-CN');
    render(
      <LocalizationProvider>
        <TutorialPanel
          lesson={CUTTER_GRID_TUTORIAL_STEPS[0]}
          index={0}
          total={CUTTER_GRID_TUTORIAL_STEPS.length}
          satisfied
          onNext={() => {}}
          onExit={() => {}}
          badge="CUTTER GRID"
        />
      </LocalizationProvider>,
    );
    expect(screen.getByRole('heading', { name: '移动切刀，而不是逐一控制舵机' })).toBeInTheDocument();
    expect(screen.queryByText('Move the cutter, not the servos')).not.toBeInTheDocument();
  });
});

describe('practice gating', () => {
  const gridLesson = CUTTER_GRID_LESSONS[0];
  const buildSection = gridLesson.sections.findIndex(
    (section) => section.activity === 'build',
  );

  it('holds the Grid lesson on a build section until the program is there', () => {
    const onNextSection = vi.fn();
    const { rerender } = render(
      <CutterGridLessonPanel
        lesson={gridLesson}
        lessonIndex={0}
        lessonTotal={CUTTER_GRID_LESSONS.length}
        sectionIndex={buildSection}
        onPreviousSection={() => {}}
        onNextSection={onNextSection}
        onExit={() => {}}
        quizPassed={false}
        practicalPassed={false}
        practicalAttempted={false}
        sectionSatisfied={false}
        onQuizPassed={() => {}}
      />,
    );

    expect(screen.getByTestId('grid-section-requirement')).toHaveTextContent(
      'Waiting for you',
    );
    expect(screen.getByTestId('next-grid-section')).toBeDisabled();

    rerender(
      <CutterGridLessonPanel
        lesson={gridLesson}
        lessonIndex={0}
        lessonTotal={CUTTER_GRID_LESSONS.length}
        sectionIndex={buildSection}
        onPreviousSection={() => {}}
        onNextSection={onNextSection}
        onExit={() => {}}
        quizPassed={false}
        practicalPassed={false}
        practicalAttempted={false}
        sectionSatisfied
        onQuizPassed={() => {}}
      />,
    );

    expect(screen.getByTestId('next-grid-section')).toBeEnabled();
    fireEvent.click(screen.getByTestId('next-grid-section'));
    expect(onNextSection).toHaveBeenCalledTimes(1);
  });

  /**
   * A drill is checked against a route, so the panel has to name that route.
   * "Compare Left 3 with three connected Left 1 blocks" told the learner what
   * the exercise was for but never what to leave on the canvas.
   */
  it('names the route a drill section is checked against', () => {
    const drill = gridLesson.sections.findIndex(
      (section) => section.starter && section.expected,
    );
    expect(drill).toBeGreaterThan(-1);
    const section = gridLesson.sections[drill];

    render(
      <CutterGridLessonPanel
        lesson={gridLesson}
        lessonIndex={0}
        lessonTotal={CUTTER_GRID_LESSONS.length}
        sectionIndex={drill}
        quizPassed={false}
        practicalPassed={false}
        practicalAttempted={false}
        sectionSatisfied={false}
        onQuizPassed={() => {}}
        onPreviousSection={() => {}}
        onNextSection={() => {}}
        onExit={() => {}}
      />,
    );

    expect(screen.getByTestId('grid-drill-goal')).toHaveTextContent(section.expected!);
  });

  it('leaves reading sections freely navigable', () => {
    const readSection = gridLesson.sections.findIndex(
      (section) => section.activity === 'read',
    );
    render(
      <CutterGridLessonPanel
        lesson={gridLesson}
        lessonIndex={0}
        lessonTotal={CUTTER_GRID_LESSONS.length}
        sectionIndex={readSection}
        onPreviousSection={() => {}}
        onNextSection={() => {}}
        onExit={() => {}}
        quizPassed={false}
        practicalPassed={false}
        practicalAttempted={false}
        sectionSatisfied
        onQuizPassed={() => {}}
      />,
    );

    expect(screen.queryByTestId('grid-section-requirement')).not.toBeInTheDocument();
    expect(screen.getByTestId('next-grid-section')).toBeEnabled();
  });

  it('does not let a tutorial step be skipped before the engine agrees', () => {
    const step = CUTTER_GRID_TUTORIAL_STEPS.find((entry) => entry.done !== undefined);
    expect(step).toBeDefined();
    if (!step) return;
    const { rerender } = render(
      <TutorialPanel
        lesson={step}
        index={1}
        total={CUTTER_GRID_TUTORIAL_STEPS.length}
        satisfied={false}
        onNext={() => {}}
        onExit={() => {}}
      />,
    );

    expect(screen.getByTestId('tutorial-next')).toBeDisabled();
    expect(screen.queryByText('Skip step')).not.toBeInTheDocument();

    rerender(
      <TutorialPanel
        lesson={step}
        index={1}
        total={CUTTER_GRID_TUTORIAL_STEPS.length}
        satisfied
        onNext={() => {}}
        onExit={() => {}}
      />,
    );

    expect(screen.getByTestId('tutorial-next')).toBeEnabled();
  });
});

describe('lesson progression', () => {
  const lesson = LESSONS[0];

  it('does not allow returning to teaching sections after entering the quiz', () => {
    render(
      <LessonGoal
        lesson={lesson}
        completion={undefined}
        solved={false}
        quizPassed={false}
        onQuizPassed={() => {}}
        sectionSatisfied={true}
        sectionIndex={lesson.sections.length - 2}
        onPreviousSection={() => {}}
        onNextSection={() => {}}
        onExit={() => {}}
      />,
    );
    expect(screen.queryByTestId('previous-angle-section')).not.toBeInTheDocument();
    expect(screen.getByTestId('next-angle-section')).toBeDisabled();
  });

  it('offers the next lesson once solved, not just an exit', () => {
    // Without this a learner finishes lesson 1, sees only "Leave", and has to
    // go back and hunt for lesson 2 — which is how a curriculum stops being one.
    const onNext = vi.fn();
    render(
      <LessonGoal
        lesson={lesson}
        completion={100}
        solved
        quizPassed
        onQuizPassed={() => {}}
        sectionSatisfied={true}
        sectionIndex={lesson.sections.length - 1}
        onPreviousSection={() => {}}
        onNextSection={() => {}}
        onNext={onNext}
        onExit={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId('next-lesson'));
    expect(onNext).toHaveBeenCalled();
  });

  it('falls back to leaving on the final lesson', () => {
    const onExit = vi.fn();
    render(
      <LessonGoal
        lesson={LESSONS[LESSONS.length - 1]}
        completion={100}
        solved
        quizPassed
        onQuizPassed={() => {}}
        sectionSatisfied={true}
        sectionIndex={lesson.sections.length - 1}
        onPreviousSection={() => {}}
        onNextSection={() => {}}
        onExit={onExit}
      />,
    );

    expect(screen.getByTestId('next-lesson')).toHaveTextContent('Back to lessons');
    fireEvent.click(screen.getByTestId('next-lesson'));
    expect(onExit).toHaveBeenCalled();
  });

  it('never offers an answer reveal', () => {
    render(
      <LessonGoal
        lesson={lesson}
        completion={100}
        solved
        quizPassed
        onQuizPassed={() => {}}
        sectionSatisfied={true}
        sectionIndex={lesson.sections.length - 1}
        onPreviousSection={() => {}}
        onNextSection={() => {}}
        onExit={() => {}}
      />,
    );
    expect(screen.queryByText('Show me')).not.toBeInTheDocument();
  });

  it('keeps the next lesson behind the twentieth scored section', () => {
    const onNextSection = vi.fn();
    const { rerender } = render(
      <LessonGoal
        lesson={lesson}
        completion={undefined}
        solved={false}
        quizPassed={false}
        onQuizPassed={() => {}}
        sectionSatisfied={true}
        sectionIndex={0}
        onPreviousSection={() => {}}
        onNextSection={onNextSection}
        onNext={() => {}}
        onExit={() => {}}
      />,
    );
    expect(screen.getByText(/Lesson 1 \/ 8 · Section 1/)).toBeInTheDocument();
    expect(screen.queryByTestId('next-lesson')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('next-angle-section'));
    expect(onNextSection).toHaveBeenCalledOnce();

    rerender(
      <LessonGoal
        lesson={lesson}
        completion={99}
        solved={false}
        quizPassed
        onQuizPassed={() => {}}
        sectionSatisfied={true}
        sectionIndex={lesson.sections.length - 1}
        onPreviousSection={() => {}}
        onNextSection={() => {}}
        onNext={() => {}}
        onExit={() => {}}
      />,
    );
    expect(screen.getByText(/Section 20/)).toBeInTheDocument();
    expect(screen.getByText('99.0 / 100')).toBeInTheDocument();
    expect(screen.queryByTestId('next-lesson')).not.toBeInTheDocument();
  });
});

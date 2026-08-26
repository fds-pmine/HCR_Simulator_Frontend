import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LESSONS } from '../../src/data/challenges/lessons';
import { LessonPicker } from '../../src/features/tutorial/LessonPicker';
import { LessonGoal } from '../../src/features/tutorial/LessonGoal';
import { CUTTER_GRID_LESSONS } from '../../src/features/tutorial/cutterGridLessons';
import { TutorialPicker } from '../../src/features/tutorial/TutorialPicker';
import { CutterGridLessonPanel } from '../../src/features/tutorial/CutterGridLessonPanel';

describe('lesson picker', () => {
  it('lists every lesson with its block count', () => {
    render(<LessonPicker completed={new Set()} onPick={() => {}} onBack={() => {}} />);

    for (const lesson of LESSONS) {
      expect(
        screen.getByText(lesson.name.replace(/^\d+\s·\s/, '')),
      ).toBeInTheDocument();
    }
    // Three lessons are one-block: the first win, and the two precision ones
    // where the difficulty is the *angle*, not the number of commands.
    const oneBlock = LESSONS.filter((l) => l.solution.length === 1).length;
    expect(screen.getAllByText('20 sections · 1 block')).toHaveLength(oneBlock);
    expect(oneBlock).toBe(3);
  });

  it('reports which lesson was chosen', () => {
    const onPick = vi.fn();
    render(<LessonPicker completed={new Set()} onPick={onPick} onBack={() => {}} />);

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
      expect(new Set(lesson.sections.map((section) => section.id)).size).toBe(
        lesson.sections.length,
      );
    }
  });
});

describe('Cutter Grid lesson sections', () => {
  const lesson = CUTTER_GRID_LESSONS[0];

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
      />,
    );

    expect(screen.getByText(/Lesson 1 \/ 10 · Section 1 \/ 20/)).toBeInTheDocument();
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
      />,
    );
    expect(screen.queryByTestId('next-grid-section')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('next-grid-lesson'));
    expect(onNextLesson).toHaveBeenCalledOnce();
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
});

describe('lesson progression', () => {
  const lesson = LESSONS[0];

  it('offers the next lesson once solved, not just an exit', () => {
    // Without this a learner finishes lesson 1, sees only "Leave", and has to
    // go back and hunt for lesson 2 — which is how a curriculum stops being one.
    const onNext = vi.fn();
    render(
      <LessonGoal
        lesson={lesson}
        completion={100}
        solved
        revealed={false}
        onReveal={() => {}}
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
        revealed={false}
        onReveal={() => {}}
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

  it('hides the answer once the lesson is solved', () => {
    // "Show me" after the fact is just clutter.
    render(
      <LessonGoal
        lesson={lesson}
        completion={100}
        solved
        revealed={false}
        onReveal={() => {}}
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
        revealed={false}
        onReveal={() => {}}
        sectionIndex={0}
        onPreviousSection={() => {}}
        onNextSection={onNextSection}
        onNext={() => {}}
        onExit={() => {}}
      />,
    );
    expect(screen.getByText(/Lesson 1 \/ 8 · Section 1 \/ 20/)).toBeInTheDocument();
    expect(screen.queryByTestId('next-lesson')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('next-angle-section'));
    expect(onNextSection).toHaveBeenCalledOnce();

    rerender(
      <LessonGoal
        lesson={lesson}
        completion={99}
        solved={false}
        revealed={false}
        onReveal={() => {}}
        sectionIndex={lesson.sections.length - 1}
        onPreviousSection={() => {}}
        onNextSection={() => {}}
        onNext={() => {}}
        onExit={() => {}}
      />,
    );
    expect(screen.getByText(/Section 20 \/ 20/)).toBeInTheDocument();
    expect(screen.getByText('99.0 / 100')).toBeInTheDocument();
    expect(screen.queryByTestId('next-lesson')).not.toBeInTheDocument();
  });
});

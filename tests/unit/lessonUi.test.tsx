import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LESSONS } from '../../src/data/challenges/lessons';
import { LessonPicker } from '../../src/features/tutorial/LessonPicker';
import { LessonGoal } from '../../src/features/tutorial/LessonGoal';

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
    expect(screen.getAllByText('1 block')).toHaveLength(oneBlock);
    expect(oneBlock).toBe(3);
  });

  it('reports which lesson was chosen', () => {
    const onPick = vi.fn();
    render(<LessonPicker completed={new Set()} onPick={onPick} onBack={() => {}} />);

    fireEvent.click(screen.getByText('First Cut'));

    expect(onPick).toHaveBeenCalledWith(LESSONS[0].id);
  });

  it('marks solved lessons', () => {
    const { container } = render(
      <LessonPicker completed={new Set([LESSONS[0].id])} onPick={() => {}} onBack={() => {}} />,
    );
    expect(container.querySelectorAll('.lesson-row.is-done')).toHaveLength(1);
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
        onExit={() => {}}
      />,
    );
    expect(screen.queryByText('Show me')).not.toBeInTheDocument();
  });
});

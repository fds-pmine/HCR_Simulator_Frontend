import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LESSONS } from '../../src/data/challenges/lessons';
import { LessonPicker } from '../../src/features/tutorial/LessonPicker';

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

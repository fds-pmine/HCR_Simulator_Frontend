import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LESSONS } from '../../src/data/challenges/lessons';
import { SCALP_PATH_LESSONS } from '../../src/data/challenges/scalpPathLessons';
import { ALL_LESSONS } from '../../src/services/local/lessonChallenges';
import { LessonPicker } from '../../src/features/tutorial/LessonPicker';
import { LessonGoal } from '../../src/features/tutorial/LessonGoal';

describe('lesson picker', () => {
  it('lists both Servo and Scalp Path tracks', () => {
    render(<LessonPicker completed={new Set()} onPick={() => {}} onBack={() => {}} />);
    expect(screen.getAllByText('First Cut')).toHaveLength(2);
    expect(screen.getByText('Repeat a Sweep')).toBeInTheDocument();
    expect(screen.getByText(/Servo control or scalp paths/)).toBeInTheDocument();
    expect(ALL_LESSONS).toHaveLength(16);
  });

  it('reports which lesson was chosen', () => {
    const onPick = vi.fn();
    render(<LessonPicker completed={new Set()} onPick={onPick} onBack={() => {}} />);
    fireEvent.click(screen.getAllByText('First Cut')[0]);
    expect(onPick).toHaveBeenCalledWith(LESSONS[0].id);
  });

  it('marks solved lessons from either track', () => {
    const { container } = render(
      <LessonPicker
        completed={new Set([LESSONS[0].id, SCALP_PATH_LESSONS[0].id])}
        onPick={() => {}}
        onBack={() => {}}
      />,
    );
    expect(container.querySelectorAll('.lesson-row.is-done')).toHaveLength(2);
  });
});

describe('lesson progression', () => {
  it('offers the next lesson once solved', () => {
    const onNext = vi.fn();
    render(<LessonGoal lesson={LESSONS[0]} completion={100} solved revealed={false} onReveal={() => {}} onNext={onNext} onExit={() => {}} />);
    fireEvent.click(screen.getByTestId('next-lesson'));
    expect(onNext).toHaveBeenCalled();
  });

  it('renders a Servo answer and a Turtle answer in their respective tracks', () => {
    const { rerender } = render(<LessonGoal lesson={LESSONS[0]} solved={false} revealed onReveal={() => {}} onExit={() => {}} />);
    expect(screen.getByText(/baseYaw 45/)).toBeInTheDocument();
    rerender(<LessonGoal lesson={SCALP_PATH_LESSONS[0]} solved={false} revealed onReveal={() => {}} onExit={() => {}} />);
    expect(screen.getByText(/Cutter cut/)).toBeInTheDocument();
  });
});

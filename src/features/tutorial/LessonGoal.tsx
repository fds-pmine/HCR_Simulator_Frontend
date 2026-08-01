import { Check, Eye, GraduationCap, LogOut, Target } from 'lucide-react';
import type { Lesson } from '../../data/challenges/lessons';

interface LessonGoalProps {
  lesson: Lesson;
  /** Latest completion score, or `undefined` before the first run. */
  completion?: number;
  solved: boolean;
  revealed: boolean;
  onReveal: () => void;
  onExit: () => void;
}

/**
 * The goal card shown while a lesson is being solved.
 *
 * The written goal is always visible; the *program* is behind a deliberate
 * click. Showing the answer outright would turn every lesson into typing
 * practice, and hiding it entirely strands anyone who is genuinely stuck — a
 * button they choose to press is the honest middle.
 */
export function LessonGoal({
  lesson,
  completion,
  solved,
  revealed,
  onReveal,
  onExit,
}: LessonGoalProps) {
  return (
    <aside className={`tutorial ${solved ? 'is-solved' : ''}`} aria-label="Lesson goal">
      <header className="tutorial__head">
        <span className="tutorial__badge">
          <GraduationCap size={14} />
          {lesson.name.toUpperCase()}
        </span>
        <span className="tutorial__progress">
          {completion === undefined ? '—' : `${completion.toFixed(1)} / 100`}
        </span>
        <button type="button" onClick={onExit} aria-label="Leave the lesson">
          <LogOut size={15} />
        </button>
      </header>

      <h2>{solved ? 'Solved' : lesson.description}</h2>
      <p>
        <Target size={13} /> {lesson.goal}
      </p>

      {solved ? (
        <p className="tutorial__hint tutorial__hint--good">
          <Check size={13} />
          100 out of 100 — exactly the hair the target asked for, and none of the
          hair it did not.
        </p>
      ) : null}

      <div className="tutorial__foot">
        <span className={`tutorial__state ${solved ? 'is-done' : ''}`}>
          {solved ? <Check size={14} /> : <i className="tutorial__dot" />}
          {completion === undefined
            ? 'Press Test when you have a program'
            : solved
              ? 'Done'
              : 'Close — check the target outline'}
        </span>

        {revealed ? (
          <code className="lesson-answer">
            {lesson.solution
              .map((step) => `${step.jointId} ${step.angleDeg}°`)
              .join(' → ')}
          </code>
        ) : (
          <button className="ghost-button tutorial__next" type="button" onClick={onReveal}>
            <Eye size={14} />
            Show me
          </button>
        )}
      </div>
    </aside>
  );
}

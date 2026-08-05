import { ArrowRight, Check, Eye, GraduationCap, LogOut, Target } from 'lucide-react';
import type { Lesson } from '../../data/challenges/lessons';
import { describeScalpPathLessonSolution, type ScalpPathLesson } from '../../data/challenges/scalpPathLessons';
import { isScalpPathLesson } from '../../services/local/lessonChallenges';

interface LessonGoalProps {
  lesson: Lesson | ScalpPathLesson;
  /** Latest completion score, or `undefined` before the first run. */
  completion?: number;
  solved: boolean;
  revealed: boolean;
  onReveal: () => void;
  /** Advance to the next lesson. Absent on the last one. */
  onNext?: () => void;
  onExit: () => void;
}

/** The goal card shown while a blank-canvas path lesson is being solved. */
export function LessonGoal({
  lesson,
  completion,
  solved,
  revealed,
  onReveal,
  onNext,
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

        {solved ? (
          <button
            className="big-button big-button--primary tutorial__next"
            type="button"
            onClick={onNext ?? onExit}
            data-testid="next-lesson"
          >
            {onNext ? 'Next lesson' : 'Back to lessons'}
            <ArrowRight size={15} />
          </button>
        ) : revealed ? (
          <code className="lesson-answer">
            {isScalpPathLesson(lesson)
              ? describeScalpPathLessonSolution(lesson.solution.nodes)
              : lesson.solution.map((step) => `${step.jointId} ${step.angleDeg}°`).join(' → ')}
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

import { useEffect, useState } from 'react';
import { ArrowRight, Check, GraduationCap, Lightbulb, X } from 'lucide-react';
import type { Lesson } from './lessons';

type TutorialPanelLesson = Pick<Lesson, 'id' | 'title' | 'body' | 'hint'> & {
  /** Presence marks an interactive step; evaluation stays in its run component. */
  done?: unknown;
};

/** How long a learner sits on a step before the hint appears. */
const HINT_DELAY_MS = 12_000;

interface TutorialPanelProps {
  lesson: TutorialPanelLesson;
  index: number;
  total: number;
  /** Whether this step's own condition is satisfied. */
  satisfied: boolean;
  onNext: () => void;
  onExit: () => void;
  badge?: string;
}

export function TutorialPanel({
  lesson,
  index,
  total,
  satisfied,
  onNext,
  onExit,
  badge = 'TUTORIAL',
}: TutorialPanelProps) {
  // Seconds spent on the current step. Reset by keying the state to the lesson
  // rather than writing it from an effect: the step is the input, the dwell time
  // is derived from it.
  const [dwell, setDwell] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setDwell((seconds) => seconds + 1), 1_000);
    return () => clearInterval(timer);
  }, []);

  const checked = lesson.done !== undefined;
  const showHint =
    lesson.hint !== undefined && !satisfied && dwell * 1_000 > HINT_DELAY_MS;

  return (
    <aside className="tutorial" aria-label="Tutorial">
      <header className="tutorial__head">
        <span className="tutorial__badge">
          <GraduationCap size={14} />
          {badge}
        </span>
        <span className="tutorial__progress">
          {index + 1} / {total}
        </span>
        <button type="button" onClick={onExit} aria-label="Leave the tutorial">
          <X size={15} />
        </button>
      </header>

      <div className="tutorial__steps" aria-hidden="true">
        {Array.from({ length: total }, (_, step) => (
          <i key={step} className={step <= index ? 'is-reached' : ''} />
        ))}
      </div>

      <h2>{lesson.title}</h2>
      <p>{lesson.body}</p>

      {showHint ? (
        <p className="tutorial__hint">
          <Lightbulb size={13} />
          {lesson.hint}
        </p>
      ) : null}

      <div className="tutorial__foot">
        {/*
          A checked step reports whether the *engine* agrees it is done, so the
          tick cannot say "correct" about something that would not actually run.
          Next stays enabled regardless: a tutorial that traps someone on a step
          they cannot finish is worse than one they can walk out of.
        */}
        {checked ? (
          <span className={`tutorial__state ${satisfied ? 'is-done' : ''}`}>
            {satisfied ? <Check size={14} /> : <i className="tutorial__dot" />}
            {satisfied ? 'Done' : 'Waiting for you'}
          </span>
        ) : (
          <span className="tutorial__state" />
        )}

        <button
          className="big-button big-button--primary tutorial__next"
          type="button"
          onClick={onNext}
          data-testid="tutorial-next"
        >
          {index + 1 === total ? 'Finish' : satisfied ? 'Next' : 'Skip step'}
          <ArrowRight size={15} />
        </button>
      </div>
    </aside>
  );
}

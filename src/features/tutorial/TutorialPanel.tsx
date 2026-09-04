import { useEffect, useState } from 'react';
import { ArrowRight, Check, GraduationCap, Lightbulb, X } from 'lucide-react';
import type { Lesson } from './lessons';
import { useLocalization } from '../preferences/localization';
import { localizeTutorialStep } from './tutorialStepLocalization';

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
  const { locale, t } = useLocalization();
  const displayLesson = localizeTutorialStep(lesson, locale);
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
    displayLesson.hint !== undefined && !satisfied && dwell * 1_000 > HINT_DELAY_MS;

  return (
    <aside className="tutorial" aria-label={t('tutorial')}>
      <header className="tutorial__head">
        <span className="tutorial__badge">
          <GraduationCap size={14} />
          {badge}
        </span>
        <span className="tutorial__progress">
          {index + 1} / {total}
        </span>
        <button type="button" onClick={onExit} aria-label={t('back')}>
          <X size={15} />
        </button>
      </header>

      <div className="tutorial__steps" aria-hidden="true">
        {Array.from({ length: total }, (_, step) => (
          <i
            key={step}
            className={`tutorial__step ${
              step < index ? 'is-done' : step === index ? 'is-current' : ''
            }`}
          />
        ))}
      </div>

      <h2>{displayLesson.title}</h2>
      <p>{displayLesson.body}</p>

      {showHint ? (
        <p className="tutorial__hint">
          <Lightbulb size={13} />
          {displayLesson.hint}
        </p>
      ) : null}

      <div className="tutorial__foot">
        {/*
          A checked step reports whether the *engine* agrees it is done, so the
          tick cannot say "correct" about something that would not actually run.
          Next waits for that agreement: skipping the practice teaches that the
          practice is optional. Exit stays one click away in the header for
          anyone who genuinely wants out.
        */}
        {checked ? (
          <span className={`tutorial__state ${satisfied ? 'is-done' : ''}`}>
            {satisfied ? <Check size={14} /> : <i className="tutorial__dot" />}
            {satisfied ? t('done') : t('waitingForYou')}
          </span>
        ) : (
          <span className="tutorial__state" />
        )}

        <button
          className="big-button big-button--primary tutorial__next"
          type="button"
          onClick={onNext}
          disabled={checked && !satisfied}
          data-testid="tutorial-next"
        >
          {index + 1 === total ? t('finish') : t('nextAction')}
          <ArrowRight size={15} />
        </button>
      </div>
    </aside>
  );
}

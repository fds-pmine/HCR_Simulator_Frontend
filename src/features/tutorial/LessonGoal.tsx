import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  GraduationCap,
  LogOut,
} from 'lucide-react';
import type { Lesson } from '../../data/challenges/lessons';

interface LessonGoalProps {
  lesson: Lesson;
  completion?: number;
  solved: boolean;
  revealed: boolean;
  onReveal: () => void;
  sectionIndex: number;
  onPreviousSection: () => void;
  onNextSection: () => void;
  onNext?: () => void;
  onExit: () => void;
}

/** Twenty-section Servo lesson card; the final section is the scored gate. */
export function LessonGoal({
  lesson,
  completion,
  solved,
  revealed,
  onReveal,
  sectionIndex,
  onPreviousSection,
  onNextSection,
  onNext,
  onExit,
}: LessonGoalProps) {
  const section = lesson.sections[sectionIndex];
  const lastSection = sectionIndex === lesson.sections.length - 1;
  const lessonNumber = lesson.name.match(/^\d+/)?.[0] ?? '—';

  return (
    <aside
      className={`tutorial servo-lesson-card ${lastSection && solved ? 'is-solved' : ''}`}
      aria-label="Lesson goal"
    >
      <header className="tutorial__head">
        <span className="tutorial__badge">
          <GraduationCap size={14} /> SERVO ANGLES LESSON
        </span>
        <span className="tutorial__progress">
          Lesson {lessonNumber} / 8 · Section {sectionIndex + 1} / {lesson.sections.length}
        </span>
        <button type="button" onClick={onExit} aria-label="Leave the lesson">
          <LogOut size={15} />
        </button>
      </header>

      <div className="tutorial__steps" aria-label="Servo lesson section progress">
        {lesson.sections.map((entry, index) => (
          <i key={entry.id} className={index <= sectionIndex ? 'is-reached' : ''} />
        ))}
      </div>

      <p className="cutter-grid-lesson-card__lesson-name">{lesson.name}</p>
      <h2>{lastSection && solved ? 'Solved' : section.title}</h2>
      <p>{section.body}</p>
      <span className={`lesson-section-kind is-${section.activity}`}>
        {section.activity.toUpperCase()}
      </span>

      {lastSection && solved ? (
        <p className="tutorial__hint tutorial__hint--good">
          <Check size={13} />
          100 out of 100 — exactly the requested hair, with no unwanted cut.
        </p>
      ) : null}

      <div className="tutorial__foot">
        {sectionIndex > 0 ? (
          <button
            className="ghost-button lesson-section-back"
            type="button"
            onClick={onPreviousSection}
            data-testid="previous-angle-section"
          >
            <ArrowLeft size={14} /> Previous
          </button>
        ) : <span />}

        {!lastSection ? (
          <button
            className="big-button big-button--primary tutorial__next"
            type="button"
            onClick={onNextSection}
            data-testid="next-angle-section"
          >
            Next section <ArrowRight size={15} />
          </button>
        ) : solved ? (
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
            {lesson.solution
              .map((step) => `${step.jointId} ${step.angleDeg}°`)
              .join(' → ')}
          </code>
        ) : (
          <div className="servo-checkpoint-actions">
            <span className="tutorial__state">
              <i className="tutorial__dot" />
              {completion === undefined ? 'Press Test' : `${completion.toFixed(1)} / 100`}
            </span>
            <button className="ghost-button tutorial__next" type="button" onClick={onReveal}>
              <Eye size={14} /> Show me
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

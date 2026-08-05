import { ArrowLeft, Check, GraduationCap } from 'lucide-react';
import { ALL_LESSONS, isScalpPathLesson } from '../../services/local/lessonChallenges';

interface LessonPickerProps {
  /** Ids the player has scored 100 on, in this browser. */
  completed: ReadonlySet<string>;
  onPick: (lessonId: string) => void;
  onBack: () => void;
}

export function LessonPicker({ completed, onPick, onBack }: LessonPickerProps) {
  return (
    <main className="menu-screen">
      <div className="menu-screen__aura" aria-hidden="true" />

      <button className="ghost-button menu-screen__back" type="button" onClick={onBack}>
        <ArrowLeft size={15} />
        Menu
      </button>

      <header className="menu-screen__head">
        <p className="phase-kicker">
          <GraduationCap size={13} />
          LESSONS
        </p>
        <h1>Learn Servo control or scalp paths</h1>
        <p className="menu-screen__lede">
          Choose a certified Servo or Scalp Path lesson. Each track keeps its own
          Blockly language and derives targets from a solution in that language.
        </p>
      </header>

      <ol className="lesson-list">
        {ALL_LESSONS.map((lesson, index) => {
          const done = completed.has(lesson.id);
          return (
            <li key={lesson.id}>
              <button
                type="button"
                className={`lesson-row ${done ? 'is-done' : ''}`}
                onClick={() => onPick(lesson.id)}
              >
                <span className="lesson-row__index">
                  {done ? <Check size={15} /> : index + 1}
                </span>
                <span className="lesson-row__text">
                  <strong>{lesson.name.replace(/^(?:Path\s)?\d+\s·\s/, '')}</strong>
                  <small>
                    {isScalpPathLesson(lesson) ? 'SCALP PATH · ' : 'SERVO · '}
                    {lesson.description}
                  </small>
                </span>
                <span className="lesson-row__meta">
                  {isScalpPathLesson(lesson)
                    ? lesson.solution.sourceBlockCount
                    : lesson.solution.length}{' '}
                  block{(isScalpPathLesson(lesson)
                    ? lesson.solution.sourceBlockCount
                    : lesson.solution.length) === 1 ? '' : 's'}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </main>
  );
}

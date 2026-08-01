import { ArrowLeft, Check, GraduationCap } from 'lucide-react';
import { LESSONS } from '../../data/challenges/lessons';

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
        <h1>Learn to drive the arm</h1>
        <p className="menu-screen__lede">
          Eight challenges, each teaching one thing. Every one of them can be
          finished perfectly — the targets were built by running a program that
          works, not drawn by hand.
        </p>
      </header>

      <ol className="lesson-list">
        {LESSONS.map((lesson, index) => {
          // Nothing is locked, and nothing may look locked either: the first
          // version drew a padlock beside every unstarted lesson while leaving
          // them all clickable, which promises a gate that is not there. A
          // learner who wants to jump ahead and come back is still learning.
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
                  <strong>{lesson.name.replace(/^\d+\s·\s/, '')}</strong>
                  <small>{lesson.description}</small>
                </span>
                <span className="lesson-row__meta">
                  {lesson.solution.length} block
                  {lesson.solution.length === 1 ? '' : 's'}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </main>
  );
}

import { ArrowLeft, Check, GraduationCap } from 'lucide-react';
import { LESSONS } from '../../data/challenges/lessons';
import { CUTTER_GRID_LESSONS } from './cutterGridLessons';

interface LessonPickerProps {
  /** Ids the player has scored 100 on, in this browser. */
  completed: ReadonlySet<string>;
  onPick: (lessonId: string) => void;
  onPickCutterGrid?: (lessonId: string) => void;
  onBack: () => void;
}

export function LessonPicker({
  completed,
  onPick,
  onPickCutterGrid,
  onBack,
}: LessonPickerProps) {
  return (
    <main className="menu-screen">
      <div className="menu-screen__aura" aria-hidden="true" />

      <button className="ghost-button menu-screen__back" type="button" onClick={onBack}>
        <ArrowLeft size={15} />
        Menu
      </button>

      {/*
        Cutter Grid leads.

        It asks the learner to say *where the tool should go*; Servo Angles asks
        them to work out which joint reaches there, which is the harder question
        and the one the cutter answers for them. Teaching the harder mode first
        made the easy one look like a footnote, so the order now matches the
        difficulty rather than the order the two were built in.
      */}
      <header className="menu-screen__head">
        <p className="phase-kicker">
          <GraduationCap size={13} />
          LESSONS
        </p>
        <h1>Learn to drive the arm</h1>
        <p className="menu-screen__lede">
          Start with Cutter Grid — you say where the tool goes and the arm works
          out how to get there. Then Servo Angles, where you drive each joint
          yourself. Eighteen lessons with 20 sections each.
        </p>
      </header>

      <header className="menu-screen__head cutter-grid-lessons__head">
        <p className="phase-kicker">CUTTER GRID</p>
        <h2>Control the cutter in 3D space</h2>
        <p className="menu-screen__lede">
          Ten lessons with 20 sections each, from fixed axes and distance
          through route order, safe planning, and a certified complete haircut.
        </p>
      </header>
      <ol className="lesson-list">
        {CUTTER_GRID_LESSONS.map((lesson, index) => (
          <li key={lesson.id}>
            <button
              type="button"
              className="lesson-row lesson-row--cutter-grid"
              onClick={() => onPickCutterGrid?.(lesson.id)}
              disabled={!onPickCutterGrid}
            >
              <span className="lesson-row__index">G{index + 1}</span>
              <span className="lesson-row__text">
                <strong>{lesson.name.replace(/^Grid \d+\s·\s/, '')}</strong>
                <small>{lesson.description}</small>
              </span>
              <span className="lesson-row__meta">
                {lesson.sections.length} sections
              </span>
            </button>
          </li>
        ))}
      </ol>

      <header className="menu-screen__head cutter-grid-lessons__head">
        <p className="phase-kicker">SERVO ANGLES</p>
        <h2>Drive each joint yourself</h2>
        <p className="menu-screen__lede">
          Eight lessons with 20 sections each on joint control and reach. Every
          target was built by running a program that works, not drawn by hand.
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
                  {lesson.sections.length} sections · {lesson.solution.length} block
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

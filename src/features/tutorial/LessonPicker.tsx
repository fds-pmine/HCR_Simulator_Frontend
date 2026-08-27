import { ArrowLeft, Check, GraduationCap, LockKeyhole } from 'lucide-react';
import { LESSONS } from '../../data/challenges/lessons';
import { CUTTER_GRID_LESSONS } from './cutterGridLessons';
import { useLocalization } from '../preferences/localization';
import { localizeCutterGridLessons } from './cutterGridLessonLocalization';
import { localizeServoLessons } from './servoLessonLocalization';

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
  const { locale, t } = useLocalization();
  const cutterGridLessons = localizeCutterGridLessons(
    CUTTER_GRID_LESSONS,
    locale,
  );
  const servoLessons = localizeServoLessons(LESSONS, locale);
  return (
    <main className="menu-screen">
      <div className="menu-screen__aura" aria-hidden="true" />

      <button className="ghost-button menu-screen__back" type="button" onClick={onBack}>
        <ArrowLeft size={15} />
        {t('menu')}
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
          {t('lessonsHeading')}
        </p>
        <h1>{t('lessonPickerTitle')}</h1>
        <p className="menu-screen__lede">
          {t('lessonPickerBody')}
        </p>
      </header>

      <header className="menu-screen__head cutter-grid-lessons__head">
        <p className="phase-kicker">CUTTER GRID</p>
        <h2>{t('gridLessonsTitle')}</h2>
        <p className="menu-screen__lede">
          {t('gridLessonsBody')}
        </p>
      </header>
      <ol className="lesson-list">
        {cutterGridLessons.map((lesson, index) => {
          const done = completed.has(lesson.id);
          const unlocked = index === 0 || completed.has(cutterGridLessons[index - 1].id);
          return <li key={lesson.id}>
            <button
              type="button"
              className={`lesson-row lesson-row--cutter-grid ${done ? 'is-done' : ''}`}
              onClick={() => onPickCutterGrid?.(lesson.id)}
              disabled={!onPickCutterGrid || !unlocked}
              aria-label={`${lesson.name}${unlocked ? '' : ` · ${t('lockedLesson')}`}`}
            >
              <span className="lesson-row__index">
                {done ? <Check size={15} /> : unlocked ? `G${index + 1}` : <LockKeyhole size={14} />}
              </span>
              <span className="lesson-row__text">
                <strong>{lesson.name.replace(/^Grid \d+\s·\s/, '')}</strong>
                <small>{lesson.description}</small>
              </span>
              <span className="lesson-row__meta">
                {unlocked ? t('requiredAssessments') : t('lockedLesson')}
              </span>
            </button>
          </li>
        })}
      </ol>

      <header className="menu-screen__head cutter-grid-lessons__head">
        <p className="phase-kicker">SERVO ANGLES</p>
        <h2>{t('servoLessonsTitle')}</h2>
        <p className="menu-screen__lede">
          {t('servoLessonsBody')}
        </p>
      </header>

      <ol className="lesson-list">
        {servoLessons.map((lesson, index) => {
          const done = completed.has(lesson.id);
          const unlocked = index === 0
            ? completed.has(cutterGridLessons[cutterGridLessons.length - 1].id)
            : completed.has(servoLessons[index - 1].id);
          return (
            <li key={lesson.id}>
              <button
                type="button"
                className={`lesson-row ${done ? 'is-done' : ''}`}
                onClick={() => onPick(lesson.id)}
                disabled={!unlocked}
                aria-label={`${lesson.name}${unlocked ? '' : ` · ${t('lockedLesson')}`}`}
              >
                <span className="lesson-row__index">
                  {done ? <Check size={15} /> : unlocked ? index + 1 : <LockKeyhole size={14} />}
                </span>
                <span className="lesson-row__text">
                  <strong>{lesson.name.replace(/^\d+\s·\s/, '')}</strong>
                  <small>{lesson.description}</small>
                </span>
                <span className="lesson-row__meta">
                  {unlocked ? t('requiredAssessments') : t('lockedLesson')}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </main>
  );
}

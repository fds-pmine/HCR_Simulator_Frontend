import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Check,
  Eye,
  Hammer,
  LogOut,
  MessageCircleQuestion,
  RotateCcw,
} from 'lucide-react';
import type {
  CutterGridLesson,
  CutterGridLessonSection,
} from './cutterGridLessons';
import { useLocalization } from '../preferences/localization';
import { localizeCutterGridLesson } from './cutterGridLessonLocalization';
import { lessonSectionRequirement } from './lessonAssessments';
import { LessonMultipleChoice } from './LessonMultipleChoice';

const ACTIVITY_KEYS = {
  read: 'read', predict: 'predict', build: 'build', observe: 'observe',
  challenge: 'lessonChallenge', recap: 'recap',
} as const;

const ACTIVITY_ICON = {
  read: Eye,
  predict: MessageCircleQuestion,
  build: Hammer,
  observe: Eye,
  challenge: RotateCcw,
  recap: Boxes,
} satisfies Readonly<Record<CutterGridLessonSection['activity'], typeof Eye>>;

export function CutterGridLessonPanel({
  lesson,
  lessonIndex,
  lessonTotal,
  sectionIndex,
  onPreviousSection,
  onNextSection,
  onNextLesson,
  onExit,
  quizPassed,
  practicalPassed,
  practicalAttempted,
  sectionSatisfied,
  onQuizPassed,
}: {
  lesson: CutterGridLesson;
  lessonIndex: number;
  lessonTotal: number;
  sectionIndex: number;
  onPreviousSection: () => void;
  onNextSection: () => void;
  onNextLesson?: () => void;
  onExit: () => void;
  quizPassed: boolean;
  practicalPassed: boolean;
  practicalAttempted: boolean;
  /** Whether this section's own build-or-test requirement is met. */
  sectionSatisfied: boolean;
  onQuizPassed: () => void;
}) {
  const { locale, t } = useLocalization();
  const displayLesson = localizeCutterGridLesson(lesson, locale);
  const section = displayLesson.sections[sectionIndex];
  const lastSection = sectionIndex === displayLesson.sections.length - 1;
  const quizSection = sectionIndex === displayLesson.sections.length - 2;
  const ActivityIcon = ACTIVITY_ICON[section.activity];
  // The quiz and the closing practical carry their own gates below.
  const sectionRequirement = quizSection || lastSection
    ? 'none'
    : lessonSectionRequirement(section);

  return (
    <aside className="tutorial cutter-grid-lesson-card" aria-label={t('gridLessonBadge')}>
      <header className="tutorial__head">
        <span className="tutorial__badge"><Boxes size={14} /> {t('gridLessonBadge')}</span>
        <span className="tutorial__progress">
          {t('lesson')} {lessonIndex + 1} / {lessonTotal} · {t('section')} {sectionIndex + 1}
        </span>
        <button type="button" onClick={onExit} aria-label={t('backToLessons')}>
          <LogOut size={15} />
        </button>
      </header>

      <div className="tutorial__steps" aria-label={t('progress')}>
        {displayLesson.sections.map((entry, index) => (
          <i key={entry.id} className={index <= sectionIndex ? 'is-reached' : ''} />
        ))}
      </div>

      <p className="cutter-grid-lesson-card__lesson-name">{displayLesson.name}</p>
      <h2>{section.title}</h2>
      <p>{section.body}</p>
      <span className={`lesson-section-kind is-${section.activity}`}>
        <ActivityIcon size={13} /> {t(ACTIVITY_KEYS[section.activity])}
      </span>

      {/*
        A drill starts from a route already on the canvas and is checked against
        the route it wants back, so it has to say which one that is. "Compare
        Left 3 with three connected Left 1 blocks" describes the point of the
        exercise but never states what to leave in the workspace, which left the
        section impossible to finish on purpose rather than by guessing.
      */}
      {section.starter && section.expected ? (
        <p className="lesson-drill-goal" data-testid="grid-drill-goal">
          <strong>{t('buildThis')}</strong>
          <code>{section.expected}</code>
        </p>
      ) : null}

      {quizSection ? (
        <LessonMultipleChoice
          key={displayLesson.id}
          quiz={displayLesson.assessments.multipleChoice}
          passed={quizPassed}
          onPassed={onQuizPassed}
        />
      ) : null}

      {/*
        A section that asks for work reports whether the work is actually
        there, and Next stays closed until it is. Reading and predicting
        sections carry no requirement and never block.
      */}
      {sectionRequirement === 'none' ? null : (
        <span
          className={`tutorial__state ${sectionSatisfied ? 'is-done' : ''}`}
          data-testid="grid-section-requirement"
        >
          {sectionSatisfied ? <Check size={14} /> : <i className="tutorial__dot" />}
          {sectionSatisfied ? t('done') : t('waitingForYou')}
        </span>
      )}

      {lastSection ? (
        <div className="lesson-practical" data-testid="lesson-blockly-practical">
          <strong>{t('practicalRequired')}</strong>
          <p>{displayLesson.assessments.practicalPrompt}</p>
          <span className={`tutorial__state ${practicalPassed ? 'is-done' : ''}`}>
            {practicalPassed
              ? t('practicalPassed')
              : practicalAttempted
                ? t('practicalNotPassed')
                : t('pressTest')}
          </span>
        </div>
      ) : null}

      <div className="tutorial__foot">
        {sectionIndex > 0 && !quizSection ? (
          <button
            className="ghost-button lesson-section-back"
            type="button"
            onClick={onPreviousSection}
            data-testid="previous-grid-section"
          >
            <ArrowLeft size={14} /> {t('previous')}
          </button>
        ) : <span />}
        {lastSection && !practicalPassed ? null : (
          <button
            className="big-button big-button--primary tutorial__next"
            type="button"
            disabled={(quizSection && !quizPassed) || !sectionSatisfied}
            onClick={lastSection ? (onNextLesson ?? onExit) : onNextSection}
            data-testid={lastSection ? 'next-grid-lesson' : 'next-grid-section'}
          >
            {lastSection
              ? onNextLesson ? t('nextLesson') : t('backToLessons')
              : t('nextSection')}
            <ArrowRight size={15} />
          </button>
        )}
      </div>
    </aside>
  );
}

import {
  ArrowLeft,
  ArrowRight,
  Check,
  GraduationCap,
  LogOut,
} from 'lucide-react';
import type { Lesson } from '../../data/challenges/lessons';
import { useLocalization } from '../preferences/localization';
import { CardCollapseToggle } from './CardCollapse';
import { useCardCollapse } from './useCardCollapse';
import { lessonSectionRequirement } from './lessonAssessments';
import { localizeServoLesson } from './servoLessonLocalization';
import { LessonMultipleChoice } from './LessonMultipleChoice';
import { LessonRequirement } from './LessonRequirement';
import { LessonSectionProgress } from './LessonSectionProgress';
import { useIdleHint } from './useIdleHint';

/**
 * How long the room goes quiet before the goal — which states the answer —
 * appears. Thirty seconds is long enough that nobody mid-thought sees it and
 * short enough that being stuck does not become being stuck for the block.
 */
const GOAL_IDLE_MS = 30_000;

interface LessonGoalProps {
  lesson: Lesson;
  completion?: number;
  solved: boolean;
  quizPassed: boolean;
  onQuizPassed: () => void;
  /** Whether this section's own build-or-test requirement is met. */
  sectionSatisfied: boolean;
  sectionIndex: number;
  /** The furthest section reached, so finished ones stay open to review. */
  furthestSectionIndex: number;
  onPreviousSection: () => void;
  onNextSection: () => void;
  onSelectSection: (index: number) => void;
  onNext?: () => void;
  onExit: () => void;
}

/** Twenty-section Servo lesson card; the final section is the scored gate. */
export function LessonGoal({
  lesson,
  completion,
  solved,
  quizPassed,
  onQuizPassed,
  sectionSatisfied,
  sectionIndex,
  furthestSectionIndex,
  onPreviousSection,
  onNextSection,
  onSelectSection,
  onNext,
  onExit,
}: LessonGoalProps) {
  const { locale, t } = useLocalization();
  const { collapsed, toggleCollapsed } = useCardCollapse();
  const displayLesson = localizeServoLesson(lesson, locale);
  const section = displayLesson.sections[sectionIndex];
  const lastSection = sectionIndex === displayLesson.sections.length - 1;
  const quizSection = sectionIndex === displayLesson.sections.length - 2;
  // The quiz and the scored checkpoint carry their own gates below.
  const sectionRequirement = quizSection || lastSection
    ? 'none'
    : lessonSectionRequirement(section);

  // Sections 1-10 and 18 ask for nothing, so `sectionSatisfied` is trivially
  // true on them — which is most of the lesson. Reading it as "the work is
  // done" would put the answer back on screen everywhere it matters, so the
  // goal is only handed over early where there was a requirement and it was
  // met.
  const goalEarned = sectionRequirement !== 'none' && sectionSatisfied;
  const goalRevealed = useIdleHint({
    delayMs: GOAL_IDLE_MS,
    resetKey: sectionIndex,
    disabled: goalEarned,
  });
  const lessonNumber = displayLesson.name.match(/^\d+/)?.[0] ?? '—';

  return (
    <aside
      className={`tutorial servo-lesson-card ${
        lastSection && solved ? 'is-solved' : ''
      }${collapsed ? ' is-collapsed' : ''}`}
      aria-label={t('servoLessonBadge')}
    >
      <header className="tutorial__head">
        <CardCollapseToggle
          collapsed={collapsed}
          onToggle={toggleCollapsed}
          testId="toggle-servo-lesson"
        />
        <span className="tutorial__badge">
          <GraduationCap size={14} /> {t('servoLessonBadge')}
        </span>
        <span className="tutorial__progress">
          {t('lesson')} {lessonNumber} / 8 · {t('section')} {sectionIndex + 1} /{' '}
          {displayLesson.sections.length}
        </span>
        <button type="button" onClick={onExit} aria-label={t('backToLessons')}>
          <LogOut size={15} />
        </button>
      </header>

      {collapsed ? null : (
        <>
          <LessonSectionProgress
            sectionCount={displayLesson.sections.length}
            sectionIndex={sectionIndex}
            furthestIndex={furthestSectionIndex}
            {...(quizSection ? {} : { onSelectSection })}
          />

          <p className="cutter-grid-lesson-card__lesson-name">{displayLesson.name}</p>
          <h2>{lastSection && solved ? t('solved') : section.title}</h2>
          <p>{section.body}</p>
          <span className={`lesson-section-kind is-${section.activity}`}>
            {section.activity.toUpperCase()}
          </span>

          {/*
            What the lesson is actually asking for, on every section that is not
            closed-book. A section such as "Press Test and compare completion with
            your prediction" never says which program to press Test on, and the one
            card that does state it — the outcome — is eleven Next presses back.
          */}
          {quizSection || lastSection ? null : goalRevealed || goalEarned ? (
            <p className="lesson-goal-recap" data-testid="lesson-goal-recap">
              <strong>{t('thisLesson')}</strong>
              <span>{displayLesson.goal}</span>
            </p>
          ) : (
            <p className="lesson-goal-pending" data-testid="lesson-goal-pending">
              {t('goalPending')}
            </p>
          )}

          {/*
            Build and observe sections report whether the work is there, and Next
            stays closed until it is: clicking past the practice and arriving at
            the scored checkpoint having built nothing is not a lesson.
          */}
          <LessonRequirement
            requirement={sectionRequirement}
            satisfied={sectionSatisfied}
            testId="angle-section-requirement"
          />

          {quizSection ? (
            <LessonMultipleChoice
              key={displayLesson.id}
              quiz={displayLesson.assessments.multipleChoice}
              passed={quizPassed}
              onPassed={onQuizPassed}
            />
          ) : null}

          {lastSection && !solved ? (
            <div className="lesson-practical" data-testid="lesson-blockly-practical">
              <strong>{t('practicalRequired')}</strong>
              <p>{displayLesson.assessments.practicalPrompt}</p>
            </div>
          ) : null}

          {lastSection && solved ? (
            <p className="tutorial__hint tutorial__hint--good">
              <Check size={13} />
              {t('perfectLesson')}
            </p>
          ) : null}

          <div className="tutorial__foot">
            {sectionIndex > 0 && !quizSection ? (
              <button
                className="ghost-button lesson-section-back"
                type="button"
                onClick={onPreviousSection}
                data-testid="previous-angle-section"
              >
                <ArrowLeft size={14} /> {t('previous')}
              </button>
            ) : <span />}

            {!lastSection ? (
              <button
                className="big-button big-button--primary tutorial__next"
                type="button"
                disabled={(quizSection && !quizPassed) || !sectionSatisfied}
                onClick={onNextSection}
                data-testid="next-angle-section"
              >
                {t('nextSection')} <ArrowRight size={15} />
              </button>
            ) : solved ? (
              <button
                className="big-button big-button--primary tutorial__next"
                type="button"
                onClick={onNext ?? onExit}
                data-testid="next-lesson"
              >
                {onNext ? t('nextLesson') : t('backToLessons')}
                <ArrowRight size={15} />
              </button>
            ) : (
              <span className="tutorial__state">
                <i className="tutorial__dot" />
                {completion === undefined
                  ? t('pressTest')
                  : `${completion.toFixed(1)} / 100`}
              </span>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

import {
  ArrowLeft,
  ArrowRight,
  Boxes,
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

const ACTIVITY_LABEL: Readonly<Record<CutterGridLessonSection['activity'], string>> = {
  read: 'READ',
  predict: 'PREDICT',
  build: 'BUILD',
  observe: 'OBSERVE',
  challenge: 'CHALLENGE',
  recap: 'RECAP',
};

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
}: {
  lesson: CutterGridLesson;
  lessonIndex: number;
  lessonTotal: number;
  sectionIndex: number;
  onPreviousSection: () => void;
  onNextSection: () => void;
  onNextLesson?: () => void;
  onExit: () => void;
}) {
  const section = lesson.sections[sectionIndex];
  const lastSection = sectionIndex === lesson.sections.length - 1;
  const ActivityIcon = ACTIVITY_ICON[section.activity];

  return (
    <aside className="tutorial cutter-grid-lesson-card" aria-label="Cutter Grid lesson">
      <header className="tutorial__head">
        <span className="tutorial__badge"><Boxes size={14} /> CUTTER GRID LESSON</span>
        <span className="tutorial__progress">
          Lesson {lessonIndex + 1} / {lessonTotal} · Section {sectionIndex + 1} / {lesson.sections.length}
        </span>
        <button type="button" onClick={onExit} aria-label="Leave the lesson">
          <LogOut size={15} />
        </button>
      </header>

      <div className="tutorial__steps" aria-label="Lesson section progress">
        {lesson.sections.map((entry, index) => (
          <i key={entry.id} className={index <= sectionIndex ? 'is-reached' : ''} />
        ))}
      </div>

      <p className="cutter-grid-lesson-card__lesson-name">{lesson.name}</p>
      <h2>{section.title}</h2>
      <p>{section.body}</p>
      <span className={`lesson-section-kind is-${section.activity}`}>
        <ActivityIcon size={13} /> {ACTIVITY_LABEL[section.activity]}
      </span>

      <div className="tutorial__foot">
        {sectionIndex > 0 ? (
          <button
            className="ghost-button lesson-section-back"
            type="button"
            onClick={onPreviousSection}
            data-testid="previous-grid-section"
          >
            <ArrowLeft size={14} /> Previous
          </button>
        ) : <span />}
        <button
          className="big-button big-button--primary tutorial__next"
          type="button"
          onClick={lastSection ? (onNextLesson ?? onExit) : onNextSection}
          data-testid={lastSection ? 'next-grid-lesson' : 'next-grid-section'}
        >
          {lastSection
            ? onNextLesson ? 'Next lesson' : 'Back to lessons'
            : 'Next section'}
          <ArrowRight size={15} />
        </button>
      </div>
    </aside>
  );
}

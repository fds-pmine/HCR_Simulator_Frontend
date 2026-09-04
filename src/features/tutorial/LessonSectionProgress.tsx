import { Check } from 'lucide-react';
import { useLocalization } from '../preferences/localization';

/**
 * The section strip at the top of a lesson card.
 *
 * Two things it now does that the plain "reached" bar did not:
 *
 * 1. A finished section is ticked, not merely coloured. Next is gated on the
 *    section's own work, so everything before the current one is work already
 *    done, and saying so is the difference between "where am I" and "what have
 *    I got through".
 * 2. A finished section is clickable. Stepping back one card at a time to
 *    re-read what a lesson said three sections ago was the only way to check
 *    anything, and on a drill that also meant leaving the exercise. Jumping is
 *    backwards only: a section ahead still has to be earned.
 */
export function LessonSectionProgress({
  sectionCount,
  sectionIndex,
  furthestIndex,
  onSelectSection,
}: {
  sectionCount: number;
  sectionIndex: number;
  /** The furthest section reached; everything below it is complete. */
  furthestIndex: number;
  /** Absent while the learner is somewhere they must not navigate out of. */
  onSelectSection?: (index: number) => void;
}) {
  const { t } = useLocalization();
  const done = Math.min(furthestIndex, sectionCount);
  return (
    <div className="tutorial__steps" aria-label={t('progress')}>
      {Array.from({ length: sectionCount }, (_, index) => {
        const complete = index < furthestIndex;
        const state = index === sectionIndex
          ? 'is-current'
          : complete
            ? 'is-done'
            : '';
        const label = `${t('section')} ${index + 1}`;
        return onSelectSection && complete && index !== sectionIndex ? (
          <button
            key={index}
            type="button"
            className={`tutorial__step ${state}`}
            aria-label={label}
            title={label}
            data-testid={`lesson-section-${index + 1}`}
            onClick={() => onSelectSection(index)}
          />
        ) : (
          <i key={index} className={`tutorial__step ${state}`} aria-label={label} />
        );
      })}
      <span className="tutorial__steps-count">
        <Check size={11} /> {done} / {sectionCount}
      </span>
    </div>
  );
}

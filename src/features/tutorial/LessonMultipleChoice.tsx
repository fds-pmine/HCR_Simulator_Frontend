import { useState } from 'react';
import { Check, CircleHelp } from 'lucide-react';
import type { LessonMultipleChoice } from './lessonAssessments';
import { useLocalization } from '../preferences/localization';

export function LessonMultipleChoice({
  quiz,
  passed,
  onPassed,
}: {
  quiz: LessonMultipleChoice;
  passed: boolean;
  onPassed: () => void;
}) {
  const { t } = useLocalization();
  const [selected, setSelected] = useState<number>();
  const [incorrect, setIncorrect] = useState(false);

  const submit = () => {
    if (selected === undefined || passed) return;
    if (selected === quiz.correctOptionIndex) {
      setIncorrect(false);
      onPassed();
      return;
    }
    setIncorrect(true);
  };

  return (
    <fieldset className="lesson-quiz" data-testid="lesson-multiple-choice">
      <legend><CircleHelp size={15} /> {quiz.question}</legend>
      {quiz.options.map((option, index) => (
        <label key={option} className={selected === index ? 'is-selected' : ''}>
          <input
            type="radio"
            name="lesson-answer"
            checked={selected === index}
            disabled={passed}
            onChange={() => {
              setSelected(index);
              setIncorrect(false);
            }}
          />
          <span>{option}</span>
        </label>
      ))}
      <div className="lesson-quiz__actions">
        {passed ? (
          <span className="tutorial__state is-done"><Check size={14} /> {t('quizPassed')}</span>
        ) : (
          <button
            className="ghost-button"
            type="button"
            disabled={selected === undefined}
            onClick={submit}
          >
            {t('checkAnswer')}
          </button>
        )}
        {incorrect ? <span role="alert">{t('tryAgainNoAnswer')}</span> : null}
      </div>
    </fieldset>
  );
}

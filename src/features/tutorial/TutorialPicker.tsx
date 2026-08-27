import { ArrowLeft, Boxes, GraduationCap, Repeat2, SlidersHorizontal } from 'lucide-react';
import { useLocalization } from '../preferences/localization';

export function TutorialPicker({
  onPickCutterGrid,
  onPickServo,
  onPickControlModes,
  onBack,
}: {
  onPickCutterGrid: () => void;
  onPickServo: () => void;
  onPickControlModes: () => void;
  onBack: () => void;
}) {
  const { t } = useLocalization();
  return (
    <main className="menu-screen">
      <div className="menu-screen__aura" aria-hidden="true" />
      <button className="ghost-button menu-screen__back" type="button" onClick={onBack}>
        <ArrowLeft size={15} />
        {t('menu')}
      </button>

      <header className="menu-screen__head">
        <p className="phase-kicker"><GraduationCap size={13} /> {t('tutorials')}</p>
        <h1>{t('tutorialPickerTitle')}</h1>
        <p className="menu-screen__lede">
          {t('tutorialPickerBody')}
        </p>
      </header>

      <ol className="lesson-list tutorial-track-list">
        <li>
          <button type="button" className="lesson-row lesson-row--cutter-grid" onClick={onPickCutterGrid}>
            <span className="lesson-row__index"><Boxes size={16} /></span>
            <span className="lesson-row__text">
              <strong>{t('gridTutorial')}</strong>
              <small>{t('gridTutorialBody')}</small>
            </span>
            <span className="lesson-row__meta">8 {t('stepsUnit')}</span>
          </button>
        </li>
        <li>
          <button type="button" className="lesson-row tutorial-track--bridge" onClick={onPickControlModes}>
            <span className="lesson-row__index"><Repeat2 size={16} /></span>
            <span className="lesson-row__text">
              <strong>{t('controlModesTutorial')}</strong>
              <small>{t('controlModesTutorialBody')}</small>
            </span>
            <span className="lesson-row__meta">9 {t('stepsUnit')}</span>
          </button>
        </li>
        <li>
          <button type="button" className="lesson-row" onClick={onPickServo}>
            <span className="lesson-row__index"><SlidersHorizontal size={16} /></span>
            <span className="lesson-row__text">
              <strong>{t('servoTutorial')}</strong>
              <small>{t('servoTutorialBody')}</small>
            </span>
            <span className="lesson-row__meta">8 {t('stepsUnit')}</span>
          </button>
        </li>
      </ol>
    </main>
  );
}

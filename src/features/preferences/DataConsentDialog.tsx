import { useState } from 'react';
import { BarChart3, Blocks, Clock3, Languages, LockKeyhole, Settings2 } from 'lucide-react';
import {
  SUPPORTED_LOCALES,
  type AppLocale,
  useLocalization,
} from './localization';
import {
  loadResearchPreferences,
  saveResearchPreferences,
  type ResearchPreferences,
} from './researchPreferences';

interface DataConsentDialogProps {
  onClose: (preferences: ResearchPreferences) => void;
}

export function DataConsentDialog({ onClose }: DataConsentDialogProps) {
  const { locale, setLocale, t } = useLocalization();
  const [details, setDetails] = useState(false);
  const [preferences, setPreferences] = useState(() => {
    const saved = loadResearchPreferences();
    if (saved.decided) return saved;

    // The primary Participate action includes both coarse context fields. Keep
    // the first-visit settings form consistent with that action without
    // persisting or transmitting anything before the user makes a choice.
    return {
      ...saved,
      programAndScores: true,
      language: true,
      utcOffset: true,
    };
  });

  const choose = (next: Omit<ResearchPreferences, 'decided'>) => {
    const saved = saveResearchPreferences({ ...next, decided: true });
    onClose(saved);
  };

  const chooseNone = () =>
    choose({ programAndScores: false, language: false, utcOffset: false });
  return (
    <div className="consent-backdrop" role="presentation">
      <section
        className="consent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-consent-title"
      >
        <label className="consent-dialog__locale">
          <span>{t('language')}</span>
          <select
            value={locale}
            onChange={(event) => setLocale(event.target.value as AppLocale)}
          >
            {SUPPORTED_LOCALES.map((option) => (
              <option key={option.code} value={option.code}>{option.name}</option>
            ))}
          </select>
        </label>
        <p className="phase-kicker">{t('studyTitle')}</p>
        <h2 id="data-consent-title">{t('studyTitle')}</h2>
        <p>{t('studyIntro')}</p>

        {details ? (
          <div className="consent-dialog__details">
            <article>
              <LockKeyhole size={17} />
              <div>
                <strong>{t('necessaryTitle')}</strong>
                <p>{t('necessaryBody')}</p>
              </div>
              <span>{t('on')}</span>
            </article>
            <article>
              <Blocks size={17} />
              <div>
                <strong>{t('programResearchTitle')}</strong>
                <p>{t('programResearchBody')}</p>
              </div>
              <span>{t('on')}</span>
            </article>
            <label>
              <Languages size={17} />
              <div>
                <strong>{t('languageResearchTitle')}</strong>
                <p>{t('languageResearchBody')}</p>
              </div>
              <input type="checkbox" checked={preferences.language} onChange={(event) => setPreferences((current) => ({ ...current, language: event.target.checked }))} />
            </label>
            <label>
              <Clock3 size={17} />
              <div>
                <strong>{t('timezoneResearchTitle')}</strong>
                <p>{t('timezoneResearchBody')}</p>
              </div>
              <input type="checkbox" checked={preferences.utcOffset} onChange={(event) => setPreferences((current) => ({ ...current, utcOffset: event.target.checked }))} />
            </label>
            <p className="consent-dialog__never"><BarChart3 size={14} /> {t('neverCollected')}</p>
          </div>
        ) : null}

        <div className="consent-dialog__actions">
          {details ? (
            <>
              <button type="button" className="big-button" onClick={() => choose({ programAndScores: true, language: false, utcOffset: false })}>{t('necessaryOnly')}</button>
              <button type="button" className="big-button big-button--primary" onClick={() => choose({
                programAndScores: true,
                language: preferences.language,
                utcOffset: preferences.utcOffset,
              })}>{t('saveSettings')}</button>
            </>
          ) : (
            <>
              <button type="button" className="big-button" onClick={chooseNone}>
                {t('exitStudy')}
              </button>
              <button type="button" className="big-button big-button--primary" onClick={() => choose({ programAndScores: true, language: true, utcOffset: true })}>
                {t('participateStudy')}
              </button>
            </>
          )}
          <button type="button" className="ghost-button" onClick={() => setDetails((shown) => !shown)}>
            <Settings2 size={14} />
            {t('moreSettings')}
          </button>
        </div>
      </section>
    </div>
  );
}

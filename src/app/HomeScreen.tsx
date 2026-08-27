import { useState } from 'react';
import { Braces, GraduationCap, ListChecks, Scissors, Swords, Wifi, WifiOff } from 'lucide-react';
import {
  MAX_NAME_LENGTH,
  normalizeDisplayName,
  type PlayerIdentity,
} from '../features/match/identity';
import type { MatchProvider } from '../services/contracts';
import {
  SUPPORTED_LOCALES,
  type AppLocale,
  useLocalization,
} from '../features/preferences/localization';
import {
  anyResearchEnabled,
  loadResearchPreferences,
} from '../features/preferences/researchPreferences';
import { DataConsentDialog } from '../features/preferences/DataConsentDialog';

interface HomeScreenProps {
  identity: PlayerIdentity;
  kind: MatchProvider['kind'];
  onRename: (displayName: string) => void;
  onTutorial: () => void;
  onLessons: () => void;
  onSolo: () => void;
  onVersus: () => void;
}

export function HomeScreen({
  identity,
  kind,
  onRename,
  onTutorial,
  onLessons,
  onSolo,
  onVersus,
}: HomeScreenProps) {
  const [draft, setDraft] = useState(identity.displayName);
  const [researchEnabled, setResearchEnabled] = useState(
    () => anyResearchEnabled(loadResearchPreferences()),
  );
  const [showDataSettings, setShowDataSettings] = useState(
    () => kind === 'online' && !loadResearchPreferences().decided,
  );
  const { locale, setLocale, t } = useLocalization();

  return (
    <main className="home">
      <div className="home__aura" aria-hidden="true" />

      <header className="home__head">
        <div className="brand-mark brand-mark--large">
          <Braces size={24} />
        </div>
        <p className="phase-kicker">HAIRCUT CONTROL RUNTIME</p>
        <h1>HCR Simulator</h1>
        <p className="home__tagline">
          {t('tagline')}
        </p>
      </header>

      <div className="home__modes">
        <button
          className="mode-card mode-card--tutorial"
          type="button"
          onClick={onTutorial}
        >
          <span className="mode-card__icon">
            <GraduationCap size={22} />
          </span>
          <strong>{t('tutorial')}</strong>
          <span className="mode-card__body">
            {t('tutorialBody')}
          </span>
          <span className="mode-card__go">{t('learn')}</span>
        </button>

        <button
          className="mode-card mode-card--lessons"
          type="button"
          onClick={onLessons}
        >
          <span className="mode-card__icon">
            <ListChecks size={22} />
          </span>
          <strong>{t('lessons')}</strong>
          <span className="mode-card__body">
            {t('lessonsBody')}
          </span>
          <span className="mode-card__go">{t('practise')}</span>
        </button>

        <button className="mode-card mode-card--solo" type="button" onClick={onSolo}>
          <span className="mode-card__icon">
            <Scissors size={22} />
          </span>
          <strong>{t('solo')}</strong>
          <span className="mode-card__body">
            {t('soloBody')}
          </span>
          <span className="mode-card__go">{t('start')}</span>
        </button>

        <button className="mode-card mode-card--versus" type="button" onClick={onVersus}>
          <span className="mode-card__icon">
            <Swords size={22} />
          </span>
          <strong>{t('versus')}</strong>
          <span className="mode-card__body">
            {t('versusBody')}
          </span>
          <span className="mode-card__go">{t('play')}</span>
        </button>
      </div>

      <footer className="home__foot">
        <label className="name-field">
          <span>{t('player')}</span>
          <input
            value={draft}
            maxLength={MAX_NAME_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() =>
              onRename(normalizeDisplayName(draft, identity.displayName))
            }
            aria-label={t('player')}
            spellCheck={false}
          />
        </label>

        <label className="name-field locale-field">
          <span>{t('language')}</span>
          <select
            value={locale}
            onChange={(event) => setLocale(event.target.value as AppLocale)}
            aria-label={t('language')}
          >
            {SUPPORTED_LOCALES.map((option) => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
        </label>

        <span className={`link-chip link-chip--${kind}`}>
          {kind === 'online' ? <Wifi size={13} /> : <WifiOff size={13} />}
          {kind === 'online' ? t('backendConnected') : t('offlinePractice')}
        </span>
      </footer>

      {/*
        An open deployment that records play should say so where people will see
        it, not only in a document nobody opens. Offline builds send nothing
        anywhere, so the notice would be false there.
      */}
      {kind === 'online' ? (
        <section className="home__privacy" aria-label={t('dataSettings')}>
          <p className="home__notice">{t('requiredData')}</p>
          <p className="research-choice">
            <span>{t('researchChoice')}</span>
            <strong>{researchEnabled ? t('on') : t('off')}</strong>
          </p>
          <p className="research-choice__hint">{t('researchHint')}</p>
          <button type="button" className="ghost-button" onClick={() => setShowDataSettings(true)}>
            {t('dataSettings')}
          </button>
        </section>
      ) : null}

      {showDataSettings ? (
        <DataConsentDialog
          onClose={(preferences) => {
            setResearchEnabled(anyResearchEnabled(preferences));
            setShowDataSettings(false);
          }}
        />
      ) : null}
    </main>
  );
}

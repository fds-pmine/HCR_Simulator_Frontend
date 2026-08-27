import { useEffect, useState, type PropsWithChildren } from 'react';
import { ArrowLeft, DoorClosed, FileSearch } from 'lucide-react';
import { DataConsentDialog } from './DataConsentDialog';
import { useLocalization } from './localization';
import {
  loadResearchPreferences,
} from './researchPreferences';

export function ResearchParticipationGate({ children }: PropsWithChildren) {
  const { t } = useLocalization();
  const [preferences, setPreferences] = useState(loadResearchPreferences);
  const [reviewing, setReviewing] = useState(!preferences.decided);

  useEffect(() => {
    const reload = () => {
      const next = loadResearchPreferences();
      setPreferences(next);
      if (!next.programAndScores) setReviewing(false);
    };
    globalThis.addEventListener(
      'hcr:research-preferences-changed',
      reload,
    );
    return () =>
      globalThis.removeEventListener(
        'hcr:research-preferences-changed',
        reload,
      );
  }, []);

  if (preferences.programAndScores) {
    return children;
  }

  if (reviewing || !preferences.decided) {
    return (
      <main className="research-entry">
        <DataConsentDialog
          onClose={(next) => {
            setPreferences(next);
            setReviewing(false);
          }}
        />
      </main>
    );
  }

  const desktop = Boolean(window.hcrApp?.available);
  return (
    <main className="research-entry research-entry--declined">
      <section className="research-exit" role="status">
        <DoorClosed size={34} />
        <p className="phase-kicker">{t('studyTitle')}</p>
        <h1>{t('studyDeclinedTitle')}</h1>
        <p>{t('studyDeclinedBody')}</p>
        <div>
          <button
            type="button"
            className="big-button big-button--primary"
            onClick={() => setReviewing(true)}
          >
            <FileSearch size={16} />
            {t('reviewStudy')}
          </button>
          {desktop ? (
            <button
              type="button"
              className="big-button"
              onClick={() => window.hcrApp?.close()}
            >
              <DoorClosed size={16} />
              {t('closeApplication')}
            </button>
          ) : (
            <a className="big-button" href="https://hcr.rs">
              <ArrowLeft size={16} />
              hcr.rs
            </a>
          )}
        </div>
      </section>
    </main>
  );
}

import { useEffect, useState } from 'react';
import { ArrowLeft, Bot, LoaderCircle, Radio, Swords, Wifi, WifiOff } from 'lucide-react';
import type { MatchProvider } from '../../services/contracts';
import type { ChallengeSummary } from '../../types/domain';
import { useServices } from '../../app/servicesContext';
import { useLocalization } from '../preferences/localization';

interface MatchSetupProps {
  kind: MatchProvider['kind'];
  busy: boolean;
  error?: string;
  onHost: (durationMs: number, challengeId?: string) => void;
  onJoin: (code: string) => void;
  onBack: () => void;
  onDismissError: () => void;
}

/** Round lengths worth offering. Anything under a minute is not a round. */
const DURATIONS = [
  { label: '2 min', ms: 2 * 60_000 },
  { label: '3 min', ms: 3 * 60_000 },
  { label: '5 min', ms: 5 * 60_000 },
];

export function MatchSetup({
  kind,
  busy,
  error,
  onHost,
  onJoin,
  onBack,
  onDismissError,
}: MatchSetupProps) {
  const { t } = useLocalization();
  const [durationMs, setDurationMs] = useState(DURATIONS[1].ms);
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [catalog, setCatalog] = useState<ChallengeSummary[]>([]);
  const practice = kind === 'practice';
  const { challengeProvider } = useServices();

  // Offered so a host can pick the item. Without this every unpinned round ran
  // on whatever the server chose, which is the same challenge every time.
  useEffect(() => {
    let active = true;
    void challengeProvider
      .listChallenges()
      .then((listed) => {
        if (active) setCatalog(listed);
      })
      .catch(() => {
        // A catalog we cannot read just means no choice is offered; the server
        // still picks one, so hosting must not be blocked by it.
      });
    return () => {
      active = false;
    };
  }, [challengeProvider]);

  return (
    <main className="menu-screen">
      <div className="menu-screen__aura" aria-hidden="true" />

      <button className="ghost-button menu-screen__back" type="button" onClick={onBack}>
        <ArrowLeft size={15} />
        {t('menu')}
      </button>

      <header className="menu-screen__head">
        <p className="phase-kicker">
          <Swords size={13} />
          {t('versusRound')}
        </p>
        <h1>{t('versusTitle')}</h1>
        <p className="menu-screen__lede">
          {t('versusIntro')}
        </p>
      </header>

      <div
        className={`connection-note connection-note--${practice ? 'practice' : 'online'}`}
      >
        {practice ? <WifiOff size={15} /> : <Wifi size={15} />}
        <div>
          <strong>{practice ? t('offlinePracticeTitle') : t('backendOnlineTitle')}</strong>
          <span>
            {practice
              ? t('offlinePracticeBody')
              : t('onlineRoundBody')}
          </span>
        </div>
      </div>

      <p className="menu-screen__privacy-note">
        {t('multiplayerPrivacy')}
      </p>

      <div className="menu-screen__columns">
        <section className="menu-card">
          <h2>{t('hostRound')}</h2>
          <p>{t('hostRoundBody')}</p>

          <div className="segmented" role="group" aria-label={t('roundLength')}>
            {DURATIONS.map((option) => (
              <button
                key={option.ms}
                type="button"
                className={durationMs === option.ms ? 'is-active' : ''}
                onClick={() => setDurationMs(option.ms)}
                aria-pressed={durationMs === option.ms}
              >
                {option.label}
              </button>
            ))}
          </div>

          {catalog.length > 1 ? (
            <label className="host-choice">
              <span>{t('challenge')}</span>
              <select
                value={challengeId}
                onChange={(event) => setChallengeId(event.target.value)}
                aria-label={t('challengeForRound')}
              >
                <option value="">{t('serverChoose')}</option>
                {catalog.map((summary) => (
                  <option key={summary.id} value={summary.id}>
                    {summary.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <button
            className="big-button big-button--primary"
            type="button"
            disabled={busy}
            onClick={() => onHost(durationMs, challengeId || undefined)}
          >
            {busy ? <LoaderCircle className="spin" size={17} /> : <Radio size={17} />}
            {t('openRoom')}
          </button>

          {practice ? (
            <p className="menu-card__foot">
              <Bot size={13} />
              {t('practiceBots')}
            </p>
          ) : null}
        </section>

        <section className="menu-card">
          <h2>{t('joinRound')}</h2>
          <p>{t('joinRoundBody')}</p>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (code.trim()) {
                onJoin(code);
              }
            }}
          >
            <input
              className="code-input"
              value={code}
              // Uppercased on the way in, not just in CSS: room codes are
              // uppercase base32 in both modes, and displaying a lowercase
              // entry as capitals while sending it verbatim is the one
              // combination that produces a mystifying "no such room".
              onChange={(event) =>
                setCode(event.target.value.toUpperCase().slice(0, 6))
              }
              placeholder={t('roomCode')}
              aria-label={t('roomCodeLabel')}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              className="big-button"
              type="submit"
              disabled={busy || !code.trim()}
            >
              {t('joinRoom')}
            </button>
          </form>

          {practice ? (
            <p className="menu-card__foot">
              {t('offlineRoomOnly')}
            </p>
          ) : null}
        </section>
      </div>

      {error ? (
        <div className="error-banner error-banner--static" role="alert">
          <strong>{t('roundError')}</strong>
          <span>{error}</span>
          <button type="button" onClick={onDismissError} aria-label={t('dismissError')}>
            ×
          </button>
        </div>
      ) : null}
    </main>
  );
}

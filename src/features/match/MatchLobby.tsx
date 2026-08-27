import { useState } from 'react';
import {
  Bot,
  Check,
  Clock3,
  Copy,
  EyeOff,
  LoaderCircle,
  LogOut,
  Rocket,
  ShieldCheck,
  Timer,
  UserRoundX,
  Users,
} from 'lucide-react';
import type { MatchProvider } from '../../services/contracts';
import type { MatchState } from '../../types/match';
import { isPracticeBot } from '../../services/local/LocalMatchProvider';
import { initialsOf, type PlayerIdentity } from './identity';
import { formatPlayerLocalTime, formatUtcOffset } from './playerTime';
import { useLocalization } from '../preferences/localization';

interface MatchLobbyProps {
  state: MatchState;
  identity: PlayerIdentity;
  kind: MatchProvider['kind'];
  busy: boolean;
  onStart: () => void;
  onLeave: () => void;
}

export function MatchLobby({
  state,
  identity,
  kind,
  busy,
  onStart,
  onLeave,
}: MatchLobbyProps) {
  const { t } = useLocalization();
  const [copied, setCopied] = useState(false);
  const minutes = Math.round(state.config.durationMs / 60_000);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(state.matchId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_600);
    } catch {
      // Clipboard permission denied — the code is on screen to be read anyway.
    }
  };

  return (
    <main className="menu-screen">
      <div className="menu-screen__aura" aria-hidden="true" />

      <button className="ghost-button menu-screen__back" type="button" onClick={onLeave}>
        <LogOut size={15} />
        {t('leave')}
      </button>

      <header className="menu-screen__head">
        <p className="phase-kicker">{t('lobby')}</p>
        <h1>{t('waitingStart')}</h1>
      </header>

      <div className="room-code">
        <span>{t('roomCode')}</span>
        <strong data-testid="room-code">{state.matchId}</strong>
        <button type="button" onClick={() => void copyCode()} aria-label={t('roomCodeLabel')}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>

      <div className="menu-screen__columns">
        <section className="menu-card">
          <h2>
            <Users size={15} />
            {t('players')}
            <em>
              {state.players.length} / {state.config.maxPlayers}
            </em>
          </h2>
          <ul className="roster">
            {state.players.map((player) => {
              const localTime = formatPlayerLocalTime(player.utcOffsetMinutes);
              return (
              <li key={player.playerId} className="roster__row">
                <span className="roster__avatar">{initialsOf(player.displayName)}</span>
                <strong>{player.displayName}</strong>
                {player.playerId === identity.playerId ? (
                  <span className="tag tag--you">{t('you')}</span>
                ) : null}
                {isPracticeBot(player.playerId) ? (
                  <span className="tag tag--bot">
                    <Bot size={11} />
                    {t('bot')}
                  </span>
                ) : null}
                {localTime && player.utcOffsetMinutes !== undefined ? (
                  <span
                    className="roster__local-time"
                    title={formatUtcOffset(player.utcOffsetMinutes)}
                  >
                    <Clock3 size={11} />
                    {localTime}
                  </span>
                ) : null}
              </li>
              );
            })}
          </ul>
        </section>

        <section className="menu-card">
          <h2>{t('rules')}</h2>
          <ul className="rule-list">
            <li>
              <Timer size={15} />
              <div>
                <strong>{minutes} {t('serverClockRule')}</strong>
                <span>{t('serverClockBody')}</span>
              </div>
            </li>
            <li>
              <EyeOff size={15} />
              <div>
                <strong>{t('hiddenStandings')}</strong>
                <span>{t('hiddenStandingsBody')}</span>
              </div>
            </li>
            <li>
              <ShieldCheck size={15} />
              <div>
                <strong>{t('bestAttempt')}</strong>
                <span>
                  {kind === 'online'
                    ? t('serverReplayBody')
                    : t('localScoreBody')}
                </span>
              </div>
            </li>
            {kind === 'online' ? (
              <li className="rule-list__caveat">
                <UserRoundX size={15} />
                <div>
                  <strong>{t('namesUnverified')}</strong>
                  <span>{t('namesUnverifiedBody')}</span>
                </div>
              </li>
            ) : null}
          </ul>
        </section>
      </div>

      <button
        className="big-button big-button--primary big-button--wide"
        type="button"
        disabled={busy}
        onClick={onStart}
        data-testid="start-round"
      >
        {busy ? <LoaderCircle className="spin" size={18} /> : <Rocket size={18} />}
        {t('startRound')}
      </button>
      <p className="menu-screen__hint">
        {t('lobbyStartHint')}
      </p>
    </main>
  );
}

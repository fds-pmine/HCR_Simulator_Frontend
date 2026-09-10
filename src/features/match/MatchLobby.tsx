import { useState } from 'react';
import {
  Bot,
  Check,
  Clock3,
  Copy,
  EyeOff,
  Grid3x3,
  Hourglass,
  LoaderCircle,
  LogOut,
  Rocket,
  ShieldCheck,
  SlidersHorizontal,
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
import type { RoundFormat } from '../../types/match';
import type { CrewMap } from './crews';
import { roundLengthUnits } from './roundRules';

interface MatchLobbyProps {
  state: MatchState;
  identity: PlayerIdentity;
  kind: MatchProvider['kind'];
  busy: boolean;
  /** Player id to crew, for the optional team scoring on the scoreboard. */
  crews: CrewMap;
  onAssignCrew: (playerId: string) => void;
  /** What game this round is, declared when the room was opened. */
  format: RoundFormat;
  /**
   * Whether this client opened the room.
   *
   * Not authority — the server has no host, and a patched client could still
   * call start. It is the difference between one machine driving the session
   * and twenty racing to, which is a usability problem rather than a security
   * one and is fixed the same way a usability problem always is: by only
   * drawing the button for the person whose job it is.
   */
  isHost: boolean;
  onStart: () => void;
  onLeave: () => void;
}

export function MatchLobby({
  state,
  identity,
  kind,
  busy,
  crews,
  onAssignCrew,
  format,
  isHost,
  onStart,
  onLeave,
}: MatchLobbyProps) {
  const { t } = useLocalization();
  const [copied, setCopied] = useState(false);
  const length = roundLengthUnits(state.config.durationMs);
  const mode = state.config.programmingMode ?? 'servo';

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
                {/*
                  Crews are set by tapping, cycling A to D and back to none —
                  the whole room has to be split in the time it takes to say so
                  out loud, and a dropdown per player does not fit in that.
                */}
                {format === 'crews' ? (
                  <button
                    type="button"
                    className={`roster__crew ${crews[player.playerId] ? 'is-set' : ''}`}
                    onClick={() => onAssignCrew(player.playerId)}
                    title={t('assignCrew')}
                    data-testid={`crew-${player.playerId}`}
                  >
                    {crews[player.playerId] ?? '+'}
                  </button>
                ) : null}
              </li>
              );
            })}
          </ul>

          {/*
            The co-op bar, set before the round so it cannot be chosen to
            flatter the result. Zero is off, which is how every round starts.
          */}
          {/*
            Crews are dealt from the room code so every client agrees without
            anything being transmitted; tapping overrides that for everybody,
            which is a real write to the room and not this browser's opinion.
          */}
          {format === 'crews' ? (
            <p className="lobby__scope">{t('crewsDrawn')}</p>
          ) : null}
        </section>

        <section className="menu-card">
          <h2>{t('rules')}</h2>
          <ul className="rule-list">
            <li>
              <Timer size={15} />
              <div>
                <strong>
                  {length.value}{' '}
                  {length.unit === 'seconds'
                    ? t('secondsClockRule')
                    : t('serverClockRule')}
                </strong>
                <span>{t('serverClockBody')}</span>
              </div>
            </li>
            {/*
              Which editor the round is played in, stated before it starts:
              it is the difference between writing joint angles and writing a
              route across the lattice, and finding out at T0 costs a round.
            */}
            <li>
              {mode === 'cutter-grid' ? <Grid3x3 size={15} /> : <SlidersHorizontal size={15} />}
              <div>
                <strong>
                  {t(mode === 'cutter-grid' ? 'cutterGridMode' : 'servoAnglesMode')}
                </strong>
                <span>{t('singleModeRound')}</span>
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

      {isHost ? (
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
      ) : (
        <p className="lobby__waiting" data-testid="waiting-for-host">
          <Hourglass size={16} />
          {t('waitingForHost')}
        </p>
      )}
      <p className="menu-screen__hint">
        {t('lobbyStartHint')}
      </p>
    </main>
  );
}

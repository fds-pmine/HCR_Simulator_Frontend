import { Bot, Check, CircleDot, Clock3, EyeOff } from 'lucide-react';
import type { MatchState, MatchSubmissionAck } from '../../types/match';
import { REJECTION_LABELS } from '../../types/match';
import { isPracticeBot } from '../../services/local/LocalMatchProvider';
import {
  countdownUrgency,
  formatCountdown,
  isEndgame,
  relayLeg,
  remainingFraction,
  useRemainingMs,
} from './countdown';
import { initialsOf, type PlayerIdentity } from './identity';
import { formatPlayerLocalTime, formatUtcOffset } from './playerTime';
import { useLocalization } from '../preferences/localization';

interface MatchHudProps {
  state: MatchState;
  identity: PlayerIdentity;
  offsetMs: number;
  lastAck?: MatchSubmissionAck;
}

/**
 * The in-round heads-up display.
 *
 * Shows time, who has submitted, and whether your last entry was accepted — and,
 * deliberately, no score. That omission is the rule, not an oversight:
 * `06-MULTIPLAYER.md` §3.
 *
 * What the rule protects is *standings*. A player can still evaluate their own
 * program with Test as often as they like — the engine is in their browser, so
 * hiding that would be theatre and would leave them unable to tell a good
 * program from a bad one. What must stay sealed is every official score,
 * because that is what would give somebody a known bar to refine against.
 */
export function MatchHud({ state, identity, offsetMs, lastAck }: MatchHudProps) {
  const { t } = useLocalization();
  const remainingMs = useRemainingMs(state.closesAt, offsetMs);
  const urgency = countdownUrgency(remainingMs, state.config.durationMs);
  const fraction = remainingFraction(remainingMs, state.config.durationMs);
  // Only while the round is actually running: a lobby thirty seconds from
  // nothing, and a scoreboard, are not deadlines.
  const endgame =
    state.phase === 'running' && isEndgame(remainingMs, state.config.durationMs);
  const relay =
    state.phase === 'running' && state.config.relaySwapMs
      ? relayLeg(remainingMs, state.config.durationMs, state.config.relaySwapMs)
      : undefined;

  return (
    <div className={`hud ${endgame ? 'is-endgame' : ''}`} data-endgame={endgame}>
      {/*
        A red edge around the whole stage, not a badge in a corner. The point of
        the last thirty seconds is that everybody feels them at once, including
        the person who is not looking at the clock.
      */}
      {endgame ? <div className="endgame-edge" aria-hidden="true" /> : null}
      <div className={`hud__timer hud__timer--${urgency}`} data-testid="match-timer">
        <span>{urgency === 'closed' ? t('closed') : t('timeLeft')}</span>
        <strong>{formatCountdown(remainingMs)}</strong>
        <div className="hud__timer-track">
          <i style={{ transform: `scaleX(${fraction})` }} />
        </div>
      </div>

      {/*
        A relay prompt, not a rule: nothing here observes who is at the
        keyboard. It is on the round's own clock so every machine in the room
        is told to change hands on the same second.
      */}
      {relay ? (
        <p
          className={`hud__relay ${relay.swapInMs <= 5_000 ? 'is-due' : ''}`}
          data-testid="relay-leg"
        >
          {t('relayLeg')} {relay.leg} · {t('relaySwapIn')}{' '}
          {Math.ceil(relay.swapInMs / 1_000)}s
        </p>
      ) : null}

      <ul className="hud__roster" aria-label={t('players')}>
        {state.players.map((player) => {
          const localTime = formatPlayerLocalTime(player.utcOffsetMinutes);
          return (
          <li
            key={player.playerId}
            className={`hud__player ${player.submitted ? 'is-submitted' : ''} ${
              player.playerId === identity.playerId ? 'is-you' : ''
            }`}
            title={`${player.displayName} — ${player.submitted ? t('attemptLocked') : t('noAttempt')}`}
          >
            <span className="roster__avatar">
              {isPracticeBot(player.playerId) ? (
                <Bot size={13} />
              ) : (
                initialsOf(player.displayName)
              )}
            </span>
            <em>{player.displayName}</em>
            {localTime && player.utcOffsetMinutes !== undefined ? (
              <small title={formatUtcOffset(player.utcOffsetMinutes)}>
                <Clock3 size={10} /> {localTime}
              </small>
            ) : null}
            {player.submitted ? <Check size={13} /> : <CircleDot size={13} />}
          </li>
          );
        })}
      </ul>

      <p className="hud__secrecy">
        <EyeOff size={12} />
        {t('scoresSealed')}
      </p>

      {lastAck ? (
        <div
          className={`hud__ack ${lastAck.accepted ? 'is-accepted' : 'is-refused'}`}
          role="status"
          data-testid="match-ack"
        >
          {lastAck.accepted
            ? t('attemptLocked')
            : (lastAck.rejectedReason
                ? REJECTION_LABELS[lastAck.rejectedReason]
                : t('attemptRejected'))}
        </div>
      ) : null}
    </div>
  );
}

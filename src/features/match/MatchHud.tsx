import { Bot, Check, CircleDot, EyeOff } from 'lucide-react';
import type { MatchState, MatchSubmissionAck } from '../../types/match';
import { REJECTION_LABELS } from '../../types/match';
import { isPracticeBot } from '../../services/local/LocalMatchProvider';
import {
  countdownUrgency,
  formatCountdown,
  remainingFraction,
  useRemainingMs,
} from './countdown';
import { initialsOf, type PlayerIdentity } from './identity';

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
  const remainingMs = useRemainingMs(state.closesAt, offsetMs);
  const urgency = countdownUrgency(remainingMs);
  const fraction = remainingFraction(remainingMs, state.config.durationMs);

  return (
    <div className="hud">
      <div className={`hud__timer hud__timer--${urgency}`} data-testid="match-timer">
        <span>{urgency === 'closed' ? 'CLOSED' : 'TIME LEFT'}</span>
        <strong>{formatCountdown(remainingMs)}</strong>
        <div className="hud__timer-track">
          <i style={{ transform: `scaleX(${fraction})` }} />
        </div>
      </div>

      <ul className="hud__roster" aria-label="Players">
        {state.players.map((player) => (
          <li
            key={player.playerId}
            className={`hud__player ${player.submitted ? 'is-submitted' : ''} ${
              player.playerId === identity.playerId ? 'is-you' : ''
            }`}
            title={`${player.displayName} — ${
              player.submitted ? 'has an attempt in' : 'no attempt yet'
            }`}
          >
            <span className="roster__avatar">
              {isPracticeBot(player.playerId) ? (
                <Bot size={13} />
              ) : (
                initialsOf(player.displayName)
              )}
            </span>
            <em>{player.displayName}</em>
            {player.submitted ? <Check size={13} /> : <CircleDot size={13} />}
          </li>
        ))}
      </ul>

      <p className="hud__secrecy">
        <EyeOff size={12} />
        Scores are sealed until the round closes
      </p>

      {lastAck ? (
        <div
          className={`hud__ack ${lastAck.accepted ? 'is-accepted' : 'is-refused'}`}
          role="status"
          data-testid="match-ack"
        >
          {lastAck.accepted
            ? 'Attempt locked in. Submit again to improve it — your best one counts.'
            : (lastAck.rejectedReason
                ? REJECTION_LABELS[lastAck.rejectedReason]
                : 'That attempt was not accepted.')}
        </div>
      ) : null}
    </div>
  );
}

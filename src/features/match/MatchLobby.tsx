import { useState } from 'react';
import {
  Bot,
  Check,
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
        Leave
      </button>

      <header className="menu-screen__head">
        <p className="phase-kicker">LOBBY</p>
        <h1>Waiting to start</h1>
      </header>

      <div className="room-code">
        <span>ROOM CODE</span>
        <strong data-testid="room-code">{state.matchId}</strong>
        <button type="button" onClick={() => void copyCode()} aria-label="Copy room code">
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>

      <div className="menu-screen__columns">
        <section className="menu-card">
          <h2>
            <Users size={15} />
            Players
            <em>
              {state.players.length} / {state.config.maxPlayers}
            </em>
          </h2>
          <ul className="roster">
            {state.players.map((player) => (
              <li key={player.playerId} className="roster__row">
                <span className="roster__avatar">{initialsOf(player.displayName)}</span>
                <strong>{player.displayName}</strong>
                {player.playerId === identity.playerId ? (
                  <span className="tag tag--you">YOU</span>
                ) : null}
                {isPracticeBot(player.playerId) ? (
                  <span className="tag tag--bot">
                    <Bot size={11} />
                    BOT
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="menu-card">
          <h2>Rules</h2>
          <ul className="rule-list">
            <li>
              <Timer size={15} />
              <div>
                <strong>{minutes} minutes, on the server clock</strong>
                <span>
                  A submission counts if the server receives it before the
                  deadline. Your own clock is never consulted.
                </span>
              </div>
            </li>
            <li>
              <EyeOff size={15} />
              <div>
                <strong>Standings stay hidden</strong>
                <span>
                  Nobody learns how they rank until the round closes. Test your
                  own program as often as you like — what stays sealed is every
                  official score, so there is no known bar to refine against.
                </span>
              </div>
            </li>
            <li>
              <ShieldCheck size={15} />
              <div>
                <strong>Resubmit freely, best attempt counts</strong>
                <span>
                  {kind === 'online'
                    ? 'The server replays every program it scores, so the score is the program, not what the browser reports.'
                    : 'This is a practice round: your own browser computes the score, so nothing here is a result.'}
                </span>
              </div>
            </li>
            {kind === 'online' ? (
              <li className="rule-list__caveat">
                <UserRoundX size={15} />
                <div>
                  <strong>Names are not verified</strong>
                  <span>
                    There are no accounts here — anyone can pick any name, so a
                    standing is a bit of fun rather than a record of who did
                    what.
                  </span>
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
        Start Round
      </button>
      <p className="menu-screen__hint">
        Anyone in the room can start it. The challenge is revealed to everyone at
        the same instant.
      </p>
    </main>
  );
}

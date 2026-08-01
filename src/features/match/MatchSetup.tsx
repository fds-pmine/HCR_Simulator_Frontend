import { useEffect, useState } from 'react';
import { ArrowLeft, Bot, LoaderCircle, Radio, Swords, Wifi, WifiOff } from 'lucide-react';
import type { MatchProvider } from '../../services/contracts';
import type { ChallengeSummary } from '../../types/domain';
import { useServices } from '../../app/servicesContext';

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
        Menu
      </button>

      <header className="menu-screen__head">
        <p className="phase-kicker">
          <Swords size={13} />
          VERSUS ROUND
        </p>
        <h1>Same challenge. Same clock.</h1>
        <p className="menu-screen__lede">
          Everyone gets the identical hairstyle at the same moment and a fixed
          window to submit. Closest to the target wins. Scores stay hidden until
          the round closes.
        </p>
      </header>

      <div
        className={`connection-note connection-note--${practice ? 'practice' : 'online'}`}
      >
        {practice ? <WifiOff size={15} /> : <Wifi size={15} />}
        <div>
          <strong>{practice ? 'Offline practice' : 'Connected to a backend'}</strong>
          <span>
            {practice
              ? 'No server is configured, so rounds run in this tab against scripted bots and scores are computed by your own browser. Set VITE_HCR_API_BASE_URL to play against real opponents.'
              : 'Programs are replayed and scored by the server, and the deadline is judged by the server clock.'}
          </span>
        </div>
      </div>

      <div className="menu-screen__columns">
        <section className="menu-card">
          <h2>Host a round</h2>
          <p>Open a room, share the code, start when everyone is in.</p>

          <div className="segmented" role="group" aria-label="Round length">
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
              <span>CHALLENGE</span>
              <select
                value={challengeId}
                onChange={(event) => setChallengeId(event.target.value)}
                aria-label="Challenge for this round"
              >
                <option value="">Let the server choose</option>
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
            Open Room
          </button>

          {practice ? (
            <p className="menu-card__foot">
              <Bot size={13} />
              Three practice bots will fill the room.
            </p>
          ) : null}
        </section>

        <section className="menu-card">
          <h2>Join a round</h2>
          <p>Enter the code the host gave you.</p>

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
              placeholder="ROOM CODE"
              aria-label="Room code"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              className="big-button"
              type="submit"
              disabled={busy || !code.trim()}
            >
              Join Room
            </button>
          </form>

          {practice ? (
            <p className="menu-card__foot">
              Offline rooms live in this tab only — a code cannot be shared.
            </p>
          ) : null}
        </section>
      </div>

      {error ? (
        <div className="error-banner error-banner--static" role="alert">
          <strong>ROUND ERROR</strong>
          <span>{error}</span>
          <button type="button" onClick={onDismissError} aria-label="Dismiss error message">
            ×
          </button>
        </div>
      ) : null}
    </main>
  );
}

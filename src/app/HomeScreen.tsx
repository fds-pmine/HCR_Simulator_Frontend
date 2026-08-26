import { useState } from 'react';
import { Braces, GraduationCap, ListChecks, Scissors, Swords, Wifi, WifiOff } from 'lucide-react';
import {
  MAX_NAME_LENGTH,
  normalizeDisplayName,
  type PlayerIdentity,
} from '../features/match/identity';
import type { MatchProvider } from '../services/contracts';

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
          Program the arm. Carve the hair. Beat the clock.
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
          <strong>Tutorial</strong>
          <span className="mode-card__body">
            Guided Grid, Grid-to-Angles, and Servo tracks. Compare spatial paths
            with joint commands on the live simulator.
          </span>
          <span className="mode-card__go">Learn →</span>
        </button>

        <button
          className="mode-card mode-card--lessons"
          type="button"
          onClick={onLessons}
        >
          <span className="mode-card__icon">
            <ListChecks size={22} />
          </span>
          <strong>Lessons</strong>
          <span className="mode-card__body">
            Ten Cutter Grid and eight Servo Angles lessons, all with 20 sections.
            Learn spatial paths first, then drive each joint yourself.
          </span>
          <span className="mode-card__go">Practise →</span>
        </button>

        <button className="mode-card mode-card--solo" type="button" onClick={onSolo}>
          <span className="mode-card__icon">
            <Scissors size={22} />
          </span>
          <strong>Solo Practice</strong>
          <span className="mode-card__body">
            No clock. Finish one and the next arrives — harder or easier, chosen
            from how you are doing.
          </span>
          <span className="mode-card__go">Start →</span>
        </button>

        <button className="mode-card mode-card--versus" type="button" onClick={onVersus}>
          <span className="mode-card__icon">
            <Swords size={22} />
          </span>
          <strong>Versus Round</strong>
          <span className="mode-card__body">
            Everyone gets the same hairstyle at the same moment. Closest to the
            target when the clock runs out wins.
          </span>
          <span className="mode-card__go">Play →</span>
        </button>
      </div>

      <footer className="home__foot">
        <label className="name-field">
          <span>PLAYER</span>
          <input
            value={draft}
            maxLength={MAX_NAME_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() =>
              onRename(normalizeDisplayName(draft, identity.displayName))
            }
            aria-label="Display name"
            spellCheck={false}
          />
        </label>

        <span className={`link-chip link-chip--${kind}`}>
          {kind === 'online' ? <Wifi size={13} /> : <WifiOff size={13} />}
          {kind === 'online' ? 'BACKEND CONNECTED' : 'OFFLINE · PRACTICE'}
        </span>
      </footer>

      {/*
        An open deployment that records play should say so where people will see
        it, not only in a document nobody opens. Offline builds send nothing
        anywhere, so the notice would be false there.
      */}
      {kind === 'online' ? (
        <p className="home__notice">
          Open to everyone, with no sign-in — anyone can pick any name. Scores
          and programs you submit are recorded to study how people learn to
          program the arm; your name is not stored with them.
        </p>
      ) : null}
    </main>
  );
}

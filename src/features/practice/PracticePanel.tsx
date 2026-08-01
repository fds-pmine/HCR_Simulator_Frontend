import { Gauge, LoaderCircle, TrendingUp } from 'lucide-react';
import type { SessionProvider } from '../../services/contracts';

interface PracticePanelProps {
  kind: SessionProvider['kind'];
  attempted: number;
  /** Ability estimate. Meaningless offline, and hidden there. */
  theta: number;
  remaining?: number;
  /** The fixed opener, before any session exists. */
  intro: boolean;
  busy: boolean;
}

export function PracticePanel({
  kind,
  attempted,
  theta,
  remaining,
  intro,
  busy,
}: PracticePanelProps) {
  const adaptive = kind === 'adaptive';

  return (
    <div className="hud">
      <div className="hud__timer hud__timer--calm">
        <span>{adaptive ? 'ABILITY' : 'PROGRESS'}</span>
        <strong>
          {/*
            Offline the sequence is fixed, so there is no estimate to show — a
            number here would misrepresent what it means.
          */}
          {adaptive
            ? theta >= 0
              ? `+${theta.toFixed(2)}`
              : theta.toFixed(2)
            : attempted}
        </strong>
        <div className="hud__timer-track">
          <i style={{ transform: `scaleX(${Math.min(1, attempted / 8)})` }} />
        </div>
      </div>

      <p className="hud__secrecy">
        {intro ? (
          <>
            <Gauge size={12} />
            Everyone starts here — how you do sets where practice begins
          </>
        ) : busy ? (
          <>
            <LoaderCircle className="spin" size={12} />
            Choosing your next challenge…
          </>
        ) : adaptive ? (
          <>
            <Gauge size={12} />
            {`${attempted} done — each one picked from how you are doing`}
          </>
        ) : (
          <>
            <TrendingUp size={12} />
            {`${attempted} done${remaining ? ` · ${remaining} to go` : ''}`}
          </>
        )}
      </p>
    </div>
  );
}

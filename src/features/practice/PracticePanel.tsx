import { Gauge, LoaderCircle, TrendingUp } from 'lucide-react';
import type { SessionProvider } from '../../services/contracts';
import { useLocalization } from '../preferences/localization';

interface PracticePanelProps {
  kind: SessionProvider['kind'];
  attempted: number;
  /** Ability estimate. Meaningless offline, and hidden there. */
  theta: number;
  remaining?: number;
  busy: boolean;
}

export function PracticePanel({
  kind,
  attempted,
  theta,
  remaining,
  busy,
}: PracticePanelProps) {
  const { t } = useLocalization();
  const adaptive = kind === 'adaptive';

  return (
    <div className="hud">
      <div className="hud__timer hud__timer--calm">
        <span>{adaptive ? t('ability') : t('progress')}</span>
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
        {busy ? (
          <>
            <LoaderCircle className="spin" size={12} />
            {t('choosingNext')}
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

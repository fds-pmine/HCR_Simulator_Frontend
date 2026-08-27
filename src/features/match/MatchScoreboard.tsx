import { useEffect, useState } from 'react';
import { Bot, Crown, LogOut, RotateCcw, Trophy } from 'lucide-react';
import type { MatchProvider } from '../../services/contracts';
import type { MatchResultRow, MatchResults } from '../../types/match';
import { isPracticeBot } from '../../services/local/LocalMatchProvider';
import { initialsOf, type PlayerIdentity } from './identity';
import { useLocalization } from '../preferences/localization';

interface MatchScoreboardProps {
  results: MatchResults;
  identity: PlayerIdentity;
  kind: MatchProvider['kind'];
  onPlayAgain: () => void;
  onExit: () => void;
}

export function MatchScoreboard({
  results,
  identity,
  kind,
  onPlayAgain,
  onExit,
}: MatchScoreboardProps) {
  const { t } = useLocalization();
  const you = results.rows.find((row) => row.playerId === identity.playerId);
  const winner = results.rows[0];
  const metricLabel =
    results.rankBy === 'completion' ? t('similarityMetric') : t('finalScoreMetric');

  return (
    <div className="scoreboard" role="dialog" aria-label={t('roundResults')}>
      <div className="scoreboard__panel">
        <header className="scoreboard__head">
          <Trophy size={20} />
          <div>
            <p className="phase-kicker">{t('roundClosed')}</p>
            <h2>
              {winner
                ? winner.playerId === identity.playerId
                  ? t('youWin')
                  : `${winner.displayName} wins`
                : t('noEntries')}
            </h2>
          </div>
          <span className="scoreboard__metric">{t('rankedBy')} {metricLabel.toLowerCase()}</span>
        </header>

        <ol className="scoreboard__rows">
          {results.rows.map((row, index) => (
            <ScoreRow
              key={row.playerId}
              row={row}
              rankBy={results.rankBy}
              isYou={row.playerId === identity.playerId}
              delayMs={index * 110}
            />
          ))}
        </ol>

        {you ? (
          <p className="scoreboard__yours" data-testid="your-standing">
            You placed <strong>#{you.rank}</strong> of {results.rows.length} with{' '}
            <strong>{you.completionScore.toFixed(1)}</strong> similarity
            {you.submissionId ? '' : ' — no attempt was submitted in time'}.
          </p>
        ) : null}

        {kind === 'practice' ? (
          <p className="scoreboard__disclaimer">
            <Bot size={13} />
            Practice round: opponents are scripted and scores were computed by
            this browser, not replayed by a server.
          </p>
        ) : null}

        <div className="scoreboard__actions">
          <button className="big-button big-button--primary" type="button" onClick={onPlayAgain}>
            <RotateCcw size={16} />
            {t('playAgain')}
          </button>
          <button className="big-button" type="button" onClick={onExit}>
            <LogOut size={16} />
            {t('backToMenu')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ScoreRow({
  row,
  rankBy,
  isYou,
  delayMs,
}: {
  row: MatchResultRow;
  rankBy: MatchResults['rankBy'];
  isYou: boolean;
  delayMs: number;
}) {
  const { t } = useLocalization();
  const headline = rankBy === 'final' ? row.finalScore : row.completionScore;
  const shown = useCountUp(headline, delayMs);

  return (
    <li
      className={`scoreboard__row ${isYou ? 'is-you' : ''} ${
        row.rank === 1 ? 'is-winner' : ''
      }`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <span className="scoreboard__rank">
        {row.rank === 1 ? <Crown size={16} /> : row.rank}
      </span>
      <span className="roster__avatar">
        {isPracticeBot(row.playerId) ? <Bot size={14} /> : initialsOf(row.displayName)}
      </span>
      <div className="scoreboard__who">
        <strong>{row.displayName}</strong>
        <small>
          {row.submissionId
            ? `${row.metrics.sourceBlockCount} block${
                row.metrics.sourceBlockCount === 1 ? '' : 's'
              } · ${(row.metrics.estimatedDurationMs / 1_000).toFixed(1)}s`
            : t('noAttempt')}
        </small>
      </div>
      <div className="scoreboard__bar">
        <i style={{ width: `${Math.max(0, Math.min(100, headline))}%` }} />
      </div>
      <output>{shown.toFixed(1)}</output>
    </li>
  );
}

/** Roll a number up to its value, because a score that lands is more fun. */
const COUNT_UP_MS = 620;

function useCountUp(target: number, delayMs: number): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let frame = 0;
    let startedAt = 0;
    const step = (now: number) => {
      if (startedAt === 0) startedAt = now;
      const progress = Math.min(1, (now - startedAt) / COUNT_UP_MS);
      // Ease-out, so it decelerates into the final value instead of stopping dead.
      setValue(target * (1 - (1 - progress) ** 3));
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      }
    };
    const timer = setTimeout(() => {
      frame = requestAnimationFrame(step);
    }, delayMs);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [target, delayMs]);

  return value;
}

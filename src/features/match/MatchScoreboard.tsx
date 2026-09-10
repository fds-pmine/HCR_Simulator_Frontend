import { useEffect, useState } from 'react';
import { Bot, Crown, LogOut, RotateCcw, Target, Trophy, Users, Zap } from 'lucide-react';
import type { MatchProvider } from '../../services/contracts';
import type { MatchResultRow, MatchResults, RoundFormat } from '../../types/match';
import { isPracticeBot } from '../../services/local/LocalMatchProvider';
import { initialsOf, type PlayerIdentity } from './identity';
import { classTargetResult } from './classTarget';
import { marginsFor, type Margin } from './margins';
import { crewTotals, type CrewMap, type CrewScoring } from './crews';
import {
  crewStandings as sortCrewLeague,
  standings,
  type CrewSeason,
  type Season,
} from './season';
import { useLocalization } from '../preferences/localization';

interface MatchScoreboardProps {
  results: MatchResults;
  identity: PlayerIdentity;
  kind: MatchProvider['kind'];
  /** The table so far, including this round. Empty until a round has closed. */
  season: Season;
  crews: CrewMap;
  /** How this round reduces a crew to one number. */
  crewScoring?: CrewScoring;
  /** What game the round was, declared when the room opened. */
  format?: RoundFormat;
  /** The crew league so far, in a crew session. */
  crewSeason?: CrewSeason;
  /** Gap before the next round opens itself; absent when the loop is off. */
  autoAdvanceMs?: number;
  /** Stops the loop. Absent on a client that is not driving it. */
  onStopLoop?: () => void;
  /**
   * Ends the sitting and crowns the season's leader.
   *
   * Separate from {@link onStopLoop}, which only stops the clock: a room often
   * wants the loop paused so it can talk about a result and then carry on. This
   * is the other thing — the last round has been played, and the points table
   * everybody has been building for the last hour finally gets read out.
   */
  onEndSession?: () => void;
  /** The co-op bar agreed before the round; 0 when the round was not a co-op one. */
  classTarget: number;
  /** The round's deadline in server time, for "landed with 3s to spare". */
  closesAt?: number;
  /**
   * Reopen this room for another round. Absent when the round cannot be
   * reopened — offline rooms can, but a cancelled one cannot.
   */
  onNextRound?: () => void;
  busy?: boolean;
  onPlayAgain: () => void;
  onExit: () => void;
}

/** How many places the second podium shows. */
const PODIUM_PLACES = 3;

/**
 * The reveal, from last place upward.
 *
 * Everything landing at once answers the only question the room has — who won —
 * in the first frame, and then twenty people read a static list. Revealing from
 * the bottom makes the same list a countdown: you find your own name, and then
 * you wait with everybody else for the three that are missing.
 *
 * The pause before the podium is deliberately longer than the step between
 * ordinary rows. That gap is the whole effect.
 */
const REVEAL_STEP_MS = 90;
const PODIUM_BEAT_MS = 750;

/** Matches `row-in` in the stylesheet, so the headline lands with the winner. */
const ROW_IN_MS = 320;

/**
 * Whether the reveal has reached first place.
 *
 * The headline and your own standing are the answer to the question the reveal
 * exists to hold open, so both wait for it. Printing "Kite wins" over three
 * blank podium rows is not a reveal; it is a spoiler with an animation
 * underneath it.
 */
function useRevealed(atMs: number): boolean {
  // Starts false on every mount, which is once per round: the scoreboard is
  // rendered only while `session.results` exists, and reopening the room clears
  // it. So there is no stale `true` to reset here.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setRevealed(true), atMs);
    return () => clearTimeout(timer);
  }, [atMs]);
  return revealed;
}

function revealDelays(count: number): readonly number[] {
  const delays: number[] = [];
  let at = 0;
  // Index 0 is first place, so walk the array backwards and hand out rising
  // delays as the ranks climb.
  for (let rank = count - 1; rank >= 0; rank -= 1) {
    delays[rank] = at;
    at += rank < PODIUM_PLACES ? PODIUM_BEAT_MS : REVEAL_STEP_MS;
  }
  return delays;
}

export function MatchScoreboard({
  results,
  identity,
  kind,
  season,
  crews,
  crewScoring = 'sum',
  format = 'solo',
  crewSeason = [],
  autoAdvanceMs,
  onStopLoop,
  onEndSession,
  classTarget,
  closesAt,
  onNextRound,
  busy = false,
  onPlayAgain,
  onExit,
}: MatchScoreboardProps) {
  const { t } = useLocalization();
  const you = results.rows.find((row) => row.playerId === identity.playerId);
  const winner = results.rows[0];
  const metricLabel =
    results.rankBy === 'completion' ? t('similarityMetric') : t('finalScoreMetric');

  /*
    The other podium. Both numbers are computed for every submission, and only
    one of them decided the round — so showing the other costs nothing and
    settles the argument the scoring model creates: is a sprawling accurate
    haircut better than a tidy approximate one? The official ranking is the one
    above; this is for the bragging rights, and it is labelled as such.
  */
  const otherRanked = [...results.rows]
    .filter((row) => row.submissionId !== undefined)
    .sort((left, right) =>
      results.rankBy === 'completion'
        ? right.finalScore - left.finalScore
        : right.completionScore - left.completionScore,
    )
    .slice(0, PODIUM_PLACES);
  const otherScore = (row: MatchResultRow) =>
    results.rankBy === 'completion' ? row.finalScore : row.completionScore;

  const coop = classTarget > 0 ? classTargetResult(results.rows, classTarget) : undefined;
  const crewStandings = crewTotals(results.rows, crews, results.rankBy, crewScoring);
  const crewWinner = format === 'crews' ? crewStandings[0] : undefined;
  const table = standings(season);
  const league = sortCrewLeague(crewSeason);
  const nextRoundIn = useCountdown(autoAdvanceMs);
  const margins = marginsFor(results, closesAt);
  const delays = revealDelays(results.rows.length);
  const revealed = useRevealed((delays[0] ?? 0) + ROW_IN_MS);

  return (
    <div className="scoreboard" role="dialog" aria-label={t('roundResults')}>
      <div className="scoreboard__panel">
        <header className="scoreboard__head">
          <Trophy size={20} />
          <div>
            <p className="phase-kicker">{t('roundClosed')}</p>
            {/*
              A crew round's answer is the crew, and a co-op round has no
              winner at all — announcing an individual in either case would be
              announcing the wrong thing loudly.
            */}
            <h2>
              {!revealed
                ? t('revealing')
                : crewWinner
                  ? `${t('crew')} ${crewWinner.crew} ${t('crewWins')}`
                  : coop
                    ? coop.cleared
                      ? t('classTargetCleared')
                      : `${t('classTargetMissed')} ${coop.missingBy.toFixed(1)}`
                    : winner
                      ? winner.playerId === identity.playerId
                        ? t('youWin')
                        : `${winner.displayName} wins`
                      : t('noEntries')}
            </h2>
          </div>
          <span className="scoreboard__metric">{t('rankedBy')} {metricLabel.toLowerCase()}</span>
        </header>

        {coop ? (
          <p
            className={`scoreboard__coop ${coop.cleared ? 'is-cleared' : 'is-missed'}`}
            data-testid="class-target"
          >
            <Target size={15} />
            <strong>
              {coop.cleared
                ? t('classTargetCleared')
                : `${t('classTargetMissed')} ${coop.missingBy.toFixed(1)}`}
            </strong>
            <small>
              {t('classTarget')} {classTarget} · {t('lowestInRoom')}{' '}
              {coop.lowest.toFixed(1)} · {coop.submitted} / {coop.players}{' '}
              {t('submittedCount')}
            </small>
          </p>
        ) : null}

        <ol className="scoreboard__rows">
          {results.rows.map((row, index) => (
            <ScoreRow
              key={row.playerId}
              row={row}
              rankBy={results.rankBy}
              isYou={row.playerId === identity.playerId}
              delayMs={delays[index] ?? 0}
              margin={margins[index]}
            />
          ))}
        </ol>

        {you && revealed ? (
          <p className="scoreboard__yours" data-testid="your-standing">
            You placed <strong>#{you.rank}</strong> of {results.rows.length} with{' '}
            <strong>{you.completionScore.toFixed(1)}</strong> similarity
            {you.submissionId ? '' : ' — no attempt was submitted in time'}.
          </p>
        ) : null}

        {otherRanked.length > 0 ? (
          <section className="scoreboard__aside" data-testid="other-podium">
            <h3>
              <Zap size={13} />
              {results.rankBy === 'completion'
                ? t('efficiencyPodium')
                : t('accuracyPodium')}
            </h3>
            <ol>
              {otherRanked.map((row, index) => (
                <li key={row.playerId}>
                  <span>{index + 1}</span>
                  <strong>{row.displayName}</strong>
                  <output>{otherScore(row).toFixed(1)}</output>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {crewStandings.length > 0 ? (
          <section className="scoreboard__aside" data-testid="crew-totals">
            <h3>
              <Users size={13} />
              {format === 'crews' ? t('crewStandings') : t('crewTotals')}
              {crewScoring === 'weakestTwo' ? <em>{t('crewWeakestTwo')}</em> : null}
            </h3>
            <ol>
              {crewStandings.map((crew) => (
                <li key={crew.crew}>
                  <span>{crew.crew}</span>
                  <strong>
                    {crew.submitted} / {crew.members} {t('submittedCount')}
                  </strong>
                  <output>{crew.total.toFixed(1)}</output>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {league.length > 0 ? (
          <section className="scoreboard__aside" data-testid="crew-league">
            <h3>
              <Users size={13} />
              {t('crewLeague')}
            </h3>
            <ol>
              {league.map((entry, index) => (
                <li key={entry.crew}>
                  <span>{index + 1}</span>
                  <strong>
                    {t('crew')} {entry.crew}
                  </strong>
                  <small>
                    {entry.rounds} {t('roundsPlayed')}
                  </small>
                  <output>
                    {entry.points} {t('points')}
                  </output>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {table.length > 0 ? (
          <section className="scoreboard__aside" data-testid="season-table">
            <h3>
              <Trophy size={13} />
              {t('seasonTable')}
              {/*
                Folded from the results this client received, so a student who
                joined at round three has a shorter table than the projector
                and always will. The unqualified heading claimed otherwise.
              */}
              <em>{t('seasonScope')}</em>
            </h3>
            <ol>
              {table.map((entry, index) => (
                <li
                  key={entry.playerId}
                  className={entry.playerId === identity.playerId ? 'is-you' : ''}
                >
                  <span>{index + 1}</span>
                  <strong>{entry.displayName}</strong>
                  <small>
                    {entry.rounds} {t('roundsPlayed')}
                  </small>
                  {/*
                    A table with one winner gives nineteen people nothing to
                    read. These two say something true about a player who is
                    not first: that they got better, or that they are stringing
                    results together.
                  */}
                  {entry.improvedThisRound ? (
                    <em className="scoreboard__mark is-best" title={t('personalBest')}>
                      {t('personalBestShort')}
                    </em>
                  ) : null}
                  {entry.podiumStreak > 1 ? (
                    <em className="scoreboard__mark is-streak" title={t('podiumStreak')}>
                      ×{entry.podiumStreak}
                    </em>
                  ) : null}
                  <output>
                    {entry.points} {t('points')}
                  </output>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {kind === 'practice' ? (
          <p className="scoreboard__disclaimer">
            <Bot size={13} />
            Practice round: opponents are scripted and scores were computed by
            this browser, not replayed by a server.
          </p>
        ) : null}

        {/*
          The loop's countdown, on every screen, with the stop on the one that
          is driving it. A loop nobody can stop runs over the moment the room
          wanted to talk about a result.
        */}
        {nextRoundIn !== undefined ? (
          <p className="scoreboard__loop" data-testid="auto-advance">
            {t('nextRoundIn')} {Math.ceil(nextRoundIn / 1_000)}s
            {onStopLoop ? (
              <button type="button" onClick={onStopLoop} data-testid="stop-loop">
                {t('stopLoop')}
              </button>
            ) : null}
          </p>
        ) : null}

        <div className="scoreboard__actions">
          {/*
            Next round keeps the room and everybody in it, so a session is a
            session rather than eight separate rooms with eight codes to read
            out. Play Again is still here for anyone who wants a different
            length, a different metric or a different set of people.
          */}
          {onNextRound ? (
            <button
              className="big-button big-button--primary"
              type="button"
              onClick={onNextRound}
              disabled={busy}
              data-testid="next-round"
            >
              <RotateCcw size={16} />
              {t('nextRound')}
            </button>
          ) : null}
          <button
            className={`big-button ${onNextRound ? '' : 'big-button--primary'}`}
            type="button"
            onClick={onPlayAgain}
            data-testid="play-again"
          >
            {t('playAgain')}
          </button>
          {/*
            Offered only where it can mean something: on the machine driving the
            session, once a round has actually been folded into the table.
          */}
          {onEndSession ? (
            <button
              className="big-button"
              type="button"
              onClick={onEndSession}
              data-testid="end-session"
            >
              <Crown size={16} />
              {t('endSession')}
            </button>
          ) : null}
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
  margin,
}: {
  row: MatchResultRow;
  rankBy: MatchResults['rankBy'];
  isYou: boolean;
  delayMs: number;
  margin?: Margin;
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
        {/*
          The margin, which is the part worth arguing about. A rank is a fact;
          "0.4 behind Kite" is the size of the thing you lost by, with a name
          attached to it.
        */}
        {margin && row.submissionId ? (
          <small className="scoreboard__margin">
            {margin.photoFinish ? (
              <em className="scoreboard__photo">{t('photoFinish')}</em>
            ) : null}
            {/*
              A margin under a tenth of a point rounds to "0.0", which reads as
              a bug rather than as a close finish — the photo-finish badge is
              what says that, and it says it better.
            */}
            {margin.chasing && margin.behind >= 0.05
              ? `${margin.behind.toFixed(1)} ${t('behind')} ${margin.chasing}`
              : null}
            {margin.chasing === undefined &&
            margin.ahead !== undefined &&
            margin.ahead >= 0.05
              ? `${t('aheadBy')} ${margin.ahead.toFixed(1)}`
              : null}
            {margin.secondsToSpare !== undefined && margin.secondsToSpare < 10 ? (
              <em className="scoreboard__buzzer">
                {t('landedWith')} {margin.secondsToSpare.toFixed(1)}s
              </em>
            ) : null}
          </small>
        ) : null}
      </div>
      <div className="scoreboard__bar">
        <i style={{ width: `${Math.max(0, Math.min(100, headline))}%` }} />
      </div>
      <output>{shown.toFixed(1)}</output>
    </li>
  );
}

/**
 * Seconds left of a fixed gap, for the endless loop's countdown.
 *
 * Local to each client and started when the scoreboard mounted, so two laptops
 * can differ by the poll interval. That is fine for a countdown nobody acts on:
 * the round actually reopens when the machine that opened the room says so.
 */
function useCountdown(totalMs: number | undefined): number | undefined {
  const [remaining, setRemaining] = useState(totalMs);

  useEffect(() => {
    if (totalMs === undefined) return;
    const startedAt = performance.now();
    const timer = setInterval(() => {
      setRemaining(Math.max(0, totalMs - (performance.now() - startedAt)));
    }, 200);
    return () => clearInterval(timer);
  }, [totalMs]);

  return totalMs === undefined ? undefined : remaining;
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

import { Crown, LogOut, RotateCcw, Trophy, Users } from 'lucide-react';
import type { MatchProvider } from '../../services/contracts';
import { initialsOf, type PlayerIdentity } from './identity';
import {
  crewStandings as sortCrewLeague,
  standings,
  type CrewSeason,
  type Season,
} from './season';
import { useLocalization } from '../preferences/localization';

interface SessionChampionProps {
  /** The table as this client folded it. Sorted here, not by the caller. */
  season: Season;
  /** The crew league, in a crew session. */
  crewSeason?: CrewSeason;
  identity: PlayerIdentity;
  kind: MatchProvider['kind'];
  /** Reopen the room for another round. Absent on a client that is not the host. */
  onAnotherRound?: () => void;
  busy?: boolean;
  onExit: () => void;
}

/** How many places the session podium shows. */
const PODIUM_PLACES = 3;

/**
 * Who won the *session*, once the rounds stop.
 *
 * An endless session had no ending. It looped until somebody stopped the loop,
 * and then the screen still showed one round's scoreboard — so eight rounds of
 * accumulated points, the whole reason a session is a season rather than eight
 * separate games, went unannounced. A league table nobody ever reads the top of
 * is a scoreboard with extra steps.
 *
 * Points, not scores, exactly as {@link Season} computes them: a champion is the
 * player who kept turning up and kept improving, which is the thing a
 * three-hour class can actually reward. The last round's winner is on the last
 * round's scoreboard and is a different question.
 */
export function SessionChampion({
  season,
  crewSeason = [],
  identity,
  kind,
  onAnotherRound,
  busy = false,
  onExit,
}: SessionChampionProps) {
  const { t } = useLocalization();
  const table = standings(season);
  const champion = table[0];
  const league = sortCrewLeague(crewSeason);
  const crewChampion = league[0];

  return (
    <main className="bootstrap-screen champion" role="dialog" aria-label={t('sessionChampion')}>
      <p className="phase-kicker">
        <Crown size={13} />
        {t('sessionChampion')}
      </p>

      {champion ? (
        <>
          <h1 data-testid="session-champion">
            {champion.playerId === identity.playerId
              ? `${champion.displayName} · ${t('you')}`
              : champion.displayName}
          </h1>
          <p className="champion__stats">
            <strong>
              {champion.points} {t('points')}
            </strong>
            <span>
              {champion.rounds} {t('roundsPlayed')}
            </span>
            <span>
              {champion.wins} {t('winsUnit')}
            </span>
          </p>
        </>
      ) : (
        // A session can end before a round closes — the host opened a room,
        // thought better of it and stopped. Saying so is better than crowning
        // whoever happens to sort first out of an empty table.
        <h1 data-testid="session-champion">{t('noChampion')}</h1>
      )}

      {table.length > 1 ? (
        <ol className="champion__podium" data-testid="session-podium">
          {table.slice(0, PODIUM_PLACES).map((entry, index) => (
            <li
              key={entry.playerId}
              className={entry.playerId === identity.playerId ? 'is-you' : ''}
            >
              <span>{index + 1}</span>
              <span className="roster__avatar">{initialsOf(entry.displayName)}</span>
              <strong>{entry.displayName}</strong>
              <small>
                {entry.rounds} {t('roundsPlayed')}
              </small>
              <output>
                {entry.points} {t('points')}
              </output>
            </li>
          ))}
        </ol>
      ) : null}

      {crewChampion ? (
        <p className="champion__crew" data-testid="session-crew-champion">
          <Users size={14} />
          <strong>
            {t('crew')} {crewChampion.crew}
          </strong>
          <span>
            {crewChampion.points} {t('points')} · {crewChampion.rounds}{' '}
            {t('roundsPlayed')}
          </span>
        </p>
      ) : null}

      {/*
        The same caveat the scoreboard carries, for the same reason: a table
        folded from locally computed scores is a practice result, and a screen
        that crowns somebody is the last place to leave that unsaid.
      */}
      {kind === 'practice' ? (
        <p className="scoreboard__disclaimer">
          <Trophy size={13} />
          Practice session: scores were computed by this browser, not replayed
          by a server.
        </p>
      ) : null}

      <div className="champion__actions">
        {onAnotherRound ? (
          <button
            className="big-button big-button--primary"
            type="button"
            onClick={onAnotherRound}
            disabled={busy}
            data-testid="champion-another-round"
          >
            <RotateCcw size={16} />
            {t('nextRound')}
          </button>
        ) : null}
        <button
          className={`big-button ${onAnotherRound ? '' : 'big-button--primary'}`}
          type="button"
          onClick={onExit}
          data-testid="champion-exit"
        >
          <LogOut size={16} />
          {t('backToMenu')}
        </button>
      </div>
    </main>
  );
}

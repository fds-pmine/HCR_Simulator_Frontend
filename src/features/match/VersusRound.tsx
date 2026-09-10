import { useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useServices } from '../../app/servicesContext';
import {
  SimulationWorkbench,
  type CutterGridEntry,
} from '../../components/layout/SimulationWorkbench';
import type { MatchResults } from '../../types/match';
import type { CompiledProgram } from '../blockly/programTypes';
import { SimulationEngine } from '../simulation/SimulationEngine';
import { runCutterGridHeadless, runHeadless } from '../simulation/headlessRun';
import type { PlayerIdentity } from './identity';
import { MatchHud } from './MatchHud';
import { MatchLobby } from './MatchLobby';
import { MatchScoreboard } from './MatchScoreboard';
import { MatchSetup } from './MatchSetup';
import { SessionChampion } from './SessionChampion';
import { ROUND_COUNTDOWN_MS, isCountingIn, isEndgame, useRemainingMs } from './countdown';
import { resubmitIntervalFor } from './roundRules';
import { assignCrew, crewTotals, crewsFor } from './crews';
import {
  recordCrewRound,
  recordRound,
  type CrewSeason,
  type Season,
} from './season';
import { useMatch } from './useMatch';
import { withFreshCanvas } from '../blockly/blankCanvas';
import { useLocalization } from '../preferences/localization';

interface VersusRoundProps {
  identity: PlayerIdentity;
  onExit: () => void;
}

/**
 * The whole competitive flow: set up, lobby, the round itself, results.
 *
 * The round is played in the ordinary workbench with a HUD over it, rather than
 * in a separate cut-down editor — same blocks, same engine, same scoring, so
 * practice transfers to the round exactly.
 */
export function VersusRound({ identity, onExit }: VersusRoundProps) {
  const { t } = useLocalization();
  const { scoreProvider, matchProvider } = useServices();
  const [session, actions] = useMatch(identity);
  // A season and its crews outlive one round: the room is recreated for every
  // round, but this component is not unmounted by Play Again, so the table
  // survives exactly as long as the sitting does.
  // One piece of state, because both tables are folded from the same round and
  // two setState calls in one effect is two renders for one event.
  const [tables, setTables] = useState<{ season: Season; crews: CrewSeason }>({
    season: [],
    crews: [],
  });
  // Crews and the bar are round settings now, not this browser's opinion: the
  // crews come from the roster the server publishes — assigned if anybody
  // assigned, drawn from the room code otherwise — and the bar is on the config
  // every client reads.
  const crews = crewsFor(session.state?.players ?? [], session.matchId ?? '');
  const format = session.state?.config.format ?? 'solo';
  const crewScoring = session.state?.config.crewScoring ?? 'sum';
  const classTarget = session.state?.config.coopTarget ?? 0;
  const autoAdvanceMs = session.state?.config.autoAdvanceMs ?? 0;
  // The round declares the editor, and every client reads it from the same
  // place. Absent means Servo, which is what every round was before the field.
  const programmingMode = session.state?.config.programmingMode ?? 'servo';
  // Stoppable, because a loop nobody can stop is a loop that runs over the
  // moment the room wanted to talk about a result.
  const [looping, setLooping] = useState(true);
  // Whether the sitting is over. Ending it is what turns the points table into
  // a result: an endless session otherwise just stopped, with the last round's
  // scoreboard left on the projector and the season nobody ever read out.
  const [sessionOver, setSessionOver] = useState(false);

  // Fold each round into the table exactly once.
  //
  // Identity, not the room id: a rematch reopens the *same* room, so keying on
  // `matchId` counted round one and silently ignored every round after it —
  // the table read "1 rounds" all session. `useMatch` publishes one results
  // object per round and clears it when the room reopens, so a new object is
  // exactly a new round.
  const countedRound = useRef<MatchResults | undefined>(undefined);
  const advancedFrom = useRef<MatchResults | undefined>(undefined);
  const results = session.results;
  const roundCrews = session.state?.config.format === 'crews' ? crews : undefined;
  useEffect(() => {
    if (!results || results === countedRound.current) return;
    countedRound.current = results;

    const standings = roundCrews
      ? crewTotals(results.rows, roundCrews, results.rankBy, crewScoring)
      : undefined;

    setTables((previous) => ({
      season: recordRound(previous.season, results),
      crews: standings
        ? recordCrewRound(previous.crews, standings)
        : previous.crews,
    }));
    // The round is the event; the crews are read as they were when it closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  const engine = useMemo(() => {
    if (!session.challenge) {
      return undefined;
    }
    try {
      return new SimulationEngine(session.challenge.challenge, scoreProvider);
    } catch {
      // A challenge whose initial pose already collides cannot be played. The
      // catch keeps that from taking the whole app down with it.
      return undefined;
    }
  }, [session.challenge, scoreProvider]);

  // Everyone starts from the same empty canvas, so the round measures who can
  // write the program rather than who inherits the better head start.
  //
  // Fresh rather than merely blank: a rematch reopens the *same* challenge, and
  // the editor remembers a canvas by challenge signature, so dropping only the
  // starter workspace left round two opening on round one's finished program.
  // Cleared here, during render, because the editor reads that memory as it
  // mounts and an effect would run too late to matter.
  const challenge = useMemo(
    () =>
      session.challenge
        ? withFreshCanvas(session.challenge.challenge)
        : undefined,
    [session.challenge],
  );

  /*
    The endless loop.

    Driven by the one client that opened the room rather than by all of them:
    the server would refuse the losers of that race anyway — `rematch` demands a
    finished round and `start` demands a lobby — but twenty clients racing to
    reopen a room produces nineteen error banners, and an error banner is a
    worse thing to project than a countdown.
  */
  useEffect(() => {
    const results = session.results;
    if (
      !session.opened ||
      !looping ||
      autoAdvanceMs <= 0 ||
      !results ||
      results === advancedFrom.current
    ) {
      return;
    }
    advancedFrom.current = results;

    const timer = setTimeout(() => {
      void actions.rematch().then(() => actions.start());
    }, autoAdvanceMs);
    return () => clearTimeout(timer);
  }, [session.results, session.opened, looping, autoAdvanceMs, actions]);

  const phase = session.state?.phase;
  // Ticks once a tenth of a second while a round runs, so the closing stretch
  // arrives on time rather than on the next 1.2-second poll.
  const remainingMs = useRemainingMs(session.state?.closesAt, session.offsetMs);
  // The same clock, pointed at the start of the round rather than its end.
  const opensAt = session.state?.opensAt;
  const msToGo = useRemainingMs(
    opensAt === undefined ? undefined : opensAt + ROUND_COUNTDOWN_MS,
    session.offsetMs,
  );
  /*
    Who may open a round.

    The server has no host — the room code is the whole permission model — so
    this is a convention, not an authority, and it is enforced by not drawing
    the button rather than by refusing the call. That is enough for the problem
    it solves: twenty people who can all press Start, and all press Next round,
    wiping the scoreboard the room is still reading. The projector opened the
    room, so the projector drives it.
  */
  const isHost = session.opened;

  if (!session.matchId || !session.state) {
    return (
      <MatchSetup
        kind={matchProvider.kind}
        busy={session.busy}
        {...(session.error ? { error: session.error } : {})}
        onHost={(choice) =>
          void actions.host({
            durationMs: choice.durationMs,
            rankBy: choice.rankBy,
            format: choice.format,
            crewScoring: choice.crewScoring,
            ...(choice.coopTarget !== undefined
              ? { coopTarget: choice.coopTarget }
              : {}),
            ...(choice.relaySwapMs !== undefined
              ? { relaySwapMs: choice.relaySwapMs }
              : {}),
            ...(choice.autoAdvanceMs !== undefined
              ? { autoAdvanceMs: choice.autoAdvanceMs }
              : {}),
            programmingMode: choice.programmingMode,
            minSubmitIntervalMs: resubmitIntervalFor(choice.durationMs),
            // Version 1: the catalog serves the latest, and a round pins the
            // version so recalibration cannot move a score mid-round.
            ...(choice.challengeId
              ? { challengeRef: { challengeId: choice.challengeId, version: 1 } }
              : {}),
          })
        }
        onJoin={(code) => void actions.join(code)}
        onBack={onExit}
        onDismissError={actions.dismissError}
      />
    );
  }

  if (sessionOver) {
    return (
      <SessionChampion
        season={tables.season}
        crewSeason={tables.crews}
        identity={identity}
        kind={matchProvider.kind}
        busy={session.busy}
        {...(isHost
          ? {
              onAnotherRound: () => {
                setSessionOver(false);
                setLooping(true);
                void actions.rematch().then(() => actions.start());
              },
            }
          : {})}
        onExit={() => {
          actions.leave();
          onExit();
        }}
      />
    );
  }

  if (phase === 'lobby') {
    return (
      <MatchLobby
        state={session.state}
        identity={identity}
        kind={matchProvider.kind}
        busy={session.busy}
        crews={crews}
        onAssignCrew={(playerId) =>
          void actions.setCrews(assignCrew(crews, playerId))
        }
        format={format}
        isHost={isHost}
        onStart={() => void actions.start()}
        onLeave={() => {
          actions.leave();
          onExit();
        }}
      />
    );
  }

  /*
    3, 2, 1.

    Held on every client until the same instant on the server's clock, so the
    round starts together instead of whenever each browser's poll happened to
    notice it had. The challenge is fetched behind this screen, which is the
    other thing the pause buys: the editor appears with the round already
    loaded rather than after a loading spinner nobody's rivals had to sit
    through.
  */
  if (phase === 'countdown' || (phase === 'running' && isCountingIn(msToGo))) {
    return (
      <main className="bootstrap-screen round-countdown">
        <p className="phase-kicker">{t('roundStarting')}</p>
        <strong className="round-countdown__count" aria-hidden="true">
          {opensAt === undefined ? '—' : Math.ceil(msToGo / 1_000)}
        </strong>
        <h1>{t('closestWins')}</h1>
        <p>{t('simultaneousReveal')}</p>
      </main>
    );
  }

  if (phase === 'cancelled') {
    return (
      <main className="bootstrap-screen">
        <p className="phase-kicker">{t('roundCancelled')}</p>
        <h1>{t('roundAbandoned')}</h1>
        <button type="button" onClick={onExit}>
          {t('backToMenu')}
        </button>
      </main>
    );
  }

  if (!challenge || !engine) {
    return (
      <main className="bootstrap-screen">
        <LoaderCircle className="spin" size={30} />
        <p className="phase-kicker">{t('roundStarting')}</p>
        <h1>{t('revealingChallenge')}</h1>
        <p>{t('simultaneousReveal')}</p>
      </main>
    );
  }

  const handleSubmit = async (compiled: CompiledProgram) => {
    // Evaluate first. Online, the score is discarded and the server replays the
    // IR itself; offline there is no server, so this *is* the score — which is
    // exactly why an offline round is practice. `MatchSubmission.clientScore`.
    const clientScore = await runHeadless(engine, compiled);
    await actions.submit(compiled.program, clientScore);
  };

  /*
    A Cutter Grid entry.

    Scored the same way and by the same engine, from the frozen plan the editor
    has already produced. What travels to the room is the block count and the
    score, not the lattice program: this path is offline-only
    (`MatchSetup`), the offline room replays nothing, and inventing a wire shape
    the backend has not opened yet (`08-CUTTER-GRID.md` §0 keeps V4 out of
    submissions) would be a contract this side made up on its own.
  */
  const handleSubmitCutterGrid = async (entry: CutterGridEntry) => {
    const clientScore = await runCutterGridHeadless(
      engine,
      entry.plan,
      entry.sourceBlockCount,
    );
    await actions.submit(
      { nodes: [], sourceBlockCount: entry.sourceBlockCount },
      clientScore,
    );
  };

  return (
    <SimulationWorkbench
      challenge={challenge}
      engine={engine}
      modeLabel={matchProvider.kind === 'online' ? t('versusRound') : t('practice')}
      availableProgrammingModes={[programmingMode]}
      initialProgrammingMode={programmingMode}
      challengeVersion={session.challenge?.version ?? 1}
      onExit={() => {
        actions.leave();
        onExit();
      }}
      match={{
        hud: (
          <MatchHud
            state={session.state}
            identity={identity}
            offsetMs={session.offsetMs}
            {...(session.lastAck ? { lastAck: session.lastAck } : {})}
          />
        ),
        overlay: session.results ? (
          // The countdown goes to everybody, because everybody is waiting for
          // it; the stop goes only to the machine driving the loop. A control
          // that stopped nothing would be the same lie the crew buttons told.
          <MatchScoreboard
            results={session.results}
            identity={identity}
            kind={matchProvider.kind}
            season={tables.season}
            crews={crews}
            crewScoring={crewScoring}
            format={format}
            classTarget={classTarget}
            crewSeason={tables.crews}
            {...(autoAdvanceMs > 0 && looping ? { autoAdvanceMs } : {})}
            {...(autoAdvanceMs > 0 && looping && isHost
              ? { onStopLoop: () => setLooping(false) }
              : {})}
            {...(isHost && tables.season.length > 0
              ? {
                  onEndSession: () => {
                    setLooping(false);
                    setSessionOver(true);
                  },
                }
              : {})}
            {...(session.state.closesAt !== undefined
              ? { closesAt: session.state.closesAt }
              : {})}
            {...(isHost ? { onNextRound: () => void actions.rematch() } : {})}
            busy={session.busy}
            onPlayAgain={actions.leave}
            onExit={() => {
              actions.leave();
              onExit();
            }}
          />
        ) : (
          // Mounted once, when the challenge lands — which is the moment the
          // round becomes genuinely playable, a poll after the phase flipped.
          // The CSS animation ends on `visibility: hidden`, so it needs no timer
          // to take itself back down.
          <div className="round-flash" aria-hidden="true">
            <strong>{t('go')}</strong>
            <span>{t('closestWins')}</span>
          </div>
        ),
        canSubmit: phase === 'running',
        submitting: session.busy,
        ...(phase === 'running' &&
        isEndgame(remainingMs, session.state.config.durationMs)
          ? { urgent: true }
          : {}),
        onSubmit: (compiled) => void handleSubmit(compiled),
        ...(programmingMode === 'cutter-grid'
          ? {
              onSubmitCutterGrid: (entry: CutterGridEntry) =>
                void handleSubmitCutterGrid(entry),
            }
          : {}),
      }}
    />
  );
}

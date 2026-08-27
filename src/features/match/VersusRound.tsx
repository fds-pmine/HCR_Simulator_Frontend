import { useMemo } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useServices } from '../../app/servicesContext';
import { SimulationWorkbench } from '../../components/layout/SimulationWorkbench';
import type { CompiledProgram } from '../blockly/programTypes';
import { SimulationEngine } from '../simulation/SimulationEngine';
import { runHeadless } from '../simulation/headlessRun';
import type { PlayerIdentity } from './identity';
import { MatchHud } from './MatchHud';
import { MatchLobby } from './MatchLobby';
import { MatchScoreboard } from './MatchScoreboard';
import { MatchSetup } from './MatchSetup';
import { useMatch } from './useMatch';
import { withBlankCanvas } from '../blockly/blankCanvas';
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
  const challenge = useMemo(
    () =>
      session.challenge
        ? withBlankCanvas(session.challenge.challenge)
        : undefined,
    [session.challenge],
  );

  const phase = session.state?.phase;

  if (!session.matchId || !session.state) {
    return (
      <MatchSetup
        kind={matchProvider.kind}
        busy={session.busy}
        {...(session.error ? { error: session.error } : {})}
        onHost={(durationMs, challengeId) =>
          void actions.host({
            durationMs,
            // Version 1: the catalog serves the latest, and a round pins the
            // version so recalibration cannot move a score mid-round.
            ...(challengeId
              ? { challengeRef: { challengeId, version: 1 } }
              : {}),
          })
        }
        onJoin={(code) => void actions.join(code)}
        onBack={onExit}
        onDismissError={actions.dismissError}
      />
    );
  }

  if (phase === 'lobby' || phase === 'countdown') {
    return (
      <MatchLobby
        state={session.state}
        identity={identity}
        kind={matchProvider.kind}
        busy={session.busy}
        onStart={() => void actions.start()}
        onLeave={() => {
          actions.leave();
          onExit();
        }}
      />
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

  return (
    <SimulationWorkbench
      challenge={challenge}
      engine={engine}
      modeLabel={matchProvider.kind === 'online' ? t('versusRound') : t('practice')}
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
          <MatchScoreboard
            results={session.results}
            identity={identity}
            kind={matchProvider.kind}
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
        onSubmit: (compiled) => void handleSubmit(compiled),
      }}
    />
  );
}

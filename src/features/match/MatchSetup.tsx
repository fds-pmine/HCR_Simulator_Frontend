import { useEffect, useState } from 'react';
import { ArrowLeft, Bot, LoaderCircle, Radio, Swords, Wifi, WifiOff } from 'lucide-react';
import type { MatchProvider } from '../../services/contracts';
import type { ChallengeSummary } from '../../types/domain';
import type { CrewScoring, RankBy, RoundFormat } from '../../types/match';
import {
  PROGRAMMING_MODES,
  type ProgrammingMode,
} from '../blockly/programmingMode';
import { useServices } from '../../app/servicesContext';
import {
  CoopDiagram,
  CrewsDiagram,
  SoloDiagram,
  SumDiagram,
  WeakestTwoDiagram,
} from './FormatDiagram';
import { useLocalization } from '../preferences/localization';
import {
  AUTO_ADVANCE,
  COOP_TARGETS,
  CREW_SCORINGS,
  DEFAULT_COOP_TARGET,
  DEFAULT_DURATION_MS,
  DURATIONS,
  FORMATS,
  RANKINGS,
  RELAY_SWAPS,
} from './roundRules';

/** What the host chose for the round they are opening. */
/** Player-facing name and one-line rule for each format. */
const FORMAT_LABEL = {
  solo: 'formatSolo',
  crews: 'formatCrews',
  coop: 'formatCoop',
} as const;

const FORMAT_HINT = {
  solo: 'formatSoloHint',
  crews: 'formatCrewsHint',
  coop: 'formatCoopHint',
} as const;

const FORMAT_DIAGRAM = {
  solo: SoloDiagram,
  crews: CrewsDiagram,
  coop: CoopDiagram,
} as const;

export interface HostChoice {
  durationMs: number;
  rankBy: RankBy;
  challengeId?: string;
  format: RoundFormat;
  coopTarget?: number;
  crewScoring: CrewScoring;
  relaySwapMs?: number;
  autoAdvanceMs?: number;
  programmingMode: ProgrammingMode;
}

interface MatchSetupProps {
  kind: MatchProvider['kind'];
  busy: boolean;
  error?: string;
  onHost: (choice: HostChoice) => void;
  onJoin: (code: string) => void;
  onBack: () => void;
  onDismissError: () => void;
}

export function MatchSetup({
  kind,
  busy,
  error,
  onHost,
  onJoin,
  onBack,
  onDismissError,
}: MatchSetupProps) {
  const { t } = useLocalization();
  const [durationMs, setDurationMs] = useState<number>(DEFAULT_DURATION_MS);
  const [rankBy, setRankBy] = useState<RankBy>('completion');
  const [format, setFormat] = useState<RoundFormat>('solo');
  const [coopTarget, setCoopTarget] = useState<number>(DEFAULT_COOP_TARGET);
  const [crewScoring, setCrewScoring] = useState<CrewScoring>('sum');
  const [relaySwapMs, setRelaySwapMs] = useState(0);
  const [programmingMode, setProgrammingMode] = useState<ProgrammingMode>('servo');
  const [autoAdvanceMs, setAutoAdvanceMs] = useState(0);
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
        {t('menu')}
      </button>

      <header className="menu-screen__head">
        <p className="phase-kicker">
          <Swords size={13} />
          {t('versusRound')}
        </p>
        <h1>{t('versusTitle')}</h1>
        <p className="menu-screen__lede">
          {t('versusIntro')}
        </p>
      </header>

      <div
        className={`connection-note connection-note--${practice ? 'practice' : 'online'}`}
      >
        {practice ? <WifiOff size={15} /> : <Wifi size={15} />}
        <div>
          <strong>{practice ? t('offlinePracticeTitle') : t('backendOnlineTitle')}</strong>
          <span>
            {practice
              ? t('offlinePracticeBody')
              : t('onlineRoundBody')}
          </span>
        </div>
      </div>

      <p className="menu-screen__privacy-note">
        {t('multiplayerPrivacy')}
      </p>

      <div className="menu-screen__columns">
        <section className="menu-card">
          <h2>{t('hostRound')}</h2>
          <p>{t('hostRoundBody')}</p>

          {/*
            The format leads, because it decides what the rest of the panel
            means: a bar belongs to a co-op round and a scoring rule belongs to
            a crew one, and offering either on a solo round would be offering a
            setting that does nothing.
          */}
          {/*
            Cards rather than a segmented control, and the rule written out
            rather than hidden in a tooltip: this is chosen once, in front of a
            waiting room, by somebody who should not have to hover to find out
            what "co-op" does to the round.
          */}
          <div className="format-cards" role="radiogroup" aria-label={t('roundFormat')}>
            {FORMATS.map((option) => {
              const Diagram = FORMAT_DIAGRAM[option];
              const chosen = format === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  className={`format-card ${chosen ? 'is-active' : ''}`}
                  onClick={() => setFormat(option)}
                  aria-checked={chosen}
                  data-testid={`format-${option}`}
                >
                  <Diagram />
                  <strong>{t(FORMAT_LABEL[option])}</strong>
                  <span>{t(FORMAT_HINT[option])}</span>
                </button>
              );
            })}
          </div>

          {format === 'coop' ? (
            <div className="segmented" role="group" aria-label={t('classTarget')}>
              <span>{t('classTarget')}</span>
              {COOP_TARGETS.map((target) => (
                <button
                  key={target}
                  type="button"
                  className={coopTarget === target ? 'is-active' : ''}
                  onClick={() => setCoopTarget(target)}
                  aria-pressed={coopTarget === target}
                  data-testid={`coop-target-${target}`}
                >
                  {target}
                </button>
              ))}
            </div>
          ) : null}

          {format === 'crews' ? (
            <div
              className="format-cards format-cards--pair"
              role="radiogroup"
              aria-label={t('crewScoring')}
            >
              {CREW_SCORINGS.map((option) => {
                const Diagram = option === 'sum' ? SumDiagram : WeakestTwoDiagram;
                const chosen = crewScoring === option;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    className={`format-card ${chosen ? 'is-active' : ''}`}
                    onClick={() => setCrewScoring(option)}
                    aria-checked={chosen}
                    data-testid={`crew-scoring-${option}`}
                  >
                    <Diagram />
                    <strong>{t(option === 'sum' ? 'crewSum' : 'crewWeakestTwo')}</strong>
                    <span>{t(option === 'sum' ? 'crewSumHint' : 'crewWeakestTwoHint')}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {/*
            Which editor the round is played in. Everyone plays in the same one
            — the two are different exercises on the same challenge, so a mixed
            round would rank two things and publish one table.

            Offline only, for now. The offline room plans and scores the route
            in this browser, which is all a practice round ever needed; the
            online path is closed until the backend opens V4 planning to
            submissions (`08-CUTTER-GRID.md` §0), and offering a mode whose
            submissions the server would refuse is worse than not offering it.
          */}
          <div className="segmented" role="group" aria-label={t('programmingMode')}>
            <span>{t('programmingMode')}</span>
            {PROGRAMMING_MODES.map((mode) => {
              const unavailable = mode === 'cutter-grid' && !practice;
              return (
                <button
                  key={mode}
                  type="button"
                  className={programmingMode === mode ? 'is-active' : ''}
                  onClick={() => setProgrammingMode(mode)}
                  aria-pressed={programmingMode === mode}
                  disabled={unavailable}
                  {...(unavailable ? { title: t('gridRoundOfflineOnly') } : {})}
                  data-testid={`round-mode-${mode}`}
                >
                  {mode === 'servo' ? t('servoAnglesMode') : t('cutterGridMode')}
                </button>
              );
            })}
          </div>

          {programmingMode === 'cutter-grid' ? (
            <p className="menu-card__foot" data-testid="grid-round-note">
              {t('gridRoundNote')}
            </p>
          ) : null}

          <div className="segmented" role="group" aria-label={t('roundLength')}>
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

          {/*
            Which metric decides the round. Both are computed for every
            submission either way; this chooses the one the standings are
            ordered by, and the scoreboard shows the other alongside it.
          */}
          <div className="segmented" role="group" aria-label={t('rankedBy')}>
            {RANKINGS.map((option) => (
              <button
                key={option}
                type="button"
                className={rankBy === option ? 'is-active' : ''}
                onClick={() => setRankBy(option)}
                aria-pressed={rankBy === option}
                title={option === 'completion' ? t('accuracyRankHint') : t('efficiencyRankHint')}
                data-testid={`rank-by-${option}`}
              >
                {option === 'completion' ? t('similarityMetric') : t('finalScoreMetric')}
              </button>
            ))}
          </div>

          {/*
            Endless: the round reopens itself. A session stops being a thing
            somebody drives between every round and becomes a thing that runs,
            which is the difference between a class that plays three rounds and
            one that plays ten.
          */}
          <div className="segmented" role="group" aria-label={t('endless')}>
            <span>{t('endless')}</span>
            <button
              type="button"
              className={autoAdvanceMs === 0 ? 'is-active' : ''}
              onClick={() => setAutoAdvanceMs(0)}
              aria-pressed={autoAdvanceMs === 0}
              data-testid="endless-off"
            >
              {t('classTargetOff')}
            </button>
            {AUTO_ADVANCE.map((gap) => (
              <button
                key={gap}
                type="button"
                className={autoAdvanceMs === gap ? 'is-active' : ''}
                onClick={() => setAutoAdvanceMs(gap)}
                aria-pressed={autoAdvanceMs === gap}
                data-testid={`endless-${gap / 1_000}`}
              >
                {gap / 1_000}s
              </button>
            ))}
          </div>

          {/*
            Orthogonal to the format on purpose: a relay is about who is at the
            keyboard, not about how the round is scored, so any format can be
            played on shared machines.
          */}
          <div className="segmented" role="group" aria-label={t('relaySwap')}>
            <span>{t('relaySwap')}</span>
            <button
              type="button"
              className={relaySwapMs === 0 ? 'is-active' : ''}
              onClick={() => setRelaySwapMs(0)}
              aria-pressed={relaySwapMs === 0}
              data-testid="relay-off"
            >
              {t('classTargetOff')}
            </button>
            {RELAY_SWAPS.map((swap) => (
              <button
                key={swap}
                type="button"
                className={relaySwapMs === swap ? 'is-active' : ''}
                onClick={() => setRelaySwapMs(swap)}
                aria-pressed={relaySwapMs === swap}
                data-testid={`relay-${swap / 1_000}`}
              >
                {swap / 1_000}s
              </button>
            ))}
          </div>

          {catalog.length > 1 ? (
            <label className="host-choice">
              <span>{t('challenge')}</span>
              <select
                value={challengeId}
                onChange={(event) => setChallengeId(event.target.value)}
                aria-label={t('challengeForRound')}
              >
                <option value="">{t('serverChoose')}</option>
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
            onClick={() =>
              onHost({
                durationMs,
                rankBy,
                format,
                crewScoring,
                programmingMode,
                ...(format === 'coop' ? { coopTarget } : {}),
                ...(relaySwapMs > 0 ? { relaySwapMs } : {}),
                ...(autoAdvanceMs > 0 ? { autoAdvanceMs } : {}),
                ...(challengeId ? { challengeId } : {}),
              })
            }
          >
            {busy ? <LoaderCircle className="spin" size={17} /> : <Radio size={17} />}
            {t('openRoom')}
          </button>

          {practice ? (
            <p className="menu-card__foot">
              <Bot size={13} />
              {t('practiceBots')}
            </p>
          ) : null}
        </section>

        <section className="menu-card">
          <h2>{t('joinRound')}</h2>
          <p>{t('joinRoundBody')}</p>

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
              placeholder={t('roomCode')}
              aria-label={t('roomCodeLabel')}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              className="big-button"
              type="submit"
              disabled={busy || !code.trim()}
            >
              {t('joinRoom')}
            </button>
          </form>

          {practice ? (
            <p className="menu-card__foot">
              {t('offlineRoomOnly')}
            </p>
          ) : null}
        </section>
      </div>

      {error ? (
        <div className="error-banner error-banner--static" role="alert">
          <strong>{t('roundError')}</strong>
          <span>{error}</span>
          <button type="button" onClick={onDismissError} aria-label={t('dismissError')}>
            ×
          </button>
        </div>
      ) : null}
    </main>
  );
}

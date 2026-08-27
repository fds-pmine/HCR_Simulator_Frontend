import { Eye, EyeOff, Target } from 'lucide-react';
import type { Challenge } from '../../types/domain';
import type { SimulationSnapshot } from '../../features/simulation/SimulationEngine';
import type {
  CutterGridProfileV1,
  CutterGridProfileV2,
  CutterGridProfileV3,
  CutterGridProfileV4,
  CutterTrajectoryPlanV1,
  CutterTrajectoryPlanV2,
  CutterTrajectoryPlanV3,
  CutterTrajectoryPlanV4,
} from '../../features/cutter-grid/types';
import type { CutterGridPlannerSource } from '../../features/cutter-grid/plannerProvider';
import {
  SERVO_AXIS_ORDER,
  servoAnglesFromJointAngles,
} from '../../features/robot/servoMapping';
import { useLocalization } from '../../features/preferences/localization';
import { DEFAULT_CHALLENGE_ID } from '../../data/challenges/defaultChallenge';
import { LESSONS } from '../../data/challenges/lessons';
import { localizeServoLesson } from '../../features/tutorial/servoLessonLocalization';
import { hcrBlockCopy } from '../../features/blockly/blocklyLocalization';

interface InspectorPanelProps {
  challenge: Challenge;
  snapshot: SimulationSnapshot;
  showTarget: boolean;
  onToggleTarget: () => void;
  cutterGrid?: {
    profile: CutterGridProfileV1 | CutterGridProfileV2 | CutterGridProfileV3 | CutterGridProfileV4;
    plan?: CutterTrajectoryPlanV1 | CutterTrajectoryPlanV2 | CutterTrajectoryPlanV3 | CutterTrajectoryPlanV4;
    plannerSource?: CutterGridPlannerSource;
    visible: boolean;
    onToggle: () => void;
  };
}

const STATUS_KEYS = {
  loading: 'loading', positioning: 'positioning', planning: 'planning',
  idle: 'idle', running: 'running', paused: 'paused', completed: 'completed',
  stopped: 'stopped', error: 'error',
} as const;

const SERVO_AXIS_KEYS = {
  X: 'baseYaw', Y: 'shoulder', Z: 'elbow', B: 'wrist', E: 'cutterParked',
} as const;

export function InspectorPanel({
  challenge,
  snapshot,
  showTarget,
  onToggleTarget,
  cutterGrid,
}: InspectorPanelProps) {
  const { locale, t } = useLocalization();
  const blockCopy = hcrBlockCopy(locale);
  const lesson = LESSONS.find(({ id }) => id === challenge.id);
  const displayLesson = lesson ? localizeServoLesson(lesson, locale) : undefined;
  const challengeName = challenge.id === DEFAULT_CHALLENGE_ID
    ? t('defaultChallengeName')
    : displayLesson?.name ?? challenge.name;
  const challengeDescription = challenge.id === DEFAULT_CHALLENGE_ID
    ? t('defaultChallengeDescription')
    : displayLesson?.description ?? challenge.description;
  const result = snapshot.scoreResult;
  const servoAngles = servoAnglesFromJointAngles(
    challenge.robotConfig,
    snapshot.jointAngles,
  );
  const jointByServoAxis = new Map(
    challenge.robotConfig.joints.flatMap((joint) =>
      joint.servo ? [[joint.servo.axis, joint] as const] : [],
    ),
  );
  const simulationOnlyJoints = challenge.robotConfig.joints.filter(
    (joint) => !joint.servo,
  );

  return (
    <div className="inspector">
      <section className="inspector-section challenge-card">
        <div className="section-heading">
          <span>{t('challenge')} 01</span>
          <span
            className={`status-pill status-pill--${snapshot.status}`}
            data-testid="simulation-status"
          >
            {t(STATUS_KEYS[snapshot.status])}
          </span>
        </div>
        <h2>{challengeName}</h2>
        <p>{challengeDescription}</p>
        <button
          type="button"
          className={`target-toggle ${showTarget ? 'is-active' : ''}`}
          onClick={onToggleTarget}
          aria-pressed={showTarget}
        >
          {showTarget ? <Eye size={15} /> : <EyeOff size={15} />}
          {t('targetPreview')}
          <span>{showTarget ? t('on') : t('off')}</span>
        </button>
      </section>

      {cutterGrid ? (
        <section className="inspector-section cutter-grid-inspector">
          <div className="section-heading">
            <span>{t('cutterGrid')}</span>
            <span>{t('worldAxes')}</span>
          </div>
          <button
            type="button"
            className={`target-toggle ${cutterGrid.visible ? 'is-active' : ''}`}
            onClick={cutterGrid.onToggle}
            aria-pressed={cutterGrid.visible}
          >
            {cutterGrid.visible ? <Eye size={15} /> : <EyeOff size={15} />}
            {t('gridPlannedPath')}
            <span>{cutterGrid.visible ? t('on') : t('off')}</span>
          </button>
          <dl className="cutter-grid-summary">
            <div><dt>{t('axes')}</dt><dd>{`+X ${blockCopy.moveDirection.right} · +Y ${blockCopy.moveDirection.up} · −Z ${blockCopy.moveDirection.forward}`}</dd></div>
            <div><dt>{t('current')}</dt><dd>({(snapshot.cutterGrid?.currentCoord ?? [0, 0, 0]).join(', ')})</dd></div>
            <div><dt>{t('next')}</dt><dd>{snapshot.cutterGrid?.nextCoord ? `(${snapshot.cutterGrid.nextCoord.join(', ')})` : '—'}</dd></div>
            <div><dt>{t('progress')}</dt><dd>{snapshot.cutterGrid ? `${snapshot.cutterGrid.stepIndex}/${snapshot.cutterGrid.totalSteps} · ${Math.round(snapshot.cutterGrid.stepProgress * 100)}%` : t('notPlanned')}</dd></div>
            <div><dt>{t('pathState')}</dt><dd>{snapshot.cutterGrid?.diagnostics ? t('connectedProgram') : t('staticIkOnly')}</dd></div>
            <div><dt>{t('branch')}</dt><dd>{snapshot.cutterGrid?.entryOptionId ?? cutterGridEntryOptionId(cutterGrid.plan)}</dd></div>
            {snapshot.cutterGrid?.diagnostics && 'seedBudgetUsed' in snapshot.cutterGrid.diagnostics ? (
              <div><dt>{t('search')}</dt><dd>{`${snapshot.cutterGrid.diagnostics.seedBudgetUsed} · ${snapshot.cutterGrid.diagnostics.candidateCounts.join('/')}`}</dd></div>
            ) : null}
            <div><dt>{t('trajectory')}</dt><dd>{snapshot.cutterGrid?.trajectorySignature ?? cutterGrid.plan?.trajectorySignature ?? '—'}</dd></div>
            {cutterGrid.plannerSource ? (
              <div><dt>{t('planner')}</dt><dd>{cutterGrid.plannerSource === 'rust-backend' ? 'Rust backend' : 'TypeScript fallback'}</dd></div>
            ) : null}
            {cutterGrid.plan?.version === 4 ? (
              <>
                <div><dt>{t('motion')}</dt><dd>{`${cutterGrid.plan.actions.filter((action) => action.type === 'move').reduce((sum, action) => sum + action.primitives.length, 0)} synchronized PTP`}</dd></div>
                <div><dt>{t('expectedCuts')}</dt><dd>{cutterGrid.plan.actions.reduce((sum, action) => sum + action.expectedCutVoxels.length, 0)}</dd></div>
                <div><dt>{t('speed')}</dt><dd>{`${formatNumber(cutterGrid.plan.diagnostics.actualSpeedScale, 2)}x / ${formatNumber(cutterGrid.plan.diagnostics.requestedSpeedScale, 2)}x`}</dd></div>
              </>
            ) : null}
          </dl>
          {snapshot.cutterGrid?.motionDiagnostics ? (
            <details className="cutter-grid-motion-diagnostics" data-testid="cutter-grid-motion-diagnostics">
              <summary>{t('motion')} · DEV</summary>
              <dl className="cutter-grid-summary">
                <div><dt>Frames</dt><dd>{snapshot.cutterGrid.motionDiagnostics.frameCount}</dd></div>
                <div><dt>Long frames</dt><dd>{snapshot.cutterGrid.motionDiagnostics.longFrameCount}</dd></div>
                <div><dt>Max interval</dt><dd>{formatNumber(snapshot.cutterGrid.motionDiagnostics.maximumFrameIntervalMs, 1)} ms</dd></div>
                <div><dt>Max joint error</dt><dd>{formatNumber(snapshot.cutterGrid.motionDiagnostics.maximumJointTrackingErrorDeg, 6)}°</dd></div>
                <div><dt>Max tip error</dt><dd>{formatNumber(snapshot.cutterGrid.motionDiagnostics.maximumEndEffectorTrackingError, 8)} m</dd></div>
                {snapshot.cutterGrid.motionDiagnostics.lastFrame ? (
                  <>
                    <div><dt>Last plan time</dt><dd>{formatNumber(snapshot.cutterGrid.motionDiagnostics.lastFrame.planTimeMs, 1)} ms · {snapshot.cutterGrid.motionDiagnostics.lastFrame.phase}</dd></div>
                    <div><dt>Last segment</dt><dd>{snapshot.cutterGrid.motionDiagnostics.lastFrame.stepIndex < 0 ? 'system positioning' : `step ${snapshot.cutterGrid.motionDiagnostics.lastFrame.stepIndex + 1}`}</dd></div>
                  </>
                ) : null}
              </dl>
              {snapshot.cutterGrid.motionDiagnostics.lastFrame ? (
                <div className="cutter-grid-motion-joints">
                  {challenge.robotConfig.joints.map((joint) => {
                    const frame = snapshot.cutterGrid?.motionDiagnostics?.lastFrame;
                    if (!frame) return null;
                    return (
                      <div key={joint.id}>
                        <strong>{joint.name}</strong>
                        <span>q {formatNumber(frame.plannedJointAngles[joint.id], 3)}°</span>
                        <span>v {formatNumber(frame.plannedJointVelocitiesDegPerSec[joint.id], 2)}</span>
                        <span>a {formatNumber(frame.plannedJointAccelerationsDegPerSec2[joint.id], 2)}</span>
                        <span>j {formatNumber(frame.plannedJointJerksDegPerSec3[joint.id], 2)}</span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </details>
          ) : null}
          <div className="cutter-grid-legend" aria-label={t('cutterGrid')}>
            <span><i className="is-reachable" />{t('safeIkKnown')}</span>
            <span><i className="is-blocked" />{t('noSafeIk')}</span>
            <span><i className="is-executed" />{t('executed')}</span>
            <span><i className="is-planned" />{t('planned')}</span>
          </div>
        </section>
      ) : null}

      <section className="inspector-section" aria-label={t('servoAngles')}>
        <div className="section-heading">
          <span>{t('servoAngles')}</span>
          <span>{t('liveDegrees')}</span>
        </div>
        <div className="servo-angle-grid">
          {SERVO_AXIS_ORDER.map((axis) => {
            const joint = jointByServoAxis.get(axis);
            return (
              <div
                className={`servo-angle-cell ${
                  joint?.id === snapshot.activeJointId ? 'is-active' : ''
                }`}
                key={axis}
                title={joint ? `${axis} · ${joint.name}` : `${axis} · Cutter (parked)`}
              >
                <strong>{axis}</strong>
                <output data-testid={`servo-angle-${axis}`}>
                  {formatNumber(servoAngles[axis], 1)}°
                </output>
                <small>{t(SERVO_AXIS_KEYS[axis])}</small>
              </div>
            );
          })}
        </div>
      </section>

      <section className="inspector-section">
        <div className="section-heading">
          <span>{t('modelState')}</span>
          <span>{t('simulationOnly')}</span>
        </div>
        <div className="joint-list">
          {simulationOnlyJoints.map((joint) => (
            <div
              className={`joint-row ${
                snapshot.activeJointId === joint.id ? 'is-active' : ''
              }`}
              key={joint.id}
            >
              <div>
                <strong>{joint.name}</strong>
                <small>{joint.id}</small>
              </div>
              <output>{formatNumber(snapshot.jointAngles[joint.id], 1)}°</output>
            </div>
          ))}
        </div>
        <div className="coordinate-readout">
          <span>{t('endEffector')}</span>
          <div>
            {(['X', 'Y', 'Z'] as const).map((axis, index) => (
              <span key={axis}>
                <small>{axis}</small>
                {formatNumber(snapshot.endEffector[index], 2)}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="inspector-section">
        <div className="section-heading">
          <span>{t('runMetrics')}</span>
          <span>{t('live')}</span>
        </div>
        <div className="metric-grid">
          <Metric
            label={t('currentVoxels')}
            value={snapshot.hairVoxels.size}
            testId="current-voxel-count"
          />
          <Metric label={t('targetVoxels')} value={snapshot.targetVoxelCount} />
          <Metric
            label={t('sourceBlocks')}
            value={snapshot.metrics.sourceBlockCount}
            testId="source-block-count"
          />
          <Metric
            label={t('executedCommands')}
            value={snapshot.metrics.executedCommandCount}
            testId="executed-command-count"
          />
        </div>
        <div className="duration-row">
          <span>{t('estimatedDuration')}</span>
          <strong>
            {(snapshot.metrics.estimatedDurationMs / 1_000).toFixed(2)}s
          </strong>
        </div>
      </section>

      <section className="inspector-section result-section">
        <div className="section-heading">
          <span>{t('scoreBreakdown')}</span>
          <Target size={14} />
        </div>
        {result ? (
          <>
            <div className="final-score">
              <span>{t('finalScore')}</span>
              <strong data-testid="final-score">
                {result.finalScore.toFixed(1)}
              </strong>
              <small>/ 100</small>
            </div>
            <div className="score-bars">
              <ScoreBar
                label={t('completion')}
                score={result.completionScore}
                testId="completion-score"
              />
              <ScoreBar
                label={t('programEfficiency')}
                score={result.efficiencyScore}
              />
              <ScoreBar label={t('time')} score={result.timeScore} />
            </div>
          </>
        ) : (
          <div className="result-placeholder">
            {snapshot.status === 'stopped'
              ? t('scoreStopped')
              : t('scorePending')}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  testId,
}: {
  label: string;
  value: number;
  testId?: string;
}) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong data-testid={testId}>{value}</strong>
    </div>
  );
}

function ScoreBar({
  label,
  score,
  testId,
}: {
  label: string;
  score: number;
  testId?: string;
}) {
  return (
    <div className="score-row">
      <div>
        <span>{label}</span>
        <strong data-testid={testId}>{score.toFixed(1)}</strong>
      </div>
      <div className="score-track">
        <span style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </div>
    </div>
  );
}

function cutterGridEntryOptionId(
  plan:
    | CutterTrajectoryPlanV1
    | CutterTrajectoryPlanV2
    | CutterTrajectoryPlanV3
    | CutterTrajectoryPlanV4
    | undefined,
): string {
  if (!plan || plan.version === 1) return '—';
  return plan.version === 4 ? plan.positioning.entryOptionId : plan.entryOptionId;
}

function formatNumber(value: number | undefined, digits: number): string {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : '—';
}

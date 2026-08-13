import { Eye, EyeOff, Target } from 'lucide-react';
import type { Challenge } from '../../types/domain';
import type { SimulationSnapshot } from '../../features/simulation/SimulationEngine';
import type {
  CutterGridProfileV1,
  CutterGridProfileV2,
  CutterTrajectoryPlanV1,
  CutterTrajectoryPlanV2,
} from '../../features/cutter-grid/types';

interface InspectorPanelProps {
  challenge: Challenge;
  snapshot: SimulationSnapshot;
  showTarget: boolean;
  onToggleTarget: () => void;
  cutterGrid?: {
    profile: CutterGridProfileV1 | CutterGridProfileV2;
    plan?: CutterTrajectoryPlanV1 | CutterTrajectoryPlanV2;
    visible: boolean;
    onToggle: () => void;
  };
}

const STATUS_LABELS: Record<SimulationSnapshot['status'], string> = {
  loading: 'Loading',
  positioning: 'Positioning',
  planning: 'Planning',
  idle: 'Idle',
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
  stopped: 'Stopped',
  error: 'Error',
};

export function InspectorPanel({
  challenge,
  snapshot,
  showTarget,
  onToggleTarget,
  cutterGrid,
}: InspectorPanelProps) {
  const result = snapshot.scoreResult;

  return (
    <div className="inspector">
      <section className="inspector-section challenge-card">
        <div className="section-heading">
          <span>CHALLENGE 01</span>
          <span
            className={`status-pill status-pill--${snapshot.status}`}
            data-testid="simulation-status"
          >
            {STATUS_LABELS[snapshot.status]}
          </span>
        </div>
        <h2>{challenge.name}</h2>
        <p>{challenge.description}</p>
        <button
          type="button"
          className={`target-toggle ${showTarget ? 'is-active' : ''}`}
          onClick={onToggleTarget}
          aria-pressed={showTarget}
        >
          {showTarget ? <Eye size={15} /> : <EyeOff size={15} />}
          Target Hairstyle Preview
          <span>{showTarget ? 'ON' : 'OFF'}</span>
        </button>
      </section>

      {cutterGrid ? (
        <section className="inspector-section cutter-grid-inspector">
          <div className="section-heading">
            <span>CUTTER GRID</span>
            <span>WORLD AXES</span>
          </div>
          <button
            type="button"
            className={`target-toggle ${cutterGrid.visible ? 'is-active' : ''}`}
            onClick={cutterGrid.onToggle}
            aria-pressed={cutterGrid.visible}
          >
            {cutterGrid.visible ? <Eye size={15} /> : <EyeOff size={15} />}
            Grid and planned path
            <span>{cutterGrid.visible ? 'ON' : 'OFF'}</span>
          </button>
          <dl className="cutter-grid-summary">
            <div><dt>Axes</dt><dd>+X Right · +Y Up · −Z Forward</dd></div>
            <div><dt>Current</dt><dd>({(snapshot.cutterGrid?.currentCoord ?? [0, 0, 0]).join(', ')})</dd></div>
            <div><dt>Next</dt><dd>{snapshot.cutterGrid?.nextCoord ? `(${snapshot.cutterGrid.nextCoord.join(', ')})` : '—'}</dd></div>
            <div><dt>Progress</dt><dd>{snapshot.cutterGrid ? `${snapshot.cutterGrid.stepIndex}/${snapshot.cutterGrid.totalSteps} · ${Math.round(snapshot.cutterGrid.stepProgress * 100)}%` : 'Not planned'}</dd></div>
            <div><dt>Path state</dt><dd>{snapshot.cutterGrid?.diagnostics ? 'Connected for this program' : 'Static IK map only'}</dd></div>
            <div><dt>Branch</dt><dd>{snapshot.cutterGrid?.entryOptionId ?? (cutterGrid.plan?.version === 2 ? cutterGrid.plan.entryOptionId : '—')}</dd></div>
            {snapshot.cutterGrid?.diagnostics ? (
              <div><dt>Search</dt><dd>{`${snapshot.cutterGrid.diagnostics.seedBudgetUsed} seeds · ${snapshot.cutterGrid.diagnostics.candidateCounts.join('/')} candidates`}</dd></div>
            ) : null}
            <div><dt>Trajectory</dt><dd>{snapshot.cutterGrid?.trajectorySignature ?? cutterGrid.plan?.trajectorySignature ?? '—'}</dd></div>
          </dl>
          <div className="cutter-grid-legend" aria-label="Cutter Grid legend">
            <span><i className="is-reachable" />Safe IK known</span>
            <span><i className="is-blocked" />No safe IK found</span>
            <span><i className="is-executed" />Executed</span>
            <span><i className="is-planned" />Planned</span>
          </div>
        </section>
      ) : null}

      <section className="inspector-section">
        <div className="section-heading">
          <span>JOINT TELEMETRY</span>
          <span>DEG</span>
        </div>
        <div className="joint-list">
          {challenge.robotConfig.joints.map((joint) => (
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
          <span>END EFFECTOR</span>
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
          <span>RUN METRICS</span>
          <span>LIVE</span>
        </div>
        <div className="metric-grid">
          <Metric
            label="Current Voxels"
            value={snapshot.hairVoxels.size}
            testId="current-voxel-count"
          />
          <Metric label="Target Voxels" value={snapshot.targetVoxelCount} />
          <Metric
            label="Source Blocks"
            value={snapshot.metrics.sourceBlockCount}
            testId="source-block-count"
          />
          <Metric
            label="Executed Commands"
            value={snapshot.metrics.executedCommandCount}
            testId="executed-command-count"
          />
        </div>
        <div className="duration-row">
          <span>Estimated Duration</span>
          <strong>
            {(snapshot.metrics.estimatedDurationMs / 1_000).toFixed(2)}s
          </strong>
        </div>
      </section>

      <section className="inspector-section result-section">
        <div className="section-heading">
          <span>SCORE BREAKDOWN</span>
          <Target size={14} />
        </div>
        {result ? (
          <>
            <div className="final-score">
              <span>FINAL SCORE</span>
              <strong data-testid="final-score">
                {result.finalScore.toFixed(1)}
              </strong>
              <small>/ 100</small>
            </div>
            <div className="score-bars">
              <ScoreBar
                label="Completion"
                score={result.completionScore}
                testId="completion-score"
              />
              <ScoreBar
                label="Program Efficiency"
                score={result.efficiencyScore}
              />
              <ScoreBar label="Time" score={result.timeScore} />
            </div>
          </>
        ) : (
          <div className="result-placeholder">
            {snapshot.status === 'stopped'
              ? 'Stopped: current metrics are provisional; no official score was generated.'
              : 'Official scores will appear here after the program completes normally.'}
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

function formatNumber(value: number | undefined, digits: number): string {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : '—';
}

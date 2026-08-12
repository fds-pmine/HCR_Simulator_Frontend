import { Eye, EyeOff, Target } from 'lucide-react';
import type { Challenge } from '../../types/domain';
import type { SimulationSnapshot } from '../../features/simulation/SimulationEngine';

interface InspectorPanelProps {
  challenge: Challenge;
  snapshot: SimulationSnapshot;
  showTarget: boolean;
  onToggleTarget: () => void;
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

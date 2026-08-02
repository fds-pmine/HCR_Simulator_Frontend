import type {
  JointConfig,
  RobotState,
  ScoreInput,
  ScoreResult,
  ScoringConfig,
  TimingCommand,
} from '../../types/domain';
import { calculateTrimScore } from '../voxel/similarity';

const SCORE_MAX = 100;
const WEIGHT_TOLERANCE = 1e-6;

export function calculateScore(input: ScoreInput): ScoreResult {
  validateScoringConfig(input.scoring);

  const completionScore = clampScore(
    calculateTrimScore(
      input.initialVoxels,
      input.targetVoxels,
      input.resultVoxels,
    ),
  );
  const programCost =
    input.programMetrics.sourceBlockCount +
    input.scoring.commandWeight *
      input.programMetrics.executedCommandCount;
  const efficiencyScore =
    programCost === 0
      ? SCORE_MAX
      : clampScore(
          (input.scoring.referenceProgramCost / programCost) * SCORE_MAX,
        );
  const timeScore =
    input.programMetrics.estimatedDurationMs === 0
      ? SCORE_MAX
      : clampScore(
          (input.scoring.referenceTimeMs /
            input.programMetrics.estimatedDurationMs) *
            SCORE_MAX,
        );
  const finalScore = clampScore(
    input.scoring.weights.completion * completionScore +
      input.scoring.weights.efficiency * efficiencyScore +
      input.scoring.weights.time * timeScore,
  );

  return {
    completionScore,
    efficiencyScore,
    timeScore,
    finalScore,
    programCost,
  };
}

export function estimateProgramDuration(
  commands: readonly TimingCommand[],
  joints: readonly JointConfig[],
  initialState?: RobotState,
): number {
  const configById = new Map(joints.map((joint) => [joint.id, joint]));
  const angles: Record<string, number> = Object.fromEntries(
    joints.map((joint) => [
      joint.id,
      initialState?.joints[joint.id] ?? joint.initialAngleDeg,
    ]),
  );

  let durationMs = 0;

  for (const command of commands) {
    if (command.type === 'wait') {
      if (!Number.isFinite(command.durationMs) || command.durationMs < 0) {
        throw new Error('Wait duration must be a finite non-negative number.');
      }
      durationMs += command.durationMs;
      continue;
    }

    const config = configById.get(command.jointId);
    if (!config) {
      throw new Error(`Unknown joint "${command.jointId}".`);
    }
    if (
      !Number.isFinite(command.angleDeg) ||
      command.angleDeg < config.minAngleDeg ||
      command.angleDeg > config.maxAngleDeg
    ) {
      throw new Error(
        `Angle ${command.angleDeg} is outside the range for "${command.jointId}".`,
      );
    }

    const currentAngle = angles[command.jointId];
    durationMs +=
      (Math.abs(command.angleDeg - currentAngle) /
        config.speedDegPerSec) *
      1000;
    angles[command.jointId] = command.angleDeg;
  }

  return durationMs;
}

export function validateScoringConfig(config: ScoringConfig): void {
  const weights = Object.values(config.weights);
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0)) {
    throw new Error('Score weights must be finite non-negative numbers.');
  }

  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(total - 1) > WEIGHT_TOLERANCE) {
    throw new Error('Score weights must sum to 1.');
  }

  if (
    !Number.isFinite(config.referenceProgramCost) ||
    config.referenceProgramCost <= 0
  ) {
    throw new Error('Reference program cost must be greater than 0.');
  }
  if (
    !Number.isFinite(config.referenceTimeMs) ||
    config.referenceTimeMs <= 0
  ) {
    throw new Error('Reference time must be greater than 0.');
  }
  if (!Number.isFinite(config.commandWeight) || config.commandWeight < 0) {
    throw new Error('Command weight must be a finite non-negative number.');
  }
}

function clampScore(score: number): number {
  return Math.min(SCORE_MAX, Math.max(0, score));
}

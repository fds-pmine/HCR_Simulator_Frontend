import { describe, expect, it } from 'vitest';
import { defaultChallengeDefinition } from '../../src/data/challenges/defaultChallenge';
import { RobotController } from '../../src/features/robot/RobotController';
import {
  replayLegacyCommands,
  replaySynchronizedTrajectory,
  verifyScalpCompatibility,
  type TrajectoryPlan,
} from '../../src/features/scalp-path';
import { computeRobotPose, createInitialJointAngles } from '../../src/features/robot/kinematics';
import { normalizeChallenge } from '../../src/services/normalizeChallenge';
import type { Challenge, Vec3Tuple, VoxelKey } from '../../src/types/domain';

const base = normalizeChallenge(defaultChallengeDefinition);

describe('synchronized Scalp Turtle trajectories', () => {
  it('interpolates every joint over the same normalized progress', () => {
    const controller = new RobotController(base.robotConfig);
    const start = controller.getAngles();
    const target = {
      ...start,
      baseYaw: -25,
      shoulder: 65,
      elbow: -60,
    };
    controller.beginPoseMove(target, 1_000);
    controller.advancePoseMove(500);

    const middle = controller.getAngles();
    expect(middle.baseYaw).toBeCloseTo((start.baseYaw + target.baseYaw) / 2, 8);
    expect(middle.shoulder).toBeCloseTo((start.shoulder + target.shoulder) / 2, 8);
    expect(middle.elbow).toBeCloseTo((start.elbow + target.elbow) / 2, 8);
  });

  it('treats Hover contact as an error while Cut stays equivalent to legacy IR', () => {
    const { challenge, plan, commands } = oneSweep('cut');
    const equivalent = verifyScalpCompatibility(plan, commands, challenge);

    expect(equivalent.valid).toBe(true);
    expect(equivalent.synchronized.hairVoxels).toEqual(new Set<VoxelKey>());
    expect(equivalent.legacy.hairVoxels).toEqual(new Set<VoxelKey>());

    const hover = oneSweep('hover');
    const synchronized = replaySynchronizedTrajectory(hover.plan, hover.challenge);
    const legacy = replayLegacyCommands(hover.commands, hover.challenge);

    expect(synchronized.status).toBe('error');
    expect(synchronized.error).toContain('Hover or transit');
    expect(legacy.status).toBe('completed');
    expect(legacy.hairVoxels).toEqual(new Set<VoxelKey>());
  });

  it('reports a collision at the last safe synchronized pose', () => {
    const controller = new RobotController(base.robotConfig, () => ({
      part: 'end-effector',
      partLabel: 'End Effector',
    }));
    const target = { ...controller.getAngles(), baseYaw: -40 };
    controller.beginPoseMove(target, 1_000);
    const result = controller.advancePoseMove(1_000);

    expect(result.blockedCollision?.safeProgress).toBe(0);
    expect(result.completed).toBe(false);
  });
});

function oneSweep(mode: 'hover' | 'cut'): {
  challenge: Challenge;
  plan: TrajectoryPlan;
  commands: Array<{
    type: 'set-joint-angle';
    jointId: string;
    angleDeg: number;
    sourceBlockId: string;
  }>;
} {
  const initial = createInitialJointAngles(base.robotConfig);
  const target = { ...initial, baseYaw: -40 };
  const start = computeRobotPose(base.robotConfig, initial).endEffector;
  const end = computeRobotPose(base.robotConfig, target).endEffector;
  const midpoint = midpointOf(start, end);
  const challenge: Challenge = {
    ...base,
    voxelConfig: { ...base.voxelConfig, origin: midpoint, size: 0.04 },
    initialHair: { id: 'one', name: 'One voxel', voxels: new Set(['0,0,0']) },
    targetHair: { id: 'none', name: 'No hair', voxels: new Set() },
  };
  const edge = {
    id: `${mode}-edge`,
    from: 'start',
    to: 'end',
    kind: mode === 'cut' ? ('cut' as const) : ('hover' as const),
    synchronousWaypoints: [target],
    legacyWaypoints: [target],
    cuttingEnabled: mode === 'cut',
  };
  const plan: TrajectoryPlan = {
    segments: [{ id: 'segment', sourceBlockId: 'move', actionIndex: 0, kind: edge.kind, edge, cutterEnabled: edge.cuttingEnabled }],
    initialNodeId: 'start',
    finalNodeId: 'end',
    finalHeading: 'east',
    finalToolMode: mode,
  };
  return {
    challenge,
    plan,
    commands: [{ type: 'set-joint-angle', jointId: 'baseYaw', angleDeg: -40, sourceBlockId: 'move' }],
  };
}

function midpointOf(left: Vec3Tuple, right: Vec3Tuple): Vec3Tuple {
  return [
    (left[0] + right[0]) / 2,
    (left[1] + right[1]) / 2,
    (left[2] + right[2]) / 2,
  ];
}

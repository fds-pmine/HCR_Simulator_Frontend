import { beforeAll, describe, expect, it } from 'vitest';
import { defaultChallengeDefinition } from '../../src/data/challenges/defaultChallenge';
import { expandCutterGridProgram } from '../../src/features/cutter-grid/programCompiler';
import { planCutterGridLadderTrajectory } from '../../src/features/cutter-grid/ladderPlanner';
import { registeredCutterGridProfileV2 } from '../../src/features/cutter-grid/profileRegistry';
import { CUTTER_GRID_LADDER_PLANNER_VERSION } from '../../src/features/cutter-grid/types';
import type {
  CutterTrajectoryPlanV2,
  CutterTrajectoryWaypointV1,
} from '../../src/features/cutter-grid/types';
import {
  ARM_ANGLE_RESOLUTION_DEG,
  ARM_HOME_SETTLE_MS,
  SERVO_MS_PER_DEGREE,
  buildCutterArmPlan,
  buildCutterArmEndpointPlan,
} from '../../src/features/robot/armBridge';
import { computeRobotPose } from '../../src/features/robot/kinematics';
import { normalizeChallenge } from '../../src/services/normalizeChallenge';
import type { Challenge, JointId } from '../../src/types/domain';
import * as sequencer from '../../electron/sequencer.cjs';

const challenge: Challenge = normalizeChallenge(defaultChallengeDefinition);

/** The certified reference route, planned by the real ladder planner. */
let planned: CutterTrajectoryPlanV2;

beforeAll(() => {
  const profile = registeredCutterGridProfileV2(challenge);
  if (!profile) throw new Error('the bundled V2 profile must match the challenge');
  const program = {
    ...profile.referenceProgram,
    plannerVersion: CUTTER_GRID_LADDER_PLANNER_VERSION,
  };
  const runtimeActions = expandCutterGridProgram(program);
  planned = planCutterGridLadderTrajectory(
    challenge,
    { program, runtimeActions, executedCommandCount: runtimeActions.length },
    profile,
  );
}, 300_000);

describe('a trajectory needing a joint the arm lacks', () => {
  /**
   * The finding this whole path is built around.
   *
   * The ladder planner uses `shoulderRoll` as a genuine degree of freedom — it
   * is how the arm gets around the head — and this arm has five servos, none of
   * which rolls the shoulder. There is no partial version of that to send.
   */
  it('is refused rather than approximated', () => {
    const plan = buildCutterArmPlan(challenge, planned);

    expect(plan.refusal).toBeDefined();
    expect(plan.steps).toHaveLength(0);
    expect(plan.refusal?.joints.map((joint) => joint.jointId)).toEqual([
      'shoulderRoll',
    ]);
  });

  /**
   * The number is the point.
   *
   * "The arm has no roll servo" is a fact about the hardware; "the tool would be
   * three voxels away" is what says whether it matters. Pinning the roll does
   * not degrade the cut — it puts the tool somewhere else entirely, well past
   * the tool radius that decides what gets removed.
   */
  it('reports how far the tool would actually land', () => {
    const plan = buildCutterArmPlan(challenge, planned);
    const refusal = plan.refusal;
    if (!refusal) throw new Error('expected a refusal');

    expect(refusal.tipDeviationVoxels).toBeGreaterThan(1);
    expect(refusal.tipDeviation).toBeGreaterThan(
      challenge.robotConfig.geometry.toolRadius,
    );
  });

  it('does not refuse over a joint the trajectory never moves', () => {
    // Same plan with the roll frozen: nothing then needs an axis the arm lacks,
    // so the refusal must disappear rather than fire on the joint's mere
    // presence in the challenge.
    const frozen = freezeJoint(planned, 'shoulderRoll');
    const plan = buildCutterArmPlan(challenge, frozen);
    expect(plan.refusal).toBeUndefined();
    expect(plan.steps.length).toBeGreaterThan(0);
  });
});

describe('decimation', () => {
  it('keeps the commanded path within the tolerance it reports', () => {
    const frozen = freezeJoint(planned, 'shoulderRoll');
    const plan = buildCutterArmPlan(challenge, frozen);

    expect(plan.fidelity.poseCount).toBeLessThanOrEqual(plan.fidelity.waypointCount);
    expect(plan.fidelity.jointToleranceDeg).toBeGreaterThanOrEqual(
      ARM_ANGLE_RESOLUTION_DEG,
    );
    // The tip error is what the tolerance buys, and it has to stay far below
    // the tool radius or the arm would cut different hair from the screen.
    expect(plan.fidelity.tipDeviation).toBeLessThan(
      challenge.robotConfig.geometry.toolRadius,
    );
  });

  it('fits inside the sequencer step budget', () => {
    const frozen = freezeJoint(planned, 'shoulderRoll');
    const plan = buildCutterArmPlan(challenge, frozen, {
      maxSteps: sequencer.MAX_STEPS,
    });
    expect(plan.steps.length).toBeLessThanOrEqual(sequencer.MAX_STEPS);
    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it('tightens the tolerance when the budget allows it', () => {
    const frozen = freezeJoint(planned, 'shoulderRoll');
    const tight = buildCutterArmPlan(challenge, frozen, { maxSteps: 100_000 });
    const squeezed = buildCutterArmPlan(challenge, frozen, { maxSteps: 40 });

    expect(tight.fidelity.jointToleranceDeg).toBeLessThanOrEqual(
      squeezed.fidelity.jointToleranceDeg,
    );
    expect(tight.fidelity.poseCount).toBeGreaterThanOrEqual(
      squeezed.fidelity.poseCount,
    );
  });

  /**
   * The path is preserved and the clock gives, not the other way round.
   *
   * A trajectory that asks a servo to cross 40° in 20ms is asking for something
   * an MG996R takes ~320ms to do. Keeping the planned timing would mean sending
   * the next pose while the arm was still travelling to the last one, so it
   * would silently cut corners; stretching the schedule means it arrives late
   * but correct.
   */
  it('never asks a servo to move faster than it can', () => {
    const frozen = freezeJoint(planned, 'shoulderRoll');
    const plan = buildCutterArmPlan(challenge, frozen);

    const mapped = new Map(
      challenge.robotConfig.joints
        .filter((joint) => joint.servo)
        .map((joint) => [joint.servo!.axis, joint.id]),
    );
    let previous: Record<string, number> | undefined;
    for (const [index, step] of plan.steps.entries()) {
      if (step.type !== 'pose') continue;
      const current = Object.fromEntries(
        step.moves.map((move) => [move.axis, move.value]),
      );
      if (previous && index > 0) {
        const travelDeg = Math.max(
          ...Object.keys(current).map((axis) =>
            Math.abs(current[axis] - (previous?.[axis] ?? current[axis])),
          ),
        );
        expect(step.durationMs).toBeGreaterThanOrEqual(
          Math.floor(travelDeg * SERVO_MS_PER_DEGREE),
        );
      }
      previous = current;
      void mapped;
    }
    expect(plan.fidelity.armDurationMs).toBeGreaterThan(0);
  });

  it('drives every mapped joint in a single request per pose', () => {
    const frozen = freezeJoint(planned, 'shoulderRoll');
    const plan = buildCutterArmPlan(challenge, frozen);
    const driven = challenge.robotConfig.joints.filter(
      (joint) => joint.servo && joint.id !== 'shoulderRoll',
    );

    expect(plan.steps[0]).toEqual({
      type: 'home',
      durationMs: ARM_HOME_SETTLE_MS,
    });
    for (const step of plan.steps.slice(1)) {
      expect(step.type).toBe('pose');
      if (step.type === 'pose') {
        expect(step.moves).toHaveLength(driven.length);
      }
    }
  });
});

describe('the sequencer accepts what the builder produces', () => {
  it('validates a decimated plan without touching the network', () => {
    const frozen = freezeJoint(planned, 'shoulderRoll');
    const plan = buildCutterArmPlan(challenge, frozen, {
      maxSteps: sequencer.MAX_STEPS,
    });
    expect(() => sequencer.validatePlan(plan.steps)).not.toThrow();
  });

  it('refuses a pose that names one axis twice', () => {
    // The firmware applies duplicate query keys in order, so the last would
    // silently win and the pose would mean something other than it reads.
    expect(() =>
      sequencer.validatePlan([
        {
          type: 'pose',
          moves: [
            { axis: 'X', value: 90 },
            { axis: 'X', value: 100 },
          ],
          durationMs: 100,
        },
      ]),
    ).toThrow(/names axis X twice/);
  });

  it('refuses a pose with no axes', () => {
    expect(() =>
      sequencer.validatePlan([{ type: 'pose', moves: [], durationMs: 10 }]),
    ).toThrow(/no axes/);
  });

  it('refuses a pose outside servo travel', () => {
    expect(() =>
      sequencer.validatePlan([
        { type: 'pose', moves: [{ axis: 'X', value: 181 }], durationMs: 10 },
      ]),
    ).toThrow(/travels 0–180/);
  });
});

/**
 * Rewrite a plan so one joint holds its opening angle throughout.
 *
 * Used to reach the decimation path on hardware that cannot roll the shoulder.
 * The resulting trajectory is **not** a valid haircut — the tool goes elsewhere,
 * which is exactly what the refusal tests measure — but it is a faithful
 * exercise of everything downstream of the feasibility check.
 */
function freezeJoint(
  plan: CutterTrajectoryPlanV2,
  jointId: JointId,
): CutterTrajectoryPlanV2 {
  // One value for the whole plan. Holding it per-segment would leave the joint
  // varying across steps, which is still motion the arm cannot perform.
  const hold =
    (plan.positioningTrajectory[0] ?? plan.steps[0].waypoints[0]).jointAngles[
      jointId
    ];

  const freeze = (
    waypoints: readonly CutterTrajectoryWaypointV1[],
  ): CutterTrajectoryWaypointV1[] =>
    waypoints.map((waypoint) => {
      const jointAngles = { ...waypoint.jointAngles, [jointId]: hold };
      return {
        ...waypoint,
        jointAngles,
        // Kept consistent so anything reading the declared tip agrees with the
        // angles, as the backend verifier insists.
        endEffector: computeRobotPose(challenge.robotConfig, jointAngles)
          .endEffector,
      };
    });

  return {
    ...plan,
    positioningTrajectory: freeze(plan.positioningTrajectory),
    steps: plan.steps.map((step) => ({
      ...step,
      waypoints: freeze(step.waypoints),
    })),
  };
}

/**
 * The endpoint strategy: drive to where each block ends, and nowhere else.
 *
 * This is what makes Cutter Grid runnable on hardware at all. Replaying the
 * planner's path is impossible without a roll servo; asking only for the
 * destinations removes the constraint, because the route between them is not
 * something the arm needs to reproduce — there is no hair on it.
 */
describe('endpoint playback', () => {
  it('reaches every block endpoint without a roll servo', () => {
    const plan = buildCutterArmEndpointPlan(challenge, planned);

    // The reference program is five Move blocks; one destination each.
    expect(plan.endpoints).toHaveLength(5);
    expect(plan.unreachable).toEqual([]);
    expect(plan.steps).toHaveLength(6);
    expect(plan.steps[0]).toEqual({
      type: 'home',
      durationMs: ARM_HOME_SETTLE_MS,
    });
  });

  it('collapses a multi-cell block into one destination', () => {
    const plan = buildCutterArmEndpointPlan(challenge, planned);
    const blocks = planned.steps
      .filter((step) => step.kind === 'move-cell')
      .map((step) => step.sourceBlockId);

    // 22 cells across 5 blocks: `Move left 3` is one arm move, not three.
    expect(new Set(blocks).size).toBe(5);
    expect(blocks).toHaveLength(22);
    expect(plan.endpoints.map((e) => e.sourceBlockId)).toEqual([
      ...new Set(blocks),
    ]);
  });

  it('lands each destination within a quarter voxel', () => {
    const plan = buildCutterArmEndpointPlan(challenge, planned);
    for (const endpoint of plan.endpoints) {
      expect(endpoint.error).toBeLessThanOrEqual(
        challenge.voxelConfig.size / 4,
      );
    }
  });

  /** The whole point: the solved poses never move the joint the arm lacks. */
  it('holds shoulderRoll at rest in every pose', () => {
    const plan = buildCutterArmEndpointPlan(challenge, planned);
    const rest = challenge.robotConfig.joints.find(
      (joint) => joint.id === 'shoulderRoll',
    )!.initialAngleDeg;

    for (const endpoint of plan.endpoints) {
      expect(endpoint.jointAngles?.shoulderRoll).toBe(rest);
    }
  });

  it('commands only axes the arm actually has', () => {
    const plan = buildCutterArmEndpointPlan(challenge, planned);
    const axes = challenge.robotConfig.joints
      .filter((joint) => joint.servo)
      .map((joint) => joint.servo!.axis);

    for (const step of plan.steps.slice(1)) {
      expect(step.type).toBe('pose');
      if (step.type === 'pose') {
        expect(step.moves.map((move) => move.axis)).toEqual(axes);
      }
    }
    expect(() => sequencer.validatePlan(plan.steps)).not.toThrow();
  });

  it('never asks a servo to move faster than it can', () => {
    const plan = buildCutterArmEndpointPlan(challenge, planned);
    let previous: Record<string, number> | undefined;
    for (const [index, step] of plan.steps.entries()) {
      if (step.type !== 'pose') continue;
      const current = Object.fromEntries(
        step.moves.map((move) => [move.axis, move.value]),
      );
      if (index > 0 && previous) {
        const travelDeg = Math.max(
          ...Object.keys(current).map((axis) =>
            Math.abs(current[axis] - (previous?.[axis] ?? current[axis])),
          ),
        );
        expect(step.durationMs).toBeGreaterThanOrEqual(
          Math.floor(travelDeg * SERVO_MS_PER_DEGREE),
        );
      }
      previous = current;
    }
  });

  /** Nothing is sent if any destination is out of reach. */
  it('sends nothing when a destination cannot be solved', () => {
    // An arm that cannot bend: every destination becomes unreachable.
    const frozenArm: Challenge = {
      ...challenge,
      robotConfig: {
        ...challenge.robotConfig,
        joints: challenge.robotConfig.joints.map((joint) => ({
          ...joint,
          minAngleDeg: joint.initialAngleDeg,
          maxAngleDeg: joint.initialAngleDeg,
        })),
      },
    };
    const plan = buildCutterArmEndpointPlan(frozenArm, planned);
    expect(plan.unreachable.length).toBeGreaterThan(0);
    expect(plan.steps).toEqual([]);
  });
});

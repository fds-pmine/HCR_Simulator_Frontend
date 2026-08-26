import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledProgram, RobotCommand } from '../../src/features/blockly/programTypes';
import { compileWorkspace } from '../../src/features/blockly/programCompiler';
import { createHeadlessWorkspace } from '../../src/features/blockly/workspaceFactory';
import { RobotController } from '../../src/features/robot/RobotController';
import {
  computeRobotPose,
  createInitialJointAngles,
} from '../../src/features/robot/kinematics';
import {
  findRobotHeadCollision,
  segmentIntersectsExpandedEllipsoid,
} from '../../src/features/robot/headCollision';
import { toServoDeg } from '../../src/features/robot/servoMapping';
import { SimulationEngine } from '../../src/features/simulation/SimulationEngine';
import {
  playbackFrameStepsMs,
  SIMULATION_PLAYBACK_RATE,
} from '../../src/features/simulation/frameTiming';
import {
  findSweptVoxelHits,
  segmentIntersectsAabb,
} from '../../src/features/voxel/contactDetection';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import { LocalScoreProvider } from '../../src/services/local/LocalScoreProvider';
import type {
  Challenge,
  Vec3Tuple,
  VoxelKey,
} from '../../src/types/domain';

let defaultChallenge: Challenge;

beforeAll(async () => {
  defaultChallenge = await new LocalChallengeProvider().getChallenge(
    DEFAULT_CHALLENGE_ID,
  );
});

describe('render frame timing', () => {
  const totalMs = (steps: number[]): number =>
    steps.reduce((sum, step) => sum + step, 0);

  it('plays rendered simulation at the configured accelerated rate', () => {
    expect(SIMULATION_PLAYBACK_RATE).toBe(2);
    expect(playbackFrameStepsMs(0.016)).toEqual([32]);
    expect(playbackFrameStepsMs(0)).toEqual([]);
    expect(playbackFrameStepsMs(-0.1)).toEqual([]);
  });

  it('never advances the engine past the collision sampling cap in one tick', () => {
    // 250 ms of wall clock is 500 ms of simulated time at rate 2, and the
    // engine must receive it as slices rather than one jump the cutter could
    // cross voxels — or the head — inside of.
    const steps = playbackFrameStepsMs(0.25);
    expect(totalMs(steps)).toBe(500);
    expect(Math.max(...steps)).toBeLessThanOrEqual(100);
  });

  /**
   * The regression that made CI miss step deadlines a developer's GPU met:
   * clamping to 100 ms and ticking once dropped the remainder, so playback
   * silently ran at `fps × 100 ms` per second below 20 fps.
   */
  it('delivers the same simulated time per second at any frame rate', () => {
    for (const fps of [60, 30, 20, 10, 5, 2]) {
      const perWallSecond = totalMs(playbackFrameStepsMs(1 / fps)) * fps;
      expect(perWallSecond).toBeCloseTo(1_000 * SIMULATION_PLAYBACK_RATE, 6);
    }
  });

  it('drops time past the catch-up ceiling instead of teleporting the arm', () => {
    const steps = playbackFrameStepsMs(30);
    expect(totalMs(steps)).toBe(1_000);
    expect(steps).toHaveLength(10);
  });

  it('uses an absolute playback timeline and drops the hidden-tab anchor', () => {
    const engine = new SimulationEngine(defaultChallenge, new LocalScoreProvider());
    const compiled: CompiledProgram = {
      program: {
        nodes: [{ type: 'wait', durationMs: 100, sourceBlockId: 'wait' }],
        sourceBlockCount: 1,
      },
      runtimeCommands: [{ type: 'wait', durationMs: 100, sourceBlockId: 'wait' }],
      executedCommandCount: 1,
    };
    engine.run(compiled);
    engine.tickAt(1_000);
    engine.tickAt(1_050);
    expect(engine.getSnapshot().status).toBe('running');
    engine.resetPlaybackClock();
    engine.tickAt(60_000);
    expect(engine.getSnapshot().status).toBe('running');
    engine.tickAt(60_050);
    expect(engine.getSnapshot().status).toBe('completed');
  });
});

/**
 * Servo angles that put the arm at a given *geometric* pose.
 *
 * The assertions below are about the geometry — "all joints at zero puts the
 * tool straight out along +X" — but `computeRobotPose` takes servo degrees now.
 * Converting here keeps each test saying what it means and still exercises the
 * mapping, rather than hard-coding servo numbers whose geometric meaning a
 * reader would have to work out.
 */
const servoPose = (
  geometric: Readonly<Record<string, number>>,
): Record<string, number> =>
  Object.fromEntries(
    defaultChallenge.robotConfig.joints.map((joint) => [
      joint.id,
      toServoDeg(joint, geometric[joint.id] ?? 0),
    ]),
  );

describe('robot kinematics', () => {
  it('computes the known zero-angle planar pose', () => {
    const angles = servoPose({
      baseYaw: 0,
      shoulderRoll: 0,
      shoulder: 0,
      elbow: 0,
      wrist: 0,
    });

    const pose = computeRobotPose(defaultChallenge.robotConfig, angles);

    expect(pose.shoulder).toEqual([0, 0.4, 0]);
    expect(pose.elbow[0]).toBeCloseTo(1.05);
    expect(pose.wrist[0]).toBeCloseTo(1.95);
    expect(pose.endEffector[0]).toBeCloseTo(2.3);
    expect(pose.endEffector[1]).toBeCloseTo(0.4);
    expect(pose.endEffector[2]).toBeCloseTo(0);
  });

  it('rotates the whole planar chain around the Y axis', () => {
    const pose = computeRobotPose(
      defaultChallenge.robotConfig,
      servoPose({
        baseYaw: 60,
        shoulderRoll: 0,
        shoulder: 0,
        elbow: 0,
        wrist: 0,
      }),
    );

    expect(pose.endEffector[0]).toBeCloseTo(1.15);
    expect(pose.endEffector[2]).toBeCloseTo(-1.9919, 3);
  });

  it('moves the planar chain out of plane with shoulder roll', () => {
    const neutral = computeRobotPose(
      defaultChallenge.robotConfig,
      servoPose({
        baseYaw: 0,
        shoulderRoll: 0,
        shoulder: 45,
        elbow: 0,
        wrist: 0,
      }),
    );
    const rolled = computeRobotPose(
      defaultChallenge.robotConfig,
      servoPose({
        baseYaw: 0,
        shoulderRoll: 30,
        shoulder: 45,
        elbow: 0,
        wrist: 0,
      }),
    );

    expect(neutral.endEffector[2]).toBeCloseTo(0);
    expect(Math.abs(rolled.endEffector[2])).toBeGreaterThan(0.5);
    expect(rolled.endEffector).not.toEqual(neutral.endEffector);
  });
});

describe('RobotController', () => {
  it('interpolates linearly at the configured joint speed', () => {
    const controller = new RobotController(defaultChallenge.robotConfig);
    // Shoulder starts at servo 95° and runs at 45°/s, so 140° is exactly 1s.
    controller.beginMove('shoulder', 140);

    const halfway = controller.advanceMove(500);
    expect(controller.getAngles().shoulder).toBeCloseTo(117.5);
    expect(halfway.completed).toBe(false);

    const complete = controller.advanceMove(500);
    expect(controller.getAngles().shoulder).toBe(140);
    expect(complete.completed).toBe(true);
  });

  it('restores every configured joint on reset', () => {
    const controller = new RobotController(defaultChallenge.robotConfig);
    controller.beginMove('baseYaw', 90);
    controller.advanceMove(1_000);
    controller.reset();

    expect(controller.getAngles()).toEqual(
      createInitialJointAngles(defaultChallenge.robotConfig),
    );
  });
});

describe('continuous voxel contact', () => {
  const voxelConfig: Challenge['voxelConfig'] = {
    origin: [0, 0, 0],
    size: 1,
    headCenter: [0, 0, 0],
    headScale: [1, 1, 1],
  };

  it('detects a segment crossing an expanded voxel AABB', () => {
    const hits = findSweptVoxelHits(
      [-2, 0, 0],
      [2, 0, 0],
      new Set<VoxelKey>(['0,0,0', '4,0,0']),
      voxelConfig,
      0.1,
    );

    expect(hits).toEqual(['0,0,0']);
    expect(
      segmentIntersectsAabb(
        [-2, 2, 0],
        [2, 2, 0],
        [-0.5, -0.5, -0.5],
        [0.5, 0.5, 0.5],
      ),
    ).toBe(false);
  });

  it('detects stationary points only when they overlap', () => {
    expect(
      segmentIntersectsAabb(
        [0, 0, 0],
        [0, 0, 0],
        [-1, -1, -1],
        [1, 1, 1],
      ),
    ).toBe(true);
    expect(
      segmentIntersectsAabb(
        [2, 2, 2],
        [2, 2, 2],
        [-1, -1, -1],
        [1, 1, 1],
      ),
    ).toBe(false);
  });
});

describe('head collision geometry', () => {
  const center: Vec3Tuple = [0, 0, 0];
  const scale: Vec3Tuple = [1, 1, 1];

  it('detects crossing, tangent and interior segments', () => {
    expect(
      segmentIntersectsExpandedEllipsoid(
        [-2, 0, 0],
        [2, 0, 0],
        center,
        scale,
        0,
      ),
    ).toBe(true);
    expect(
      segmentIntersectsExpandedEllipsoid(
        [-2, 1, 0],
        [2, 1, 0],
        center,
        scale,
        0,
      ),
    ).toBe(true);
    expect(
      segmentIntersectsExpandedEllipsoid(
        [0, 0, 0],
        [0, 0, 0],
        center,
        scale,
        0,
      ),
    ).toBe(true);
  });

  it('keeps segments outside the expanded ellipsoid clear', () => {
    expect(
      segmentIntersectsExpandedEllipsoid(
        [-2, 1.01, 0],
        [2, 1.01, 0],
        center,
        scale,
        0,
      ),
    ).toBe(false);
    expect(
      segmentIntersectsExpandedEllipsoid(
        [1.2, 0, 0],
        [1.2, 0, 0],
        center,
        scale,
        0.25,
      ),
    ).toBe(true);
  });

  it('keeps the default initial five-joint pose clear', () => {
    const pose = computeRobotPose(
      defaultChallenge.robotConfig,
      createInitialJointAngles(defaultChallenge.robotConfig),
    );

    expect(
      findRobotHeadCollision(
        pose,
        defaultChallenge.voxelConfig,
        defaultChallenge.robotConfig.geometry,
      ),
    ).toBeUndefined();
  });
});

describe('SimulationEngine', () => {
  it('executes the default starter program through the full engine', async () => {
    const workspace = createHeadlessWorkspace(defaultChallenge);
    const compiled = compileWorkspace(workspace, defaultChallenge);
    const engine = new SimulationEngine(
      defaultChallenge,
      new LocalScoreProvider(),
    );

    engine.run(compiled);
    let ticks = 0;
    while (engine.getSnapshot().status === 'running' && ticks < 2_000) {
      engine.tick(16);
      ticks += 1;
    }
    const score = await engine.waitForScore();

    expect(engine.getSnapshot().errorMessage).toBeUndefined();
    expect(engine.getSnapshot().status).toBe('completed');
    expect(engine.getSnapshot().metrics.executedCommandCount).toBe(5);
    expect(engine.getSnapshot().metrics.estimatedDurationMs).toBeGreaterThan(
      0,
    );
    expect(score?.finalScore).toBeTypeOf('number');
    expect(engine.getSnapshot().hairVoxels.size).toBeLessThan(
      defaultChallenge.initialHair.voxels.size,
    );
    expect(score?.completionScore).toBeGreaterThanOrEqual(80);

    workspace.dispose();
  });

  it('stops a colliding command at the last safe pose without scoring', async () => {
    const compiled = createUnsafeHeadCollisionProgram();
    const engine = new SimulationEngine(
      defaultChallenge,
      new LocalScoreProvider(),
    );

    engine.run(compiled);
    engine.tick(10_000);
    const snapshot = engine.getSnapshot();

    expect(snapshot.status).toBe('error');
    expect(snapshot.errorMessage).toContain('baseYaw');
    // Attribution is carried structurally — the editor highlights the block —
    // rather than by printing its Blockly id, which is a string like
    // `!p3lgyq#.d:{:YBt_H2n.` that a learner can do nothing with.
    expect(snapshot.errorMessage).not.toContain('unsafe-base');
    expect(snapshot.currentBlockId).toBe('unsafe-base');
    expect(snapshot.metrics.executedCommandCount).toBe(3);
    expect(snapshot.scoreResult).toBeUndefined();
    expect(snapshot.logs.at(-1)?.blockId).toBe('unsafe-base');
    expect(await engine.waitForScore()).toBeUndefined();
    expect(
      findRobotHeadCollision(
        engine.getPose(),
        defaultChallenge.voxelConfig,
        defaultChallenge.robotConfig.geometry,
      ),
    ).toBeUndefined();

    engine.reset();
    expect(engine.getSnapshot().status).toBe('idle');
    expect(engine.getSnapshot().jointAngles).toEqual(
      createInitialJointAngles(defaultChallenge.robotConfig),
    );
  });

  it('finds the same safe collision boundary for small and large frames', () => {
    const compiled = createUnsafeHeadCollisionProgram();
    const smallFrameEngine = new SimulationEngine(
      defaultChallenge,
      new LocalScoreProvider(),
    );
    const largeFrameEngine = new SimulationEngine(
      defaultChallenge,
      new LocalScoreProvider(),
    );

    smallFrameEngine.run(compiled);
    let ticks = 0;
    while (
      smallFrameEngine.getSnapshot().status === 'running' &&
      ticks < 5_000
    ) {
      smallFrameEngine.tick(8);
      ticks += 1;
    }

    largeFrameEngine.run(compiled);
    largeFrameEngine.tick(10_000);

    expect(smallFrameEngine.getSnapshot().status).toBe('error');
    expect(largeFrameEngine.getSnapshot().status).toBe('error');
    expect(
      smallFrameEngine.getSnapshot().jointAngles.baseYaw,
    ).toBeCloseTo(
      largeFrameEngine.getSnapshot().jointAngles.baseYaw,
      4,
    );
  });

  it('runs to completion, removes swept hair and returns a score', async () => {
    const { engine, compiled } = createContactEngine([
      setJointCommand('shoulder', 50, 'move'),
    ]);

    engine.run(compiled);
    engine.tick(10_000);
    const score = await engine.waitForScore();
    const snapshot = engine.getSnapshot();

    expect(snapshot.status).toBe('completed');
    expect(snapshot.hairVoxels).toEqual(
      new Set<VoxelKey>(['100,100,100']),
    );
    expect(snapshot.metrics.executedCommandCount).toBe(1);
    expect(score?.completionScore).toBe(100);
    expect(snapshot.logs.some((log) => log.type === 'collision')).toBe(
      true,
    );
  });

  it('produces the same collision result for small and large ticks', () => {
    const small = createContactEngine([
      setJointCommand('shoulder', 50, 'move'),
    ]);
    const large = createContactEngine([
      setJointCommand('shoulder', 50, 'move'),
    ]);

    small.engine.run(small.compiled);
    while (small.engine.getSnapshot().status === 'running') {
      small.engine.tick(8);
    }

    large.engine.run(large.compiled);
    large.engine.tick(10_000);

    expect(small.engine.getSnapshot().hairVoxels).toEqual(
      large.engine.getSnapshot().hairVoxels,
    );
  });

  it('freezes while paused and resumes from the same angle', () => {
    const { engine, compiled } = createContactEngine([
      setJointCommand('shoulder', 90, 'move'),
    ]);
    engine.run(compiled);
    engine.tick(100);
    engine.pause();
    const pausedAngle = engine.getSnapshot().jointAngles.shoulder;

    engine.tick(1_000);
    expect(engine.getSnapshot().jointAngles.shoulder).toBe(pausedAngle);

    engine.resume();
    engine.tick(1_000);
    expect(engine.getSnapshot().status).toBe('completed');
  });

  it('executes exactly one atomic command per step', async () => {
    const { engine, compiled } = createContactEngine([
      setJointCommand('shoulder', 50, 'first'),
      { type: 'wait', durationMs: 200, sourceBlockId: 'second' },
    ]);

    engine.step(compiled);
    engine.tick(10_000);

    expect(engine.getSnapshot().status).toBe('paused');
    expect(engine.getSnapshot().metrics.executedCommandCount).toBe(1);

    engine.step();
    engine.tick(10_000);
    await engine.waitForScore();

    expect(engine.getSnapshot().status).toBe('completed');
    expect(engine.getSnapshot().metrics.executedCommandCount).toBe(2);
  });

  it('stops without scoring and resets the full simulation state', () => {
    const { engine, compiled, challenge } = createContactEngine([
      setJointCommand('shoulder', 90, 'move'),
    ]);

    engine.run(compiled);
    engine.tick(100);
    engine.stop();

    expect(engine.getSnapshot().status).toBe('stopped');
    expect(engine.getSnapshot().scoreResult).toBeUndefined();

    engine.reset();
    const snapshot = engine.getSnapshot();
    expect(snapshot.status).toBe('idle');
    expect(snapshot.hairVoxels).toEqual(
      new Set(challenge.initialHair.voxels),
    );
    expect(snapshot.jointAngles).toEqual(
      createInitialJointAngles(challenge.robotConfig),
    );
    expect(snapshot.metrics.executedCommandCount).toBe(0);
  });
});

function createContactEngine(commands: RobotCommand[]): {
  engine: SimulationEngine;
  compiled: CompiledProgram;
  challenge: Challenge;
} {
  const startAngles = createInitialJointAngles(
    defaultChallenge.robotConfig,
  );
  const endAngles = { ...startAngles, shoulder: 50 };
  const start = computeRobotPose(
    defaultChallenge.robotConfig,
    startAngles,
  ).endEffector;
  const end = computeRobotPose(
    defaultChallenge.robotConfig,
    endAngles,
  ).endEffector;
  const midpoint = start.map(
    (value, index) => (value + end[index]) / 2,
  ) as unknown as Vec3Tuple;
  const extraKey: VoxelKey = '0,0,0';
  const targetKey: VoxelKey = '100,100,100';

  const challenge: Challenge = {
    ...defaultChallenge,
    voxelConfig: {
      ...defaultChallenge.voxelConfig,
      origin: midpoint,
      size: 0.05,
    },
    initialHair: {
      id: 'test-initial',
      name: 'Test initial',
      voxels: new Set([extraKey, targetKey]),
    },
    targetHair: {
      id: 'test-target',
      name: 'Test target',
      voxels: new Set([targetKey]),
    },
  };
  const compiled: CompiledProgram = {
    program: {
      nodes: commands,
      sourceBlockCount: commands.length,
    },
    runtimeCommands: commands,
    executedCommandCount: commands.length,
  };

  return {
    engine: new SimulationEngine(challenge, new LocalScoreProvider()),
    compiled,
    challenge,
  };
}

function setJointCommand(
  jointId: string,
  angleDeg: number,
  sourceBlockId: string,
): RobotCommand {
  return {
    type: 'set-joint-angle',
    jointId,
    angleDeg,
    sourceBlockId,
  };
}

function createUnsafeHeadCollisionProgram(): CompiledProgram {
  // Servo degrees; the geometric pose this drives into the head is
  // shoulder 50°, elbow −15°, wrist −30°, baseYaw −24°.
  const commands: RobotCommand[] = [
    setJointCommand('shoulder', 100, 'unsafe-shoulder'),
    setJointCommand('elbow', 137.5, 'unsafe-elbow'),
    setJointCommand('wrist', 60, 'unsafe-wrist'),
    setJointCommand('baseYaw', 66, 'unsafe-base'),
  ];

  return {
    program: {
      nodes: commands,
      sourceBlockCount: commands.length,
    },
    runtimeCommands: commands,
    executedCommandCount: commands.length,
  };
}

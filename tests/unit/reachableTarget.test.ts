import { describe, expect, it } from 'vitest';
import { defaultChallengeDefinition } from '../../src/data/challenges/defaultChallenge';
import { REFERENCE_SOLUTION } from '../../src/features/voxel/hairGenerator';
import { normalizeChallenge } from '../../src/services/normalizeChallenge';
import { LocalScoreProvider } from '../../src/services/local/LocalScoreProvider';
import { SimulationEngine } from '../../src/features/simulation/SimulationEngine';
import type { CompiledProgram, RobotCommand } from '../../src/features/blockly/programTypes';

const commands: RobotCommand[] = REFERENCE_SOLUTION.map((step, index) => ({
  type: 'set-joint-angle',
  jointId: step.jointId,
  angleDeg: step.angleDeg,
  sourceBlockId: `ref-${index}`,
}));

const compiled: CompiledProgram = {
  program: { nodes: commands, sourceBlockCount: commands.length },
  runtimeCommands: commands,
  executedCommandCount: commands.length,
};

function runReference() {
  const challenge = normalizeChallenge(defaultChallengeDefinition);
  const engine = new SimulationEngine(challenge, new LocalScoreProvider());
  engine.run(compiled);
  for (let tick = 0; tick < 80_000; tick += 1) {
    if (engine.getSnapshot().status !== 'running') break;
    engine.tick(16);
  }
  return { challenge, engine, snapshot: engine.getSnapshot() };
}

/**
 * The challenge must be winnable.
 *
 * The previous target was drawn by hand across the front of the head, where the
 * arm cannot go: the elbow contacts the head at 30.4° and those voxels need
 * `baseYaw` inside 25.4°. Nothing could remove them, the ceiling was the 89.21
 * you get by running nothing, and the shipped starter scored *below* that.
 *
 * These tests exist so a target can never again ask for hair the arm cannot
 * reach — the trim set is re-derived from the engine here, not trusted.
 */
describe('the shipped challenge is achievable', () => {
  it('scores 100 for the reference solution', async () => {
    const { engine, snapshot } = runReference();

    expect(snapshot.status).toBe('completed');
    const score = await engine.waitForScore();
    expect(score?.completionScore).toBeCloseTo(100, 6);
  });

  it('removes exactly the hair the target asks for, and no more', () => {
    const { challenge, snapshot } = runReference();

    const asked = [...challenge.initialHair.voxels].filter(
      (key) => !challenge.targetHair.voxels.has(key),
    );
    const removed = [...challenge.initialHair.voxels].filter(
      (key) => !snapshot.hairVoxels.has(key),
    );

    expect(removed.sort()).toEqual(asked.sort());
    expect(asked.length).toBeGreaterThan(0);
  });

  it('beats the score for doing nothing', async () => {
    // 89.21 is |target| / |initial| — the IoU of untouched hair. A challenge
    // whose best program cannot beat it is one nobody can play.
    const { challenge, engine } = runReference();
    const doingNothing =
      (100 * challenge.targetHair.voxels.size) / challenge.initialHair.voxels.size;

    const score = await engine.waitForScore();
    expect(score?.completionScore ?? 0).toBeGreaterThan(doingNothing);
  });
});

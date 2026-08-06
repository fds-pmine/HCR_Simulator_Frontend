import * as Blockly from 'blockly/core';
import { describe, expect, it } from 'vitest';
import { defaultChallengeDefinition } from '../../src/data/challenges/defaultChallenge';
import { scalpReferenceWorkspaceState } from '../../src/data/challenges/scalpReferenceWorkspace';
import { registerHcrBlocks } from '../../src/features/blockly/blockDefinitions';
import { loadWorkspaceState } from '../../src/features/blockly/workspaceFactory';
import { LocalScoreProvider } from '../../src/services/local/LocalScoreProvider';
import {
  compileScalpWorkspace,
  registerScalpTurtleBlocks,
} from '../../src/features/scalp-path';
import { SimulationEngine } from '../../src/features/simulation/SimulationEngine';
import { normalizeChallenge } from '../../src/services/normalizeChallenge';

const challenge = normalizeChallenge(defaultChallengeDefinition);

describe('Scalp Turtle simulation integration', () => {
  it('treats an initial Step as entry plus one player path action', () => {
    const compiled = compileReferencePath();
    const engine = new SimulationEngine(challenge, new LocalScoreProvider());
    engine.step(compiled);
    for (let tick = 0; tick < 10_000 && engine.getSnapshot().status === 'running'; tick += 1) {
      engine.tick(16);
    }
    expect(engine.getSnapshot().status).toBe('paused');
    expect(engine.getSnapshot().scalpPath?.actionIndex).toBe(0);
  });

  it('runs synchronized path segments while preserving compatibility metrics', async () => {
    const compiled = compileReferencePath();
    const engine = new SimulationEngine(challenge, new LocalScoreProvider());
    engine.run(compiled);
    expect(engine.getSnapshot().scalpPath).toMatchObject({
      gridNodeId: 'r4-c1',
      heading: 'east',
      toolMode: 'hover',
    });

    for (let tick = 0; tick < 10_000 && engine.getSnapshot().status === 'running'; tick += 1) {
      engine.tick(16);
    }
    await engine.waitForScore();

    const snapshot = engine.getSnapshot();
    expect(snapshot.status).toBe('completed');
    expect(snapshot.hairVoxels.size).toBeLessThan(
      challenge.initialHair.voxels.size,
    );
    expect(snapshot.hairVoxels).toEqual(challenge.targetHair.voxels);
    expect(snapshot.scalpPath?.actionCount).toBe(6);
    expect(snapshot.metrics.executedCommandCount).toBe(
      compiled.executedCommandCount,
    );
    expect(snapshot.scoreResult?.finalScore).toBeGreaterThanOrEqual(80);
  });

  it('uses the compiled profile heading for the initial path readout', () => {
    const compiled = compileReferencePath();
    const engine = new SimulationEngine(challenge, new LocalScoreProvider());
    engine.run({
      ...compiled,
      trajectoryPlan: { ...compiled.trajectoryPlan, initialHeading: 'north' },
    });

    expect(engine.getSnapshot().scalpPath?.heading).toBe('north');
  });

  it('removes the same hair under uneven render-frame deltas', () => {
    const engine = new SimulationEngine(challenge, new LocalScoreProvider());
    engine.run(compileReferencePath());
    const deltas = [3, 27, 11, 49, 7, 19, 5, 31];
    for (let tick = 0; tick < 10_000 && engine.getSnapshot().status === 'running'; tick += 1) {
      engine.tick(deltas[tick % deltas.length]);
    }
    expect(engine.getSnapshot().status).toBe('completed');
    expect(engine.getSnapshot().hairVoxels).toEqual(challenge.targetHair.voxels);
  });

  it('removes the same hair under short browser-like frame deltas', () => {
    const engine = new SimulationEngine(challenge, new LocalScoreProvider());
    engine.run(compileReferencePath());
    const deltas = [1.1, 2.7, 4.3, 8.9, 12.6, 16.8, 6.2];
    for (let tick = 0; tick < 100_000 && engine.getSnapshot().status === 'running'; tick += 1) {
      engine.tick(deltas[tick % deltas.length]);
    }
    expect(engine.getSnapshot().status).toBe('completed');
    expect(engine.getSnapshot().hairVoxels).toEqual(challenge.targetHair.voxels);
  });
});

function compileReferencePath() {
  registerHcrBlocks(challenge.robotConfig.joints);
  registerScalpTurtleBlocks();
  const workspace = new Blockly.Workspace();
  loadWorkspaceState(workspace, scalpReferenceWorkspaceState);
  return compileScalpWorkspace(workspace, challenge);
}

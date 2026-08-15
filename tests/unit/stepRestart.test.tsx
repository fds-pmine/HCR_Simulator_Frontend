import { render } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { SimulationControls } from '../../src/components/controls/SimulationControls';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import { LocalScoreProvider } from '../../src/services/local/LocalScoreProvider';
import { SimulationEngine } from '../../src/features/simulation/SimulationEngine';
import type { CompiledProgram } from '../../src/features/blockly/programTypes';
import type { Challenge } from '../../src/types/domain';

/**
 * Finishing a program should not be a state you have to clear.
 *
 * `Run` always re-prepared from the top, so pressing it twice worked. `Step` did
 * not: from `completed`, `stopped` or `error` it returned without doing
 * anything and the button was disabled anyway, so the only way to step again was
 * to press Reset first. Nothing reported that — it simply did nothing.
 */
let challenge: Challenge;

beforeAll(async () => {
  challenge = await new LocalChallengeProvider().getChallenge(DEFAULT_CHALLENGE_ID);
});

/** Two commands, so a single step leaves the run mid-program. */
function program(): CompiledProgram {
  return {
    program: { nodes: [], sourceBlockCount: 2 },
    runtimeCommands: [
      { type: 'wait', durationMs: 40, sourceBlockId: 'a' },
      { type: 'wait', durationMs: 40, sourceBlockId: 'b' },
    ],
    executedCommandCount: 2,
  };
}

function engineFor(): SimulationEngine {
  return new SimulationEngine(challenge, new LocalScoreProvider());
}

function drain(engine: SimulationEngine, ticks = 5000): void {
  for (let i = 0; i < ticks && engine.getSnapshot().status === 'running'; i += 1) {
    engine.tick(16);
  }
}

describe('running twice without a reset', () => {
  it('gives the identical result', () => {
    const engine = engineFor();

    engine.run(program());
    drain(engine);
    const first = engine.getSnapshot();

    engine.run(program());
    drain(engine);
    const second = engine.getSnapshot();

    expect(second.status).toBe(first.status);
    expect(second.hairVoxels.size).toBe(first.hairVoxels.size);
    expect(second.metrics.executedCommandCount).toBe(
      first.metrics.executedCommandCount,
    );
  });
});

describe('stepping after a finished run', () => {
  it('starts a fresh run instead of doing nothing', () => {
    const engine = engineFor();

    engine.run(program());
    drain(engine);
    const finished = engine.getSnapshot();
    expect(finished.status).toBe('completed');

    // No reset. This used to return silently and leave the status unchanged.
    engine.step(program());

    const stepped = engine.getSnapshot();
    expect(stepped.status).toBe('running');
    expect(stepped.metrics.executedCommandCount).toBe(0);
  });

  it('runs exactly one command, not the whole program', () => {
    const engine = engineFor();
    engine.run(program());
    drain(engine);

    engine.step(program());
    drain(engine);

    const snapshot = engine.getSnapshot();
    expect(snapshot.metrics.executedCommandCount).toBe(1);
    expect(snapshot.status).toBe('paused');
  });

  it('carries on stepping from the pause without the program', () => {
    const engine = engineFor();
    engine.step(program());
    drain(engine);
    expect(engine.getSnapshot().metrics.executedCommandCount).toBe(1);

    engine.step();
    drain(engine);
    expect(engine.getSnapshot().metrics.executedCommandCount).toBe(2);
  });

  it('also restarts after a stop', () => {
    const engine = engineFor();
    engine.run(program());
    engine.tick(16);
    engine.stop();
    expect(engine.getSnapshot().status).toBe('stopped');

    engine.step(program());
    expect(engine.getSnapshot().status).toBe('running');
  });

  /** A run already in motion is not something to step into. */
  it('leaves a running program alone', () => {
    const engine = engineFor();
    engine.run(program());
    engine.tick(16);
    expect(engine.getSnapshot().status).toBe('running');

    const before = engine.getSnapshot().metrics.executedCommandCount;
    engine.step(program());

    expect(engine.getSnapshot().status).toBe('running');
    expect(engine.getSnapshot().metrics.executedCommandCount).toBe(before);
  });
});

describe('the Step button', () => {
  /**
   * The visible half of the same bug.
   *
   * Even with the engine fixed, Step stayed greyed out after a run because the
   * button only enabled on `idle` or `paused` — so the control that needed
   * pressing could not be pressed, and Reset was the only way forward.
   */
  it.each([
    ['idle', false],
    ['completed', false],
    ['stopped', false],
    ['error', false],
    ['paused', false],
    ['running', true],
    ['positioning', true],
    ['loading', true],
  ] as const)('is %s → disabled=%s', (status, disabled) => {
    const { getByTestId } = render(
      <SimulationControls
        status={status}
        onRun={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onStep={() => {}}
        onStop={() => {}}
        onReset={() => {}}
        onTest={() => {}}
        testing={false}
      />,
    );
    expect((getByTestId('step-button') as HTMLButtonElement).disabled).toBe(
      disabled,
    );
  });
})

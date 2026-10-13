/// <reference types="node" />
// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as armValidation from '../../electron/arm.cjs';
import type { ArmRunResult, ArmStep } from '../../electron/sequencer.cjs';

function deferred() {
  let resolve!: (value: Record<string, number>) => void;
  const promise = new Promise<Record<string, number>>((finish) => { resolve = finish; });
  return { promise, resolve: () => resolve({}) };
}

function sequencerWithMockArm() {
  const arm = {
    axisName: armValidation.axisName,
    formatAngle: armValidation.formatAngle,
    home: vi.fn<() => Promise<Record<string, number>>>().mockResolvedValue({}),
    setAngles: vi.fn<typeof armValidation.setAngles>().mockResolvedValue({}),
  };
  const module = { exports: {} };
  vm.runInNewContext(readFileSync('electron/sequencer.cjs', 'utf8'), {
    require: (name: string) => {
      if (name !== './arm.cjs') throw new Error(`Unexpected dependency ${name}.`);
      return arm;
    },
    module, AbortController, setTimeout, clearTimeout,
  });
  return { arm, sequencer: module.exports as typeof import('../../electron/sequencer.cjs') };
}

describe('arm sequencer cancellation and shutdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(['home', 'move'] as const)(
    'aborts during an awaited %s without starting its hold or next command', async (pendingStep) => {
      const { arm, sequencer } = sequencerWithMockArm();
      const pending = deferred();
      if (pendingStep === 'home') arm.home.mockReturnValueOnce(pending.promise);
      else arm.setAngles.mockReturnValueOnce(pending.promise);
      const steps: ArmStep[] = [
        { type: 'home', durationMs: pendingStep === 'home' ? 60_000 : 0 },
        { type: 'move', axis: 'X', value: 100, durationMs: 60_000 },
        { type: 'move', axis: 'Y', value: 110, durationMs: 0 },
      ];
      const progress = vi.fn();
      let result: ArmRunResult | undefined;
      const running = sequencer.run(steps, progress);
      void running.then((summary) => { result = summary; });
      if (pendingStep === 'move') await vi.advanceTimersByTimeAsync(0);

      expect(sequencer.abort()).toBe(true);
      pending.resolve();
      await vi.advanceTimersByTimeAsync(0);

      expect(result).toEqual({ completed: pendingStep === 'home' ? 0 : 1, total: 3, aborted: true });
      expect(vi.getTimerCount()).toBe(0);
      expect(arm.setAngles).toHaveBeenCalledTimes(pendingStep === 'home' ? 0 : 1);
      expect(progress).toHaveBeenCalledTimes(pendingStep === 'home' ? 1 : 2);
      await running;
    },
  );

  it.each(['home', 'move'] as const)(
    'waits for an in-flight %s before issuing shutdown Home', async (pendingStep) => {
      const { arm, sequencer } = sequencerWithMockArm();
      const write = deferred();
      if (pendingStep === 'home') arm.home.mockReturnValueOnce(write.promise);
      else arm.setAngles.mockReturnValueOnce(write.promise);
      const running = sequencer.run([
        { type: 'home', durationMs: 0 },
        { type: 'move', axis: 'X', value: 100, durationMs: 60_000 },
      ]);
      if (pendingStep === 'move') await vi.advanceTimersByTimeAsync(0);
      const parking = sequencer.shutdown();
      await vi.advanceTimersByTimeAsync(0);
      expect(arm.home).toHaveBeenCalledTimes(1);

      write.resolve();
      await vi.advanceTimersByTimeAsync(0);
      await parking;

      expect(arm.home).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
      await expect(running).resolves.toMatchObject({ aborted: true });
    },
  );

  it('keeps the arm reserved through parking and coalesces simultaneous shutdowns', async () => {
    const { arm, sequencer } = sequencerWithMockArm();
    const home = deferred();
    arm.home.mockReturnValueOnce(home.promise);
    const parking = sequencer.shutdown();
    await vi.advanceTimersByTimeAsync(0);

    expect(sequencer.isRunning()).toBe(true);
    await expect(sequencer.run([{ type: 'home', durationMs: 0 }])).rejects.toThrow('already running');
    const secondParking = sequencer.shutdown();
    await vi.advanceTimersByTimeAsync(0);
    expect(arm.home).toHaveBeenCalledOnce();

    home.resolve();
    await Promise.all([parking, secondParking]);
    expect(sequencer.isRunning()).toBe(false);
    await expect(sequencer.run([{ type: 'home', durationMs: 0 }])).resolves.toMatchObject({ aborted: false });
  });
});

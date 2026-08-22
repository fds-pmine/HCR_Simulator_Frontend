import { describe, expect, it } from 'vitest';
import {
  RuckigLocalWasmError,
  sampleRuckigLocalStateToState,
  type RuckigLocalStateToStateInput,
  type RuckigLocalWasmModule,
} from '../../src/features/cutter-grid/ruckigLocalWasm';

const input: RuckigLocalStateToStateInput = {
  current: {
    position: [1, 2, 3, 4, 5],
    velocity: [0, 0, 0, 0, 0],
    acceleration: [0, 0, 0, 0, 0],
  },
  target: {
    position: [6, 7, 8, 9, 10],
    velocity: [0, 0, 0, 0, 0],
    acceleration: [0, 0, 0, 0, 0],
  },
  maximum: {
    velocity: [20, 21, 22, 23, 24],
    acceleration: [50, 51, 52, 53, 54],
    jerk: [200, 201, 202, 203, 204],
  },
  sampleCount: 3,
};

describe('local Ruckig WASM ABI adapter', () => {
  it('writes the fixed q/v/a ABI order and decodes time-stamped q/v/a/j output', () => {
    const module = new FakeRuckigModule();

    const result = sampleRuckigLocalStateToState(module, input);

    expect(module.capturedInput).toEqual([
      ...input.current.position,
      ...input.current.velocity,
      ...input.current.acceleration,
      ...input.target.position,
      ...input.target.velocity,
      ...input.target.acceleration,
      ...input.maximum.velocity,
      ...input.maximum.acceleration,
      ...input.maximum.jerk,
      0,
    ]);
    expect(result.resultCode).toBe(0);
    expect(result.durationSeconds).toBe(1.5);
    expect(result.sampleTimesSeconds).toEqual([0, 0.75, 1.5]);
    expect(result.samples).toEqual([
      {
        position: [1, 2, 3, 4, 5],
        velocity: [0, 1, 2, 3, 4],
        acceleration: [0, -1, -2, -3, -4],
        jerk: [10, 11, 12, 13, 14],
      },
      {
        position: [3.5, 4.5, 5.5, 6.5, 7.5],
        velocity: [5, 6, 7, 8, 9],
        acceleration: [-5, -6, -7, -8, -9],
        jerk: [15, 16, 17, 18, 19],
      },
      {
        position: [6, 7, 8, 9, 10],
        velocity: [10, 11, 12, 13, 14],
        acceleration: [-10, -11, -12, -13, -14],
        jerk: [20, 21, 22, 23, 24],
      },
    ]);
    expect(module.freedPointers).toHaveLength(3);
  });

  it('frees every allocated buffer and exposes a negative Ruckig result', () => {
    const module = new FakeRuckigModule(-100);

    expect(() => sampleRuckigLocalStateToState(module, input)).toThrow(RuckigLocalWasmError);
    expect(module.freedPointers).toHaveLength(3);
  });

  it('rejects invalid input before allocating any WASM memory', () => {
    const module = new FakeRuckigModule();
    expect(() => sampleRuckigLocalStateToState(module, { ...input, sampleCount: 1 })).toThrow(
      RuckigLocalWasmError,
    );
    expect(module.allocatedPointers).toEqual([]);
  });

  it('serializes the optional minimum duration after the nine fixed vectors', () => {
    const module = new FakeRuckigModule(0, undefined, 2);

    sampleRuckigLocalStateToState(module, { ...input, minimumDurationSeconds: 2 });

    expect(module.capturedInput.at(-1)).toBe(2);
  });

  it('releases already allocated buffers when a later allocation fails', () => {
    const module = new FakeRuckigModule(0, 2);

    expect(() => sampleRuckigLocalStateToState(module, input)).toThrow(RuckigLocalWasmError);
    expect(module.allocatedPointers).toHaveLength(1);
    expect(module.freedPointers).toEqual([...module.allocatedPointers].reverse());
  });
});

class FakeRuckigModule implements RuckigLocalWasmModule {
  readonly HEAPF64 = new Float64Array(4_096);
  readonly allocatedPointers: number[] = [];
  readonly freedPointers: number[] = [];
  capturedInput: number[] = [];
  private nextPointer = Float64Array.BYTES_PER_ELEMENT;

  constructor(
    private readonly resultCode = 0,
    private readonly failAllocationAt?: number,
    private readonly durationSeconds = 1.5,
  ) {}

  _malloc(byteCount: number): number {
    if (this.failAllocationAt === this.allocatedPointers.length + 1) return 0;
    const pointer = this.nextPointer;
    this.nextPointer += byteCount;
    this.allocatedPointers.push(pointer);
    return pointer;
  }

  _free(pointer: number): void {
    this.freedPointers.push(pointer);
  }

  _ruckig_sample_5d(
    inputPointer: number,
    sampleCount: number,
    durationPointer: number,
    outputPointer: number,
  ): number {
    this.capturedInput = Array.from(this.HEAPF64.slice(inputPointer / 8, inputPointer / 8 + 46));
    if (this.resultCode < 0) return this.resultCode;
    this.HEAPF64[durationPointer / 8] = this.durationSeconds;
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const offset = outputPointer / 8 + sample * 21;
      const progress = sample / (sampleCount - 1);
      this.HEAPF64[offset] = this.durationSeconds * progress;
      for (let joint = 0; joint < 5; joint += 1) {
        this.HEAPF64[offset + 1 + joint] = 1 + joint + 5 * progress;
        this.HEAPF64[offset + 6 + joint] = sample * 5 + joint;
        this.HEAPF64[offset + 11 + joint] = -sample * 5 - joint;
        this.HEAPF64[offset + 16 + joint] = 10 + sample * 5 + joint;
      }
    }
    return this.resultCode;
  }
}

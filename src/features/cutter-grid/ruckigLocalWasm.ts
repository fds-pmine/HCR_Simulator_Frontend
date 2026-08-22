/** The fixed C ABI exposed by tools/ruckig-wasm/ruckig_local.cpp. */
export const RUCKIG_LOCAL_WASM_DOF = 5;
const INPUT_VECTOR_COUNT = 9;
const OUTPUT_VECTOR_COUNT = 4;
const INPUT_DOUBLE_COUNT = RUCKIG_LOCAL_WASM_DOF * INPUT_VECTOR_COUNT + 1;
const OUTPUT_TIME_OFFSET = 0;
const OUTPUT_VECTOR_OFFSET = 1;
const OUTPUT_DOUBLE_STRIDE = OUTPUT_VECTOR_OFFSET + RUCKIG_LOCAL_WASM_DOF * OUTPUT_VECTOR_COUNT;
const MAX_SAMPLE_COUNT = 65_536;

export type RuckigLocalFiveAxisVector = readonly [number, number, number, number, number];

export interface RuckigLocalStateToStateInput {
  current: {
    position: RuckigLocalFiveAxisVector;
    velocity: RuckigLocalFiveAxisVector;
    acceleration: RuckigLocalFiveAxisVector;
  };
  target: {
    position: RuckigLocalFiveAxisVector;
    velocity: RuckigLocalFiveAxisVector;
    acceleration: RuckigLocalFiveAxisVector;
  };
  maximum: {
    velocity: RuckigLocalFiveAxisVector;
    acceleration: RuckigLocalFiveAxisVector;
    jerk: RuckigLocalFiveAxisVector;
  };
  /** Ruckig minimum duration, used for deterministic 1.1x extension retries. */
  minimumDurationSeconds?: number;
  sampleCount: number;
}

export interface RuckigLocalTrajectorySample {
  position: RuckigLocalFiveAxisVector;
  velocity: RuckigLocalFiveAxisVector;
  acceleration: RuckigLocalFiveAxisVector;
  jerk: RuckigLocalFiveAxisVector;
}

export interface RuckigLocalTrajectoryResult {
  /** Ruckig's numeric Result; non-negative values are successful. */
  resultCode: number;
  durationSeconds: number;
  samples: RuckigLocalTrajectorySample[];
  /** Exact absolute times of the local samples, including jerk-switch points. */
  sampleTimesSeconds?: number[];
}

/**
 * Minimal capability surface of the generated Emscripten module. It is kept
 * DOM- and URL-free so both the actual Planner Worker and deterministic test
 * doubles use exactly the same ABI adapter.
 */
export interface RuckigLocalWasmModule {
  HEAPF64: Float64Array;
  _malloc(byteCount: number): number;
  _free(pointer: number): void;
  _ruckig_sample_5d(
    inputPointer: number,
    sampleCount: number,
    durationPointer: number,
    outputPointer: number,
  ): number;
}

export class RuckigLocalWasmError extends Error {
  constructor(
    message: string,
    public readonly resultCode?: number,
  ) {
    super(message);
    this.name = 'RuckigLocalWasmError';
  }
}

/**
 * Marshals exactly one local, offline Ruckig state-to-state call. This
 * adapter intentionally has no fallback: a missing/invalid module or a
 * negative Ruckig Result is an explicit error for the caller to classify.
 */
export function sampleRuckigLocalStateToState(
  module: RuckigLocalWasmModule,
  input: RuckigLocalStateToStateInput,
): RuckigLocalTrajectoryResult {
  assertInput(input);
  let inputPointer: number | undefined;
  let durationPointer: number | undefined;
  let outputPointer: number | undefined;
  try {
    inputPointer = allocate(module, INPUT_DOUBLE_COUNT * Float64Array.BYTES_PER_ELEMENT);
    durationPointer = allocate(module, Float64Array.BYTES_PER_ELEMENT);
    outputPointer = allocate(
      module,
      input.sampleCount * OUTPUT_DOUBLE_STRIDE * Float64Array.BYTES_PER_ELEMENT,
    );
    const inputOffset = heapOffset(inputPointer);
    module.HEAPF64.set(serializeInput(input), inputOffset);
    const resultCode = module._ruckig_sample_5d(
      inputPointer,
      input.sampleCount,
      durationPointer,
      outputPointer,
    );
    if (!Number.isInteger(resultCode) || resultCode < 0) {
      throw new RuckigLocalWasmError('Local Ruckig rejected its state-to-state input.', resultCode);
    }
    const durationSeconds = module.HEAPF64[heapOffset(durationPointer)];
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new RuckigLocalWasmError('Local Ruckig returned an invalid trajectory duration.', resultCode);
    }
    if (
      input.minimumDurationSeconds !== undefined &&
      durationSeconds < input.minimumDurationSeconds - 1e-9
    ) {
      throw new RuckigLocalWasmError('Local Ruckig did not honor the requested minimum duration.', resultCode);
    }
    const dataStart = heapOffset(outputPointer);
    const samples: RuckigLocalTrajectorySample[] = [];
    const sampleTimesSeconds: number[] = [];
    for (let sampleIndex = 0; sampleIndex < input.sampleCount; sampleIndex += 1) {
      const offset = dataStart + sampleIndex * OUTPUT_DOUBLE_STRIDE;
      const timeSeconds = module.HEAPF64[offset + OUTPUT_TIME_OFFSET];
      if (timeSeconds < 0) break;
      if (
        !Number.isFinite(timeSeconds) ||
        timeSeconds < 0 ||
        timeSeconds > durationSeconds + 1e-9 ||
        (sampleTimesSeconds.length > 0 && timeSeconds <= sampleTimesSeconds.at(-1)!)
      ) {
        throw new RuckigLocalWasmError('Local Ruckig returned invalid or non-monotonic sample times.', resultCode);
      }
      sampleTimesSeconds.push(timeSeconds);
      samples.push({
        position: readVector(module.HEAPF64, offset + OUTPUT_VECTOR_OFFSET),
        velocity: readVector(module.HEAPF64, offset + OUTPUT_VECTOR_OFFSET + RUCKIG_LOCAL_WASM_DOF),
        acceleration: readVector(module.HEAPF64, offset + OUTPUT_VECTOR_OFFSET + 2 * RUCKIG_LOCAL_WASM_DOF),
        jerk: readVector(module.HEAPF64, offset + OUTPUT_VECTOR_OFFSET + 3 * RUCKIG_LOCAL_WASM_DOF),
      });
    }
    if (
      samples.length < 2 ||
      Math.abs(sampleTimesSeconds[0] ?? Number.NaN) > 1e-9 ||
      Math.abs((sampleTimesSeconds.at(-1) ?? Number.NaN) - durationSeconds) > 1e-9
    ) {
      throw new RuckigLocalWasmError('Local Ruckig did not return a complete time-stamped trajectory.', resultCode);
    }
    return { resultCode, durationSeconds, samples, sampleTimesSeconds };
  } finally {
    if (outputPointer !== undefined) module._free(outputPointer);
    if (durationPointer !== undefined) module._free(durationPointer);
    if (inputPointer !== undefined) module._free(inputPointer);
  }
}

function assertInput(input: RuckigLocalStateToStateInput): void {
  if (!Number.isInteger(input.sampleCount) || input.sampleCount < 2 || input.sampleCount > MAX_SAMPLE_COUNT) {
    throw new RuckigLocalWasmError(
      `Local Ruckig sampleCount must be an integer in [2, ${MAX_SAMPLE_COUNT}].`,
    );
  }
  if (
    input.minimumDurationSeconds !== undefined &&
    (!Number.isFinite(input.minimumDurationSeconds) || input.minimumDurationSeconds < 0)
  ) {
    throw new RuckigLocalWasmError('Local Ruckig minimumDurationSeconds must be finite and non-negative.');
  }
  const vectors = [
    input.current.position,
    input.current.velocity,
    input.current.acceleration,
    input.target.position,
    input.target.velocity,
    input.target.acceleration,
    input.maximum.velocity,
    input.maximum.acceleration,
    input.maximum.jerk,
  ];
  if (vectors.some((vector) => vector.length !== RUCKIG_LOCAL_WASM_DOF || vector.some((value) => !Number.isFinite(value)))) {
    throw new RuckigLocalWasmError('Local Ruckig requires finite five-axis q/v/a and limit vectors.');
  }
  for (const limit of [input.maximum.velocity, input.maximum.acceleration, input.maximum.jerk]) {
    if (limit.some((value) => value <= 0)) {
      throw new RuckigLocalWasmError('Local Ruckig requires strictly positive dynamic limits.');
    }
  }
}

function serializeInput(input: RuckigLocalStateToStateInput): Float64Array {
  return new Float64Array([
    ...input.current.position,
    ...input.current.velocity,
    ...input.current.acceleration,
    ...input.target.position,
    ...input.target.velocity,
    ...input.target.acceleration,
    ...input.maximum.velocity,
    ...input.maximum.acceleration,
    ...input.maximum.jerk,
    input.minimumDurationSeconds ?? 0,
  ]);
}

function allocate(module: RuckigLocalWasmModule, byteCount: number): number {
  const pointer = module._malloc(byteCount);
  if (!Number.isInteger(pointer) || pointer <= 0 || pointer % Float64Array.BYTES_PER_ELEMENT !== 0) {
    throw new RuckigLocalWasmError('Local Ruckig WASM could not allocate an aligned double buffer.');
  }
  return pointer;
}

function heapOffset(pointer: number): number {
  return pointer / Float64Array.BYTES_PER_ELEMENT;
}

function readVector(heap: Float64Array, offset: number): RuckigLocalFiveAxisVector {
  const values = Array.from(
    heap.slice(offset, offset + RUCKIG_LOCAL_WASM_DOF),
    (value) => Object.is(value, -0) ? 0 : value,
  );
  if (values.length !== RUCKIG_LOCAL_WASM_DOF || values.some((value) => !Number.isFinite(value))) {
    throw new RuckigLocalWasmError('Local Ruckig returned a non-finite five-axis trajectory sample.');
  }
  return values as unknown as RuckigLocalFiveAxisVector;
}

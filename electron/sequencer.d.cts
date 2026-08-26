/**
 * Types for `sequencer.cjs`, so its limits can be asserted from TypeScript.
 *
 * Same seam as `arm.d.cts`: the implementation is CommonJS because Electron's
 * main process loads it directly, and it stays outside the app's
 * browser-targeted TypeScript project. Only the parts a test can reach without
 * Electron are declared — `run` and `shutdown` reach the network and the app
 * lifecycle, so they are typed but not exercised from `src`.
 */

export interface ArmStep {
  type: 'home' | 'move' | 'pose' | 'wait';
  axis?: string;
  value?: number;
  /** Set on a `pose`: several axes written in one request. */
  moves?: { axis: string; value: number }[];
  durationMs: number;
}

/**
 * Re-validate a plan without running it.
 *
 * Exported so the range and shape checks are reachable from the test runner;
 * `run` reaches the network, and these are the parts worth asserting.
 */
export declare function validatePlan(plan: readonly unknown[]): ArmStep[];

export interface ArmProgress {
  phase: 'step';
  index: number;
  total: number;
  step: ArmStep;
}

export interface ArmRunResult {
  completed: number;
  total: number;
  aborted: boolean;
}

/**
 * Longest plan the sequencer will accept.
 *
 * The budget a compiled program has to fit inside: one step per mapped joint
 * for the opening pose, then one per atomic command.
 */
export declare const MAX_STEPS: number;

export declare function run(
  plan: readonly unknown[],
  onProgress?: (progress: ArmProgress) => void,
): Promise<ArmRunResult>;
export declare function abort(): boolean;
export declare function isRunning(): boolean;
export declare function shutdown(): Promise<void>;

import type { Challenge } from '../../types/domain';
import { readBackendConfig, type BackendConfig } from '../../services/http/config';
import { fnv1a64 } from './signature';
import { CutterGridPlanningError } from './trajectory';
import { CutterGridPlannerClient } from './plannerClient';
import type {
  CompiledCutterGridProgramV2,
  CutterGridPlanningProgressV4,
  CutterGridProfileV4,
  CutterTrajectoryPlanV4,
} from './types';

const CUTTER_GRID_PLAN_PATH = '/api/v1/cutter-grid/plans';
const CUTTER_GRID_API_VERSION = 1;
const CUTTER_GRID_CHALLENGE_VERSION = 1;
const CUTTER_GRID_REMOTE_TIMEOUT_MS = 30_000;

export type CutterGridPlannerSource = 'rust-backend' | 'typescript-fallback';

export interface CutterGridPlannerResultV4 {
  plan: CutterTrajectoryPlanV4;
  source: CutterGridPlannerSource;
}

export interface CutterGridPlannerProviderOptions {
  config?: BackendConfig;
  /** Explicitly keep Cutter Grid planning in the browser even when app HTTP is configured. */
  offline?: boolean;
  fetchImpl?: typeof fetch;
  worker?: Pick<CutterGridPlannerClient, 'planV4' | 'cancel'>;
  timeoutMs?: number;
  challengeVersion?: number;
}

/**
 * A deterministic service failure. Only the explicit `fallbackAllowed` cases
 * may use the browser Worker; malformed results and semantic 4xx responses
 * must stay visible to the player instead of being silently hidden.
 */
export class CutterGridRemotePlanningError extends Error {
  constructor(
    message: string,
    readonly options: {
      fallbackAllowed: boolean;
      sourceBlockId?: string;
      status?: number;
    },
  ) {
    super(message);
    this.name = 'CutterGridRemotePlanningError';
  }

  get sourceBlockId(): string | undefined {
    return this.options.sourceBlockId;
  }
}

interface ActiveRemoteRequest {
  id: number;
  controller: AbortController;
  cancelled: boolean;
  timedOut: boolean;
}

/**
 * The Workbench-facing V4 planner. Online Practice asks Rust first; explicit
 * offline deployments use the existing Worker directly. This class owns both
 * cancellation mechanisms so a stale remote response can never become the
 * frozen Run/Test/Step plan.
 */
export class CutterGridPlannerProvider {
  #requestId = 0;
  #activeRemote: ActiveRemoteRequest | undefined;
  readonly #config: BackendConfig | undefined;
  readonly #offline: boolean;
  readonly #fetch: typeof fetch;
  readonly #worker: Pick<CutterGridPlannerClient, 'planV4' | 'cancel'>;
  readonly #timeoutMs: number;
  readonly #challengeVersion: number;

  constructor(options: CutterGridPlannerProviderOptions = {}) {
    this.#offline = options.offline ?? import.meta.env.VITE_CUTTER_GRID_PLANNER_MODE === 'offline';
    this.#config = this.#offline ? undefined : options.config ?? readBackendConfig();
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#worker = options.worker ?? new CutterGridPlannerClient();
    this.#timeoutMs = options.timeoutMs ?? CUTTER_GRID_REMOTE_TIMEOUT_MS;
    this.#challengeVersion = options.challengeVersion ?? CUTTER_GRID_CHALLENGE_VERSION;
  }

  async planV4(
    challenge: Challenge,
    compiled: CompiledCutterGridProgramV2,
    profile: CutterGridProfileV4,
    onProgress?: (progress: Omit<CutterGridPlanningProgressV4, 'type' | 'requestId'>) => void,
  ): Promise<CutterGridPlannerResultV4> {
    this.cancel();
    const requestId = ++this.#requestId;
    if (!this.#config) {
      return this.planWithWorker(challenge, compiled, profile, onProgress);
    }

    try {
      const plan = await this.planWithRust(requestId, challenge, compiled, profile);
      return { plan, source: 'rust-backend' };
    } catch (error) {
      if (this.wasCancelled(requestId)) throw cancelledError();
      if (!(error instanceof CutterGridRemotePlanningError) || !error.options.fallbackAllowed) {
        throw error;
      }
      return this.planWithWorker(challenge, compiled, profile, onProgress);
    }
  }

  cancel(): void {
    this.#requestId += 1;
    const active = this.#activeRemote;
    if (active) {
      active.cancelled = true;
      active.controller.abort();
      this.#activeRemote = undefined;
    }
    this.#worker.cancel();
  }

  private async planWithWorker(
    challenge: Challenge,
    compiled: CompiledCutterGridProgramV2,
    profile: CutterGridProfileV4,
    onProgress?: (progress: Omit<CutterGridPlanningProgressV4, 'type' | 'requestId'>) => void,
  ): Promise<CutterGridPlannerResultV4> {
    const plan = await this.#worker.planV4(challenge, compiled, profile, onProgress);
    return { plan, source: 'typescript-fallback' };
  }

  private async planWithRust(
    requestId: number,
    challenge: Challenge,
    compiled: CompiledCutterGridProgramV2,
    profile: CutterGridProfileV4,
  ): Promise<CutterTrajectoryPlanV4> {
    const config = this.#config;
    if (!config) throw new Error('Remote Cutter Grid planning is not configured.');
    const active: ActiveRemoteRequest = {
      id: requestId,
      controller: new AbortController(),
      cancelled: false,
      timedOut: false,
    };
    this.#activeRemote = active;
    const timeout = setTimeout(() => {
      active.timedOut = true;
      active.controller.abort();
    }, this.#timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.#fetch(`${config.baseUrl.replace(/\/+$/, '')}${CUTTER_GRID_PLAN_PATH}`, {
          method: 'POST',
          signal: active.controller.signal,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
          },
          body: JSON.stringify({
            challengeId: challenge.id,
            challengeVersion: this.#challengeVersion,
            program: compiled.program,
          }),
        });
      } catch {
        if (active.cancelled) throw cancelledError();
        throw new CutterGridRemotePlanningError(
          active.timedOut ? 'The Rust Cutter Grid planner timed out.' : 'Could not reach the Rust Cutter Grid planner.',
          { fallbackAllowed: true },
        );
      }
      if (!response.ok) {
        const detail = await readError(response);
        throw new CutterGridRemotePlanningError(detail.message, {
          fallbackAllowed: response.status === 429 || response.status >= 500,
          sourceBlockId: detail.sourceBlockId,
          status: response.status,
        });
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new CutterGridRemotePlanningError(
          'The Rust Cutter Grid planner returned malformed JSON.',
          { fallbackAllowed: false, status: response.status },
        );
      }
      return validateRustPlanResponse(body, compiled, profile);
    } finally {
      clearTimeout(timeout);
      if (this.#activeRemote === active) this.#activeRemote = undefined;
    }
  }

  private wasCancelled(requestId: number): boolean {
    return requestId !== this.#requestId;
  }
}

function cancelledError(): CutterGridPlanningError {
  return new CutterGridPlanningError(
    'planning-cancelled',
    'Cutter Grid planning was cancelled because its inputs changed.',
  );
}

async function readError(response: Response): Promise<{ message: string; sourceBlockId?: string }> {
  try {
    const body = await response.json() as {
      error?: { message?: unknown; field?: unknown };
    };
    return {
      message: typeof body.error?.message === 'string'
        ? body.error.message
        : `The Rust Cutter Grid planner responded with status ${response.status}.`,
      ...(typeof body.error?.field === 'string' ? { sourceBlockId: body.error.field } : {}),
    };
  } catch {
    return { message: `The Rust Cutter Grid planner responded with status ${response.status}.` };
  }
}

function validateRustPlanResponse(
  response: unknown,
  compiled: CompiledCutterGridProgramV2,
  profile: CutterGridProfileV4,
): CutterTrajectoryPlanV4 {
  const body = record(response, 'response');
  if (
    body.kind !== 'cutter-grid-plan-result' ||
    body.version !== CUTTER_GRID_API_VERSION ||
    body.plannerImplementation !== 'hcr-sim-rust' ||
    typeof body.plannerBuild !== 'string' ||
    typeof body.planningDurationMs !== 'number' ||
    !Number.isFinite(body.planningDurationMs) ||
    body.profileSignature !== profile.profileSignature
  ) throw malformed('The Rust Cutter Grid planner returned an incompatible response.');

  const plan = record(body.plan, 'plan') as unknown as CutterTrajectoryPlanV4;
  if (
    plan.kind !== 'cutter-grid-trajectory' ||
    plan.version !== 4 ||
    plan.plannerVersion !== profile.plannerVersion ||
    plan.challengeSignature !== profile.challengeSignature ||
    plan.motionLimitsSignature !== profile.motionLimitsSignature ||
    plan.executedCommandCount !== compiled.executedCommandCount ||
    !Array.isArray(plan.actions) ||
    !Array.isArray(plan.positioning?.primitives) ||
    plan.positioning.primitives.length !== 1 ||
    !profile.entryOptions.some((entry) => entry.id === plan.positioning.entryOptionId)
  ) throw malformed('The Rust Cutter Grid plan does not match the certified profile.');

  if (plan.actions.length !== compiled.executableActions.length) {
    throw malformed('The Rust Cutter Grid plan changed the program action count.');
  }
  compiled.executableActions.forEach((expected, index) => {
    const actual = plan.actions[index];
    if (!actual || actual.type !== expected.type || actual.occurrenceId !== expected.occurrenceId ||
      actual.sourceBlockId !== expected.sourceBlockId || actual.logicalCommandCount !== expected.logicalCommandCount) {
      throw malformed(`The Rust Cutter Grid plan changed action ${index + 1}.`);
    }
    if (expected.type === 'move') {
      if (actual.type !== 'move' || actual.direction !== expected.direction || actual.distance !== expected.distance ||
        !sameCoord(actual.startCoord, expected.startCoord) || !sameCoord(actual.endCoord, expected.endCoord) ||
        !Array.isArray(actual.primitives) || actual.primitives.length < 1 || actual.primitives.length > 2) {
        throw malformed(`The Rust Cutter Grid plan changed Move ${index + 1}.`);
      }
    } else if (actual.type !== 'wait' || actual.durationMs !== expected.durationMs ||
      !Array.isArray(actual.expectedCutVoxels) || actual.expectedCutVoxels.length !== 0) {
      throw malformed(`The Rust Cutter Grid plan changed Wait ${index + 1}.`);
    }
  });
  if (!sameCoord(plan.startCoord, [0, 0, 0]) || !sameCoord(plan.endCoord, expectedEndCoord(compiled))) {
    throw malformed('The Rust Cutter Grid plan has an unexpected logical endpoint.');
  }
  assertPlanShape(plan);
  if (plan.positioning.trajectorySignature !== cutterGridRustPrimitiveSignatureV4(plan.positioning.primitives[0])) {
    throw malformed('The Rust Cutter Grid positioning signature is invalid.');
  }
  if (!isSignature(plan.trajectorySignature) || plan.trajectorySignature !== cutterGridRustPlanSignatureV4(plan)) {
    throw malformed('The Rust Cutter Grid trajectory signature is invalid.');
  }
  return plan;
}

function malformed(message: string): CutterGridRemotePlanningError {
  return new CutterGridRemotePlanningError(message, { fallbackAllowed: false });
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw malformed(`The Rust Cutter Grid ${name} is malformed.`);
  return value as Record<string, unknown>;
}

function sameCoord(value: readonly number[], expected: readonly number[]): boolean {
  return Array.isArray(value) && value.length === 3 && value.every((item, index) => item === expected[index]);
}

function expectedEndCoord(compiled: CompiledCutterGridProgramV2): readonly number[] {
  const lastMove = [...compiled.executableActions].reverse().find((action) => action.type === 'move');
  return lastMove?.type === 'move' ? lastMove.endCoord : [0, 0, 0];
}

function assertPlanShape(plan: CutterTrajectoryPlanV4): void {
  const finite = (value: unknown): boolean => {
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(finite);
    if (value && typeof value === 'object') return Object.values(value).every(finite);
    return typeof value === 'string' || typeof value === 'boolean' || value === null;
  };
  if (!finite(plan) || !isSignature(plan.trajectorySignature) || !isSignature(plan.positioning.trajectorySignature)) {
    throw malformed('The Rust Cutter Grid plan contains invalid values.');
  }
}

function isSignature(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{16}$/.test(value);
}

// `serde_json` keeps Rust struct declaration order and BTreeMap key order;
// it also serializes f64 integral values as `1.0`. Rebuilding that compact
// canonical preimage lets the browser verify the server-owned FNV signature
// without requiring the TypeScript planner to share Rust's signature.
export function cutterGridRustPlanSignatureV4(plan: CutterTrajectoryPlanV4): string {
  const unsigned = { ...plan, trajectorySignature: '' };
  return fnv1a64(rustPlanJson(unsigned));
}

export function cutterGridRustPrimitiveSignatureV4(primitive: CutterTrajectoryPlanV4['positioning']['primitives'][number]): string {
  return fnv1a64(rustPrimitiveJson(primitive));
}

function rustPlanJson(plan: Omit<CutterTrajectoryPlanV4, 'trajectorySignature'> & { trajectorySignature: string }): string {
  return objectJson([
    ['kind', text(plan.kind)], ['version', integer(plan.version)], ['plannerVersion', text(plan.plannerVersion)],
    ['challengeSignature', text(plan.challengeSignature)], ['positioning', rustPositioningJson(plan.positioning)],
    ['startCoord', coordJson(plan.startCoord)], ['endCoord', coordJson(plan.endCoord)],
    ['actions', arrayJson(plan.actions.map(rustActionJson))], ['expectedResultVoxels', arrayJson(plan.expectedResultVoxels.map(text))],
    ['estimatedDurationMs', float(plan.estimatedDurationMs)], ['executedCommandCount', integer(plan.executedCommandCount)],
    ['motionLimits', rustMotionLimitsJson(plan.motionLimits)], ['motionLimitsSignature', text(plan.motionLimitsSignature)],
    ['diagnostics', rustDiagnosticsJson(plan.diagnostics)], ['trajectorySignature', text(plan.trajectorySignature)],
  ]);
}

function rustPositioningJson(positioning: CutterTrajectoryPlanV4['positioning']): string {
  return objectJson([
    ['entryOptionId', text(positioning.entryOptionId)],
    ['primitives', arrayJson(positioning.primitives.map(rustPrimitiveJson))],
    ['trajectorySignature', text(positioning.trajectorySignature)],
  ]);
}

function rustActionJson(action: CutterTrajectoryPlanV4['actions'][number]): string {
  if (action.type === 'wait') return objectJson([
    ['type', text('wait')], ['occurrenceId', text(action.occurrenceId)], ['sourceBlockId', text(action.sourceBlockId)],
    ['durationMs', float(action.durationMs)], ['logicalCommandCount', integer(action.logicalCommandCount)],
    ['expectedCutVoxels', arrayJson([])],
  ]);
  return objectJson([
    ['type', text('move')], ['occurrenceId', text(action.occurrenceId)], ['sourceBlockId', text(action.sourceBlockId)],
    ['direction', text(action.direction)], ['distance', integer(action.distance)], ['startCoord', coordJson(action.startCoord)],
    ['endCoord', coordJson(action.endCoord)], ['logicalCommandCount', integer(action.logicalCommandCount)],
    ['primitives', arrayJson(action.primitives.map(rustPrimitiveJson))],
    ['contactEvents', arrayJson(action.contactEvents.map((event) => objectJson([
      ['timeMs', float(event.timeMs)], ['voxelKeys', arrayJson(event.voxelKeys.map(text))],
    ])))], ['expectedCutVoxels', arrayJson(action.expectedCutVoxels.map(text))],
  ]);
}

function rustPrimitiveJson(primitive: CutterTrajectoryPlanV4['positioning']['primitives'][number]): string {
  return objectJson([
    ['kind', text(primitive.kind)], ['interpolation', text(primitive.interpolation)], ['durationMs', float(primitive.durationMs)],
    ['start', rustBoundaryJson(primitive.start)], ['end', rustBoundaryJson(primitive.end)],
  ]);
}

function rustBoundaryJson(boundary: CutterTrajectoryPlanV4['positioning']['primitives'][number]['start']): string {
  return objectJson([
    ['jointAngles', floatMapJson(boundary.jointAngles)],
    ['jointVelocitiesDegPerSec', floatMapJson(boundary.jointVelocitiesDegPerSec)],
    ['jointAccelerationsDegPerSec2', floatMapJson(boundary.jointAccelerationsDegPerSec2)],
  ]);
}

function rustMotionLimitsJson(limits: CutterTrajectoryPlanV4['motionLimits']): string {
  return objectJson([
    ['requestedSpeedScale', float(limits.requestedSpeedScale)],
    ['joints', objectJson(Object.keys(limits.joints).sort().map((id) => [id, rustJointLimitsJson(limits.joints[id])] as [string, string]))],
  ]);
}

function rustJointLimitsJson(limits: CutterTrajectoryPlanV4['motionLimits']['joints'][string]): string {
  return objectJson([
    ['nominalVelocityDegPerSec', float(limits.nominalVelocityDegPerSec)],
    ['nominalAccelerationDegPerSec2', float(limits.nominalAccelerationDegPerSec2)],
    ['nominalJerkDegPerSec3', float(limits.nominalJerkDegPerSec3)],
    ['maxVelocityDegPerSec', float(limits.maxVelocityDegPerSec)],
    ['maxAccelerationDegPerSec2', float(limits.maxAccelerationDegPerSec2)],
    ['maxJerkDegPerSec3', float(limits.maxJerkDegPerSec3)],
  ]);
}

function rustDiagnosticsJson(diagnostics: CutterTrajectoryPlanV4['diagnostics']): string {
  return objectJson([
    ['endpointLayerCount', integer(diagnostics.endpointLayerCount)],
    ['candidateCounts', arrayJson(diagnostics.candidateCounts.map(integer))],
    ...(diagnostics.expandedActionIndex === undefined ? [] : [['expandedActionIndex', integer(diagnostics.expandedActionIndex)] as [string, string]]),
    ['directPrimitiveCount', integer(diagnostics.directPrimitiveCount)], ['detourPrimitiveCount', integer(diagnostics.detourPrimitiveCount)],
    ['minimumHeadClearance', float(diagnostics.minimumHeadClearance)], ['minimumJointLimitMargin', float(diagnostics.minimumJointLimitMargin)],
    ['maximumNormalizedJointStep', float(diagnostics.maximumNormalizedJointStep)], ['maximumEndEffectorChordDeviation', float(diagnostics.maximumEndEffectorChordDeviation)],
    ['requestedSpeedScale', float(diagnostics.requestedSpeedScale)], ['actualSpeedScale', float(diagnostics.actualSpeedScale)],
    ['maximumVelocityRatio', float(diagnostics.maximumVelocityRatio)], ['maximumAccelerationRatio', float(diagnostics.maximumAccelerationRatio)],
    ['maximumJerkRatio', float(diagnostics.maximumJerkRatio)], ['adaptiveValidationSampleCount', integer(diagnostics.adaptiveValidationSampleCount)],
  ]);
}

function floatMapJson(values: Record<string, number>): string {
  return objectJson(Object.keys(values).sort().map((key) => [key, float(values[key])] as [string, string]));
}

function coordJson(coord: readonly number[]): string {
  return arrayJson(coord.map(integer));
}

function objectJson(entries: readonly [string, string][]): string {
  return `{${entries.map(([key, value]) => `${textKey(key)}:${value}`).join(',')}}`;
}

function arrayJson(values: readonly string[]): string {
  return `[${values.join(',')}]`;
}

function textKey(value: string): string {
  return JSON.stringify(value);
}

function text(value: string): string {
  return JSON.stringify(value);
}

function integer(value: number): string {
  if (!Number.isSafeInteger(value)) throw malformed('The Rust Cutter Grid plan has a non-integer field.');
  return `${value}`;
}

function float(value: number): string {
  if (!Number.isFinite(value)) throw malformed('The Rust Cutter Grid plan has a non-finite field.');
  if (Object.is(value, -0)) return '-0.0';
  const encoded = `${value}`;
  return /[.eE]/.test(encoded) ? encoded.replace('e+', 'e') : `${encoded}.0`;
}

import type { Challenge } from '../../types/domain';
import { CutterGridPlanningError } from './trajectory';
import { CutterGridLadderPlanningError } from './ladderPlanner';
import { CutterGridMotionV3Error } from './motionV3';
import { CutterGridCompactPtpV4PlanningError } from './compactPtpV4';
import type {
  CompiledCutterGridProgramV2,
  CompiledCutterGridProgramV1,
  CutterGridPlanningProgressV2,
  CutterGridPlanningProgressV3,
  CutterGridPlanningProgressV4,
  CutterGridProfileV1,
  CutterGridProfileV2,
  CutterGridProfileV3,
  CutterGridProfileV4,
  CutterTrajectoryPlanV1,
  CutterTrajectoryPlanV2,
  CutterTrajectoryPlanV3,
  CutterTrajectoryPlanV4,
} from './types';
import type { CutterGridWorkerRequest, CutterGridWorkerResponse } from './workerProtocol';

export interface CutterGridPlannerWorkerLike {
  postMessage(message: CutterGridWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<CutterGridWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export type CutterGridWorkerFactory = () => CutterGridPlannerWorkerLike;

export class CutterGridPlannerClient {
  #requestId = 0;
  #worker: CutterGridPlannerWorkerLike | undefined;
  #reject: ((reason: unknown) => void) | undefined;

  constructor(
    private readonly createWorker: CutterGridWorkerFactory = () =>
      new Worker(new URL('./planner.worker.ts', import.meta.url), {
        type: 'module',
      }),
  ) {}

  plan(
    challenge: Challenge,
    compiled: CompiledCutterGridProgramV1,
    profile: CutterGridProfileV1,
  ): Promise<CutterTrajectoryPlanV1> {
    this.cancel();
    const requestId = ++this.#requestId;
    const worker = this.createWorker();
    this.#worker = worker;
    return new Promise((resolve, reject) => {
      this.#reject = reject;
      worker.onmessage = (event) => {
        if (event.data.requestId !== requestId || this.#worker !== worker) return;
        this.finish(worker);
        if (event.data.type === 'planned') {
          resolve(event.data.plan);
          return;
        }
        if (event.data.type !== 'failed') return;
        reject(
          new CutterGridPlanningError(
            event.data.code as CutterGridPlanningError['code'],
            event.data.message,
            {
              sourceBlockId: event.data.sourceBlockId,
              targetCoord: event.data.targetCoord,
            },
          ),
        );
      };
      worker.onerror = (event) => {
        if (this.#worker !== worker) return;
        this.finish(worker);
        reject(new Error(event.message || 'Cutter Grid planning worker failed.'));
      };
      worker.postMessage({
        type: 'plan',
        requestId,
        challenge,
        compiled,
        profile,
      });
    });
  }

  planV2(
    challenge: Challenge,
    compiled: CompiledCutterGridProgramV1,
    profile: CutterGridProfileV2,
    onProgress?: (progress: Omit<CutterGridPlanningProgressV2, 'type' | 'requestId'>) => void,
  ): Promise<CutterTrajectoryPlanV2> {
    this.cancel();
    const requestId = ++this.#requestId;
    const worker = this.createWorker();
    this.#worker = worker;
    return new Promise((resolve, reject) => {
      this.#reject = reject;
      worker.onmessage = (event) => {
        if (event.data.requestId !== requestId || this.#worker !== worker) return;
        if (event.data.type === 'progress') {
          onProgress?.({
            phase: event.data.phase,
            completedLayers: event.data.completedLayers,
            totalLayers: event.data.totalLayers,
            seedBudget: event.data.seedBudget,
            ...(event.data.disconnectedLayer === undefined ? {} : { disconnectedLayer: event.data.disconnectedLayer }),
          });
          return;
        }
        this.finish(worker);
        if (event.data.type === 'planned-v2') {
          resolve(event.data.plan);
          return;
        }
        if (event.data.type !== 'failed') return;
        reject(new CutterGridLadderPlanningError(
          event.data.code as CutterGridLadderPlanningError['code'],
          event.data.message,
          {
            sourceBlockId: event.data.sourceBlockId,
            actionIndex: event.data.actionIndex,
            layerIndex: event.data.layerIndex,
            startCoord: event.data.startCoord,
            targetCoord: event.data.targetCoord,
            stage: event.data.stage as CutterGridLadderPlanningError['details']['stage'],
            seedBudget: event.data.seedBudget,
          },
        ));
      };
      worker.onerror = (event) => {
        if (this.#worker !== worker) return;
        this.finish(worker);
        reject(new Error(event.message || 'Cutter Grid V2 planning worker failed.'));
      };
      worker.postMessage({ type: 'plan-v2', requestId, challenge, compiled, profile });
    });
  }

  planV3(
    challenge: Challenge,
    compiled: CompiledCutterGridProgramV1,
    profile: CutterGridProfileV3,
    onProgress?: (progress: Omit<CutterGridPlanningProgressV3, 'type' | 'requestId'>) => void,
  ): Promise<CutterTrajectoryPlanV3> {
    this.cancel();
    const requestId = ++this.#requestId;
    const worker = this.createWorker();
    this.#worker = worker;
    return new Promise((resolve, reject) => {
      this.#reject = reject;
      worker.onmessage = (event) => {
        if (event.data.requestId !== requestId || this.#worker !== worker) return;
        if (event.data.type === 'progress-v3') {
          onProgress?.({
            phase: event.data.phase,
            completedItems: event.data.completedItems,
            totalItems: event.data.totalItems,
            unit: event.data.unit,
            ...(event.data.seedBudget === undefined ? {} : { seedBudget: event.data.seedBudget }),
            ...(event.data.disconnectedLayer === undefined ? {} : { disconnectedLayer: event.data.disconnectedLayer }),
          });
          return;
        }
        this.finish(worker);
        if (event.data.type === 'planned-v3') {
          resolve(event.data.plan);
          return;
        }
        if (event.data.type !== 'failed') return;
        reject(new CutterGridMotionV3Error(
          event.data.code as CutterGridMotionV3Error['code'],
          event.data.message,
          {
            sourceBlockId: event.data.sourceBlockId,
            targetCoord: event.data.targetCoord,
            actionIndex: event.data.actionIndex,
          },
        ));
      };
      worker.onerror = (event) => {
        if (this.#worker !== worker) return;
        this.finish(worker);
        reject(new Error(event.message || 'Cutter Grid V3 planning worker failed.'));
      };
      worker.postMessage({ type: 'plan-v3', requestId, challenge, compiled, profile });
    });
  }

  /**
   * V4 remains isolated from the Servo protocol. The Cutter Grid workbench
   * uses this endpoint only after compiling its V4-only executable actions.
   */
  planV4(
    challenge: Challenge,
    compiled: CompiledCutterGridProgramV2,
    profile: CutterGridProfileV4,
    onProgress?: (progress: Omit<CutterGridPlanningProgressV4, 'type' | 'requestId'>) => void,
  ): Promise<CutterTrajectoryPlanV4> {
    this.cancel();
    const requestId = ++this.#requestId;
    const worker = this.createWorker();
    this.#worker = worker;
    return new Promise((resolve, reject) => {
      this.#reject = reject;
      worker.onmessage = (event) => {
        if (event.data.requestId !== requestId || this.#worker !== worker) return;
        if (event.data.type === 'progress-v4') {
          onProgress?.({
            phase: event.data.phase,
            completedActions: event.data.completedActions,
            totalActions: event.data.totalActions,
            ...(event.data.expandedActionIndex === undefined
              ? {}
              : { expandedActionIndex: event.data.expandedActionIndex }),
          });
          return;
        }
        this.finish(worker);
        if (event.data.type === 'planned-v4') {
          resolve(event.data.plan);
          return;
        }
        if (event.data.type !== 'failed') return;
        reject(new CutterGridCompactPtpV4PlanningError(
          event.data.code as CutterGridCompactPtpV4PlanningError['code'],
          event.data.message,
          {
            sourceBlockId: event.data.sourceBlockId,
            targetCoord: event.data.targetCoord,
            startCoord: event.data.startCoord,
            actionIndex: event.data.actionIndex,
            stage: event.data.stage as CutterGridCompactPtpV4PlanningError['details']['stage'],
          },
        ));
      };
      worker.onerror = (event) => {
        if (this.#worker !== worker) return;
        this.finish(worker);
        reject(new Error(event.message || 'Cutter Grid V4 planning worker failed.'));
      };
      worker.postMessage({ type: 'plan-v4', requestId, challenge, compiled, profile });
    });
  }

  cancel(): void {
    const worker = this.#worker;
    if (!worker) return;
    this.#worker = undefined;
    worker.terminate();
    this.#reject?.(
      new CutterGridPlanningError(
        'planning-cancelled',
        'Cutter Grid planning was cancelled because its inputs changed.',
      ),
    );
    this.#reject = undefined;
  }

  private finish(worker: CutterGridPlannerWorkerLike): void {
    if (this.#worker !== worker) return;
    this.#worker = undefined;
    this.#reject = undefined;
    worker.terminate();
  }
}

import type { Challenge } from '../../types/domain';
import { CutterGridPlanningError } from './trajectory';
import { CutterGridLadderPlanningError } from './ladderPlanner';
import type {
  CompiledCutterGridProgramV1,
  CutterGridPlanningProgressV2,
  CutterGridProfileV1,
  CutterGridProfileV2,
  CutterTrajectoryPlanV1,
  CutterTrajectoryPlanV2,
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
            stage: event.data.stage,
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

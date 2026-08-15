/// <reference lib="webworker" />
import {
  CutterGridPlanningError,
  planCutterGridTrajectory,
  serializeCutterTrajectoryPlan,
} from './trajectory';
import { CutterGridLadderPlanningError, planCutterGridLadderTrajectory } from './ladderPlanner';
import type { CutterGridWorkerRequest, CutterGridWorkerResponse } from './workerProtocol';

const worker = self as DedicatedWorkerGlobalScope;

worker.onmessage = (event: MessageEvent<CutterGridWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'plan-v2') {
    try {
      const plan = planCutterGridLadderTrajectory(
        request.challenge,
        request.compiled,
        request.profile,
        {
          onProgress: (progress) => worker.postMessage({
            type: 'progress',
            requestId: request.requestId,
            ...progress,
          } satisfies CutterGridWorkerResponse),
        },
      );
      worker.postMessage({
        type: 'planned-v2',
        requestId: request.requestId,
        plan,
      } satisfies CutterGridWorkerResponse);
    } catch (error) {
      const details = error instanceof CutterGridLadderPlanningError ? error.details : {};
      worker.postMessage({
        type: 'failed',
        requestId: request.requestId,
        code: error instanceof CutterGridLadderPlanningError ? error.code : 'planning-search-exhausted',
        message: error instanceof Error ? error.message : 'Cutter Grid V2 planning failed.',
        ...details,
      } satisfies CutterGridWorkerResponse);
    }
    return;
  }
  if (request.type !== 'plan') return;
  try {
    const reachableCoords = new Set(
      request.profile.nodes
        .filter((node) => node.reachable)
        .map((node) => node.coord.join(',')),
    );
    const plan = serializeCutterTrajectoryPlan(
      request.challenge,
      request.profile.originHairCoord,
      planCutterGridTrajectory(request.challenge,
      request.compiled,
      {
        challengeSignature: request.profile.challengeSignature,
        originHairCoord: request.profile.originHairCoord,
        bounds: request.profile.bounds,
        startJointAngles: request.profile.entryJointAngles,
        ...(reachableCoords.size > 0 ? { reachableCoords } : {}),
      },
      ),
    );
    worker.postMessage({
      type: 'planned',
      requestId: request.requestId,
      plan,
    } satisfies CutterGridWorkerResponse);
  } catch (error) {
    worker.postMessage({
      type: 'failed',
      requestId: request.requestId,
      code: error instanceof CutterGridPlanningError ? error.code : 'planning-failed',
      message: error instanceof Error ? error.message : 'Cutter Grid planning failed.',
      ...(error instanceof CutterGridPlanningError ? error.details : {}),
    } satisfies CutterGridWorkerResponse);
  }
};

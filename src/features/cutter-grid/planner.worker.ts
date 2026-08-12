/// <reference lib="webworker" />
import {
  CutterGridPlanningError,
  planCutterGridTrajectory,
  serializeCutterTrajectoryPlan,
} from './trajectory';
import type { CutterGridWorkerRequest, CutterGridWorkerResponse } from './workerProtocol';

const worker = self as DedicatedWorkerGlobalScope;

worker.onmessage = (event: MessageEvent<CutterGridWorkerRequest>) => {
  const request = event.data;
  if (request.type !== 'plan') return;
  try {
    const reachableCoords = new Set(
      request.profile.nodes
        .filter((node) => node.reachable)
        .map((node) => node.coord.join(',')),
    );
    const plan = serializeCutterTrajectoryPlan(planCutterGridTrajectory(
      request.challenge,
      request.compiled,
      {
        challengeSignature: request.profile.challengeSignature,
        originHairCoord: request.profile.originHairCoord,
        bounds: request.profile.bounds,
        startJointAngles: request.profile.entryJointAngles,
        ...(reachableCoords.size > 0 ? { reachableCoords } : {}),
      },
    ));
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

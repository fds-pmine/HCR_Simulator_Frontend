/// <reference lib="webworker" />
import {
  CutterGridPlanningError,
  planCutterGridTrajectory,
  serializeCutterTrajectoryPlan,
} from './trajectory';
import { CutterGridLadderPlanningError, planCutterGridLadderTrajectory } from './ladderPlanner';
import { CutterGridMotionV3Error, retimeCutterGridTrajectoryV3 } from './motionV3';
import { CUTTER_GRID_LADDER_PLANNER_VERSION, CUTTER_GRID_PROFILE_V2_VERSION } from './types';
import type { CutterGridWorkerRequest, CutterGridWorkerResponse } from './workerProtocol';

const worker = self as DedicatedWorkerGlobalScope;

worker.onmessage = (event: MessageEvent<CutterGridWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'plan-v3') {
    try {
      // V3 deliberately reuses the V2 global graph only to obtain one frozen,
      // collision-safe geometry branch.  All timing work afterwards is pure
      // V3 data and never asks the renderer to choose another IK solution.
      const v2Plan = planCutterGridLadderTrajectory(
        request.challenge,
        request.compiled,
        {
          ...request.profile,
          version: CUTTER_GRID_PROFILE_V2_VERSION,
          plannerVersion: CUTTER_GRID_LADDER_PLANNER_VERSION,
        },
        {
          onProgress: (progress) => worker.postMessage({
            type: 'progress',
            requestId: request.requestId,
            ...progress,
          } satisfies CutterGridWorkerResponse),
        },
      );
      const plan = retimeCutterGridTrajectoryV3(
        request.challenge,
        v2Plan,
        request.profile.motionLimits,
      );
      worker.postMessage({
        type: 'planned-v3',
        requestId: request.requestId,
        plan,
      } satisfies CutterGridWorkerResponse);
    } catch (error) {
      const details = error instanceof CutterGridLadderPlanningError
        ? error.details
        : error instanceof CutterGridMotionV3Error
          ? error.details
          : {};
      worker.postMessage({
        type: 'failed',
        requestId: request.requestId,
        code: error instanceof CutterGridLadderPlanningError || error instanceof CutterGridMotionV3Error
          ? error.code
          : 'trajectory-smoothing-search-exhausted',
        message: error instanceof Error ? error.message : 'Cutter Grid V3 planning failed.',
        ...details,
      } satisfies CutterGridWorkerResponse);
    }
    return;
  }
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

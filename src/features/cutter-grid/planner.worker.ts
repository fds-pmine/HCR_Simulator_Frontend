/// <reference lib="webworker" />
import {
  CutterGridPlanningError,
  planCutterGridTrajectory,
  serializeCutterTrajectoryPlan,
} from './trajectory';
import { CutterGridLadderPlanningError, planCutterGridLadderTrajectory } from './ladderPlanner';
import { CutterGridMotionV3Error, retimeCutterGridTrajectoryV3 } from './motionV3';
import { sampleRuckigLocalStateToState } from './ruckigLocalWasm';
import { loadRuckigLocalWorkerModule } from './ruckigLocalWorker';
import { retimeCutterGridPlanWithLocalRuckigV3 } from './ruckigPlanV3';
import { planCutterGridCompactPtpV4 } from './compactPtpPlannerV4';
import { CutterGridCompactPtpV4PlanningError } from './compactPtpV4';
import { CUTTER_GRID_LADDER_PLANNER_VERSION, CUTTER_GRID_PROFILE_V2_VERSION } from './types';
import type { CutterGridWorkerRequest, CutterGridWorkerResponse } from './workerProtocol';

const worker = self as DedicatedWorkerGlobalScope;
const useLocalRuckigTrial = import.meta.env.VITE_HCR_CUTTER_GRID_RUCKIG_TRIAL === '1';

worker.onmessage = (event: MessageEvent<CutterGridWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'plan-v4') {
    // V4 stays isolated from the V1–V3 Cartesian/dense pipelines even after
    // its compact planner becomes active.
    try {
      const plan = planCutterGridCompactPtpV4(
        request.challenge,
        request.compiled,
        request.profile,
        {
          onProgress: (progress) => worker.postMessage({
            type: 'progress-v4',
            requestId: request.requestId,
            ...progress,
          } satisfies CutterGridWorkerResponse),
        },
      );
      worker.postMessage({
        type: 'planned-v4',
        requestId: request.requestId,
        plan,
      } satisfies CutterGridWorkerResponse);
    } catch (error) {
      const details = error instanceof CutterGridCompactPtpV4PlanningError
        ? error.details
        : {};
      worker.postMessage({
        type: 'failed',
        requestId: request.requestId,
        code: error instanceof CutterGridCompactPtpV4PlanningError
          ? error.code
          : 'ptp-certificate-failed',
        message: error instanceof Error ? error.message : 'Cutter Grid V4 planning failed.',
        ...details,
      } satisfies CutterGridWorkerResponse);
    }
    return;
  }
  if (request.type === 'plan-v3') {
    void (async () => {
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
            type: 'progress-v3',
            requestId: request.requestId,
            phase: progress.phase,
            completedItems: progress.completedLayers,
            totalItems: progress.totalLayers,
            unit: 'layers',
            seedBudget: progress.seedBudget,
            ...(progress.disconnectedLayer === undefined
              ? {}
              : { disconnectedLayer: progress.disconnectedLayer }),
          } satisfies CutterGridWorkerResponse),
        },
      );
      const analyticPlan = retimeCutterGridTrajectoryV3(
        request.challenge,
        v2Plan,
        request.profile.motionLimits,
        {
          onProgress: (progress) => worker.postMessage({
            type: 'progress-v3',
            requestId: request.requestId,
            phase: progress.phase,
            completedItems: progress.completedSegments,
            totalItems: progress.totalSegments,
            unit: 'motion-segments',
          } satisfies CutterGridWorkerResponse),
        },
      );
      let plan = analyticPlan;
      if (useLocalRuckigTrial) {
        const localRuckig = await loadRuckigLocalWorkerModule();
        plan = retimeCutterGridPlanWithLocalRuckigV3(
          request.challenge,
          analyticPlan,
          { sample: (input) => sampleRuckigLocalStateToState(localRuckig, input) },
        );
      }
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
    })();
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

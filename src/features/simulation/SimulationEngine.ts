import type { CompiledProgram, RobotCommand } from '../blockly/programTypes';
import type {
  CutterGridProfileV1,
  CutterGridPositioningMotionV3,
  CutterGridPlanningDiagnosticsV2,
  CutterTrajectoryPlanV1,
  CutterTrajectoryPlanV2,
  CutterTrajectoryPlanV3,
  CutterTrajectoryStepV1,
  CutterTrajectoryWaypointV1,
} from '../cutter-grid/types';
import { interpolateCutterTrajectoryJointAngles } from '../cutter-grid/trajectory';
import { evaluateCutterGridPositioningV3At } from '../cutter-grid/motionV3';
import { calculateScore, estimateProgramDuration } from '../scoring/scoring';
import type { RobotPose } from '../robot/kinematics';
import { RobotController } from '../robot/RobotController';
import { findRobotHeadCollision } from '../robot/headCollision';
import { findSweptVoxelHits } from '../voxel/contactDetection';
import type {
  Challenge,
  JointId,
  ProgramMetrics,
  ScoreResult,
  Vec3Tuple,
  VoxelKey,
} from '../../types/domain';
import type { ScoreProvider } from '../../services/contracts';
import { ProgramExecutor } from './programExecutor';
import { CutterTrajectoryExecutor } from './cutterTrajectoryExecutor';

export type SimulationStatus =
  | 'loading'
  | 'positioning'
  | 'planning'
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'stopped'
  | 'error';

/**
 * Statuses a fresh run may start from.
 *
 * The terminal three are included deliberately: finishing a program is not a
 * state you should have to clear before doing anything else. `Run` already
 * treats them this way — it re-prepares from the top — and `Step` used to not,
 * which is why stepping after a completed run appeared to do nothing at all.
 */
export const RESTARTABLE_STATUSES: readonly SimulationStatus[] = [
  'idle',
  'completed',
  'stopped',
  'error',
];

export type SimulationLogType =
  | 'system'
  | 'command'
  | 'collision'
  | 'score'
  | 'error';

export interface SimulationLogEntry {
  id: number;
  simulationTimeMs: number;
  type: SimulationLogType;
  message: string;
  blockId?: string;
}

export interface SimulationSnapshot {
  status: SimulationStatus;
  jointAngles: Readonly<Record<JointId, number>>;
  endEffector: Vec3Tuple;
  hairVoxels: ReadonlySet<VoxelKey>;
  initialVoxelCount: number;
  targetVoxelCount: number;
  currentBlockId?: string;
  activeJointId?: JointId;
  metrics: ProgramMetrics;
  scoreResult?: ScoreResult;
  logs: readonly SimulationLogEntry[];
  errorMessage?: string;
  cutterGrid?: {
    currentCoord: readonly [number, number, number];
    nextCoord?: readonly [number, number, number];
    stepIndex: number;
    totalSteps: number;
    stepProgress: number;
    trajectorySignature?: string;
    entryOptionId?: string;
    diagnostics?: CutterGridPlanningDiagnosticsV2;
  };
}

type Listener = () => void;

const MAX_LOG_ENTRIES = 200;
const SNAPSHOT_INTERVAL_MS = 100;

export class SimulationEngine {
  readonly robotController: RobotController;
  private readonly executor: ProgramExecutor;
  private readonly cutterExecutor: CutterTrajectoryExecutor;
  private readonly listeners = new Set<Listener>();
  private status: SimulationStatus = 'idle';
  private hairVoxels: Set<VoxelKey>;
  private metrics: ProgramMetrics = {
    sourceBlockCount: 0,
    executedCommandCount: 0,
    estimatedDurationMs: 0,
  };
  private scoreResult: ScoreResult | undefined;
  private logs: SimulationLogEntry[] = [];
  private nextLogId = 1;
  private simulationTimeMs = 0;
  private stepTargetCommandCount: number | undefined;
  private snapshotElapsedMs = 0;
  private errorMessage: string | undefined;
  private scorePromise: Promise<ScoreResult | undefined> =
    Promise.resolve(undefined);
  private snapshot: SimulationSnapshot;
  private runGeneration = 0;
  private executionMode: 'servo' | 'cutter-grid' = 'servo';
  private positioningWaypoints: readonly CutterTrajectoryWaypointV1[] = [];
  private positioningMotionV3: CutterGridPositioningMotionV3 | undefined;
  private positioningElapsedMs = 0;
  private positioningWaypointIndex = 0;
  private positioningCompletion: 'idle' | 'run' | 'step' = 'idle';
  /** Last rAF-derived timestamp. Never participates in headless replay. */
  private playbackTimestampMs: number | undefined;

  constructor(
    private readonly challenge: Challenge,
    private readonly scoreProvider: ScoreProvider,
  ) {
    this.robotController = new RobotController(
      challenge.robotConfig,
      (pose) =>
        findRobotHeadCollision(
          pose,
          challenge.voxelConfig,
          challenge.robotConfig.geometry,
        ),
    );
    const initialCollision = findRobotHeadCollision(
      this.robotController.getPose(),
      challenge.voxelConfig,
      challenge.robotConfig.geometry,
    );
    if (initialCollision) {
      throw new Error(
        `The challenge's initial pose collides with the head: ${initialCollision.partLabel}.`,
      );
    }
    this.executor = new ProgramExecutor(this.robotController);
    this.cutterExecutor = new CutterTrajectoryExecutor(this.robotController, challenge);
    this.hairVoxels = new Set(challenge.initialHair.voxels);
    this.addLog('system', `Challenge "${challenge.name}" loaded.`);
    this.snapshot = this.createSnapshot();
  }

  run(compiled: CompiledProgram): void {
    if (
      this.status === 'running' ||
      this.status === 'paused' ||
      this.status === 'loading'
    ) {
      throw new Error(`Run is not allowed while status is "${this.status}".`);
    }
    this.prepareProgram(compiled);
    this.status = 'running';
    this.addLog('system', 'Program started running.');
    this.publish();
  }

  positionCutterGrid(profile: CutterGridProfileV1): void {
    if (this.status !== 'idle') {
      throw new Error(`Positioning is not allowed while status is "${this.status}".`);
    }
    this.executionMode = 'cutter-grid';
    this.status = 'positioning';
    this.positioningWaypoints = profile.entryTrajectory;
    this.positioningMotionV3 = undefined;
    this.positioningElapsedMs = 0;
    this.positioningWaypointIndex = 0;
    this.positioningCompletion = 'idle';
    const first = profile.entryTrajectory[0];
    if (!first) {
      this.status = 'error';
      this.errorMessage = 'The certified Cutter Grid entry trajectory is empty.';
      this.publish();
      return;
    }
    this.robotController.setTrajectoryAngles(first.jointAngles);
    this.addLog('system', 'Positioning cutter at the certified grid origin.');
    this.publish();
  }

  beginPlanning(): void {
    if (this.status !== 'idle') {
      throw new Error(`Planning is not allowed while status is "${this.status}".`);
    }
    this.executionMode = 'cutter-grid';
    this.status = 'planning';
    this.addLog('system', 'Cutter Grid trajectory planning started.');
    this.publish();
  }

  cancelPlanning(): void {
    if (this.status !== 'planning') return;
    this.status = 'idle';
    this.addLog('system', 'Cutter Grid trajectory planning cancelled.');
    this.publish();
  }

  runCutterGrid(
    plan: CutterTrajectoryPlanV1 | CutterTrajectoryPlanV2 | CutterTrajectoryPlanV3,
    sourceBlockCount: number,
  ): void {
    if (
      !['idle', 'planning', 'completed', 'stopped', 'error'].includes(
        this.status,
      )
    ) {
      throw new Error(`Run is not allowed while status is "${this.status}".`);
    }
    this.prepareCutterGridPlan(plan, sourceBlockCount);
    if (plan.version !== 1) {
      this.beginCutterGridPositioning(plan, 'run');
      this.addLog('system', 'Positioning cutter for the selected Cutter Grid branch.');
    } else {
      this.status = 'running';
      this.addLog('system', 'Cutter Grid program started running.');
    }
    this.publish();
  }

  stepCutterGrid(
    plan?: CutterTrajectoryPlanV1 | CutterTrajectoryPlanV2 | CutterTrajectoryPlanV3,
    sourceBlockCount = 0,
  ): void {
    const resumable =
      this.status === 'paused' && this.executionMode === 'cutter-grid';
    if (!resumable) {
      // `planning` joins the restartable set here: the plan has just been
      // solved and stepping is the natural next action.
      if (
        !RESTARTABLE_STATUSES.includes(this.status) &&
        this.status !== 'planning'
      ) {
        return;
      }
      if (!plan) throw new Error('A Cutter Grid trajectory is required for the first step.');
      this.prepareCutterGridPlan(plan, sourceBlockCount);
      if (plan.version !== 1) {
        this.beginCutterGridPositioning(plan, 'step');
        this.addLog('system', 'Positioning cutter for the selected Cutter Grid branch.');
        this.publish();
        return;
      }
    }
    this.stepTargetCommandCount = this.cutterExecutor.getStepIndex() + 1;
    this.status = 'running';
    this.addLog('system', 'Started single-step execution of one Cutter Grid action.');
    this.publish();
  }

  pause(): void {
    if (this.status !== 'running') {
      return;
    }
    this.status = 'paused';
    this.addLog('system', 'Program paused.');
    this.publish();
  }

  resume(): void {
    if (this.status !== 'paused') {
      return;
    }
    this.stepTargetCommandCount = undefined;
    this.status = 'running';
    this.addLog('system', 'Program resumed.');
    this.publish();
  }

  step(compiled?: CompiledProgram): void {
    if (this.status !== 'paused') {
      // Anything restartable begins a new run, exactly as `run` does. Only
      // `running`, `loading` and `positioning` fall through to a no-op, because
      // stepping into a run already in motion is meaningless.
      if (!RESTARTABLE_STATUSES.includes(this.status)) {
        return;
      }
      if (!compiled) {
        throw new Error('A compiled program is required for the first step.');
      }
      this.prepareProgram(compiled);
    }

    this.stepTargetCommandCount =
      this.executor.getCommandIndex() + 1;
    this.status = 'running';
    this.addLog('system', 'Started single-step execution of one command.');
    this.publish();
  }

  stop(): void {
    if (this.status !== 'running' && this.status !== 'paused') {
      return;
    }
    this.status = 'stopped';
    this.stepTargetCommandCount = undefined;
    this.scoreResult = undefined;
    this.addLog('system', 'Program stopped; current state preserved.');
    this.publish();
  }

  reset(): void {
    if (this.status === 'loading') {
      return;
    }
    this.resetState();
    this.addLog('system', "Simulation reset to the challenge's initial state.");
    this.publish();
  }

  /**
   * Render-time entry point. The authoritative plan time is the monotonic rAF
   * timestamp, not a fixed frame count or a multiplied render delta.
   */
  tickAt(playbackTimestampMs: number): void {
    if (!Number.isFinite(playbackTimestampMs)) {
      this.fail(new Error('Playback clock must be a finite timestamp.'));
      return;
    }
    const previous = this.playbackTimestampMs;
    this.playbackTimestampMs = playbackTimestampMs;
    if (previous === undefined || playbackTimestampMs < previous) return;
    this.tick(playbackTimestampMs - previous);
  }

  /** Drop the rAF anchor without changing the frozen plan or simulation state. */
  resetPlaybackClock(): void {
    this.playbackTimestampMs = undefined;
  }

  tick(deltaMs: number): void {
    if (this.status === 'positioning') {
      this.tickPositioning(deltaMs);
      return;
    }
    if (this.status !== 'running') {
      return;
    }

    try {
      if (this.executionMode === 'cutter-grid') {
        this.tickCutterGrid(deltaMs);
        return;
      }
      const maxCommands =
        this.stepTargetCommandCount === undefined ? undefined : 1;
      const result = this.executor.advance(
        deltaMs,
        {
          onCommandStart: (command, index) =>
            this.handleCommandStart(command, index),
          onCommandComplete: (command) =>
            this.handleCommandComplete(command),
          onMovement: (movement) =>
            this.handleMovement(
              movement.previousEndEffector,
              movement.currentEndEffector,
            ),
        },
        maxCommands,
      );

      this.simulationTimeMs += result.consumedMs;
      this.snapshotElapsedMs += result.consumedMs;

      if (result.blockedCollision) {
        const collision = result.blockedCollision;
        const sourceBlockId =
          this.executor.getCurrentCommand()?.sourceBlockId;
        // The offending block is highlighted in the editor, so naming its
        // internal Blockly id here added nothing a learner could use and put a
        // string like `!p3lgyq#.d:{:YBt_H2n.` in front of them. The id is still
        // passed to `fail` for the highlight; it just is not read out.
        this.fail(
          new Error(
            `${collision.partLabel} would contact the head. ${collision.jointId} stopped at ${collision.safeAngleDeg.toFixed(2)}° — the highlighted block asked for more.`,
          ),
          sourceBlockId,
        );
        return;
      }

      if (result.programCompleted) {
        this.completeProgram();
        return;
      }

      if (
        this.stepTargetCommandCount !== undefined &&
        this.executor.getCommandIndex() >=
          this.stepTargetCommandCount
      ) {
        this.status = 'paused';
        this.stepTargetCommandCount = undefined;
        this.addLog(
          'system',
          'Single-step command completed; program remains paused.',
        );
        this.publish();
        return;
      }

      if (this.snapshotElapsedMs >= SNAPSHOT_INTERVAL_MS) {
        this.snapshotElapsedMs = 0;
        this.publish();
      }
    } catch (error) {
      this.fail(error);
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): SimulationSnapshot {
    return this.snapshot;
  }

  getPose(): RobotPose {
    return this.robotController.getPose();
  }

  getChallenge(): Challenge {
    return this.challenge;
  }

  waitForScore(): Promise<ScoreResult | undefined> {
    return this.scorePromise;
  }

  private prepareProgram(compiled: CompiledProgram): void {
    if (compiled.runtimeCommands.length === 0) {
      throw new Error('Compiled program does not contain commands.');
    }
    this.resetState();
    this.executionMode = 'servo';
    this.positioningWaypoints = [];
    this.positioningMotionV3 = undefined;
    this.positioningElapsedMs = 0;
    this.positioningWaypointIndex = 0;
    this.positioningCompletion = 'idle';
    this.executor.load(compiled.runtimeCommands);
    this.metrics = {
      sourceBlockCount: compiled.program.sourceBlockCount,
      executedCommandCount: 0,
      estimatedDurationMs: estimateProgramDuration(
        compiled.runtimeCommands,
        this.challenge.robotConfig.joints,
      ),
    };
    this.addLog(
      'system',
      `Compilation complete: ${compiled.runtimeCommands.length} atomic commands.`,
    );
  }

  private resetState(): void {
    this.runGeneration += 1;
    this.robotController.reset();
    this.executor.reset();
    this.cutterExecutor.reset();
    this.hairVoxels = new Set(this.challenge.initialHair.voxels);
    this.metrics = {
      sourceBlockCount: 0,
      executedCommandCount: 0,
      estimatedDurationMs: 0,
    };
    this.status = 'idle';
    this.scoreResult = undefined;
    this.logs = [];
    this.nextLogId = 1;
    this.simulationTimeMs = 0;
    this.snapshotElapsedMs = 0;
    this.stepTargetCommandCount = undefined;
    this.errorMessage = undefined;
    this.executionMode = 'servo';
    this.positioningWaypoints = [];
    this.positioningMotionV3 = undefined;
    this.positioningElapsedMs = 0;
    this.positioningWaypointIndex = 0;
    this.positioningCompletion = 'idle';
    this.playbackTimestampMs = undefined;
    this.scorePromise = Promise.resolve(undefined);
  }

  private handleCommandStart(
    command: RobotCommand,
    index: number,
  ): void {
    const message =
      command.type === 'wait'
        ? `#${index + 1} Wait ${command.durationMs}ms`
        : `#${index + 1} ${command.jointId} → ${command.angleDeg}°`;
    this.addLog('command', message, command.sourceBlockId);
  }

  private handleCommandComplete(command: RobotCommand): void {
    this.metrics = {
      ...this.metrics,
      executedCommandCount:
        this.metrics.executedCommandCount + 1,
    };
    this.addLog(
      'command',
      'Command completed.',
      command.sourceBlockId,
    );
  }

  private handleMovement(start: Vec3Tuple, end: Vec3Tuple): void {
    const hits = findSweptVoxelHits(
      start,
      end,
      this.hairVoxels,
      this.challenge.voxelConfig,
      this.challenge.robotConfig.geometry.toolRadius,
    );
    if (hits.length === 0) {
      return;
    }

    const nextHair = new Set(this.hairVoxels);
    hits.forEach((key) => nextHair.delete(key));
    this.hairVoxels = nextHair;
    this.addLog(
      'collision',
      `Removed ${hits.length} hair voxel${hits.length === 1 ? '' : 's'}.`,
    );
  }

  private prepareCutterGridPlan(
    plan: CutterTrajectoryPlanV1 | CutterTrajectoryPlanV2 | CutterTrajectoryPlanV3,
    sourceBlockCount: number,
  ): void {
    if (plan.steps.length === 0) throw new Error('Cutter Grid plan contains no actions.');
    const startAngles = plan.steps
      .flatMap((step) => step.waypoints)
      .at(0)?.jointAngles;
    if (!startAngles) {
      throw new Error('Cutter Grid plan contains no trajectory start pose.');
    }
    this.runGeneration += 1;
    this.executor.reset();
    this.cutterExecutor.reset();
    this.hairVoxels = new Set(this.challenge.initialHair.voxels);
    this.scoreResult = undefined;
    this.logs = [];
    this.nextLogId = 1;
    this.simulationTimeMs = 0;
    this.snapshotElapsedMs = 0;
    this.stepTargetCommandCount = undefined;
    this.errorMessage = undefined;
    this.scorePromise = Promise.resolve(undefined);
    this.executionMode = 'cutter-grid';
    this.cutterExecutor.load(plan);
    if (plan.version === 1) {
      this.robotController.setTrajectoryAngles(startAngles);
    } else {
      // A V2 positioning trajectory is authenticated from Servo's initial
      // pose.  Reset before replay so Run, Test and Step never inherit an
      // arbitrary previous cutter configuration.
      this.robotController.reset();
    }
    this.metrics = {
      sourceBlockCount,
      executedCommandCount: 0,
      estimatedDurationMs: plan.estimatedDurationMs,
    };
    this.addLog('system', `Planning complete: ${plan.steps.length} atomic actions.`);
  }

  private tickCutterGrid(deltaMs: number): void {
    const maxSteps = this.stepTargetCommandCount === undefined ? undefined : 1;
    const result = this.cutterExecutor.advance(
      deltaMs,
      {
        onStepStart: (step, index) => this.handleCutterStepStart(step, index),
        onStepComplete: (step) => this.handleCutterStepComplete(step),
        onMovement: (movement) =>
          this.handleMovement(
            movement.previousEndEffector,
            movement.currentEndEffector,
          ),
      },
      maxSteps,
    );
    this.simulationTimeMs += result.consumedMs;
    this.snapshotElapsedMs += result.consumedMs;
    if (result.planCompleted) {
      this.completeProgram();
      return;
    }
    if (
      this.stepTargetCommandCount !== undefined &&
      this.cutterExecutor.getStepIndex() >= this.stepTargetCommandCount
    ) {
      this.status = 'paused';
      this.stepTargetCommandCount = undefined;
      this.addLog('system', 'Single-step Cutter Grid action completed; program remains paused.');
      this.publish();
      return;
    }
    if (this.snapshotElapsedMs >= SNAPSHOT_INTERVAL_MS) {
      this.snapshotElapsedMs = 0;
      this.publish();
    }
  }

  private tickPositioning(deltaMs: number): void {
    try {
      if (!Number.isFinite(deltaMs) || deltaMs < 0) {
        throw new Error('Delta must be a finite non-negative number.');
      }
      const waypoints = this.positioningWaypoints;
      const last = waypoints.at(-1);
      if (!last) {
        throw new Error('The certified Cutter Grid entry trajectory is empty.');
      }
      const targetTime = Math.min(
        last.timeMs,
        this.positioningElapsedMs + deltaMs,
      );
      while (
        this.positioningWaypointIndex + 1 < waypoints.length &&
        waypoints[this.positioningWaypointIndex + 1].timeMs <= targetTime
      ) {
        this.positioningWaypointIndex += 1;
        this.robotController.setTrajectoryAngles(
          waypoints[this.positioningWaypointIndex].jointAngles,
        );
      }
      const previous = waypoints[this.positioningWaypointIndex];
      const next = waypoints[this.positioningWaypointIndex + 1];
      if (previous && targetTime > previous.timeMs) {
        const jointAngles = this.positioningMotionV3
          ? evaluateCutterGridPositioningV3At(
            this.challenge,
            this.positioningMotionV3,
            targetTime,
          ).jointAngles
          : next
            ? interpolateCutterTrajectoryJointAngles(previous, next, targetTime)
            : undefined;
        if (jointAngles) this.robotController.setTrajectoryAngles(jointAngles);
      }
      this.positioningElapsedMs = targetTime;
      this.snapshotElapsedMs += deltaMs;
      if (targetTime >= last.timeMs) {
        this.robotController.setTrajectoryAngles(last.jointAngles);
        const completion = this.positioningCompletion;
        this.positioningCompletion = 'idle';
        this.status = completion === 'idle' ? 'idle' : 'running';
        if (completion === 'step') {
          this.stepTargetCommandCount = this.cutterExecutor.getStepIndex() + 1;
        }
        this.positioningWaypoints = [];
        this.positioningMotionV3 = undefined;
        this.addLog('system', completion === 'idle'
          ? 'Cutter positioned at the certified grid origin.'
          : 'Cutter positioned at the selected grid origin.');
        this.publish();
      } else if (this.snapshotElapsedMs >= SNAPSHOT_INTERVAL_MS) {
        this.snapshotElapsedMs = 0;
        this.publish();
      }
    } catch (error) {
      this.positioningWaypoints = [];
      this.positioningMotionV3 = undefined;
      this.fail(error);
    }
  }

  private beginCutterGridPositioning(
    plan: CutterTrajectoryPlanV2 | CutterTrajectoryPlanV3,
    completion: 'run' | 'step',
  ): void {
    const positioningMotion = plan.version === 3 ? plan.positioningMotion : undefined;
    const positioningWaypoints = positioningMotion?.waypoints ?? plan.positioningTrajectory;
    const first = positioningWaypoints[0];
    if (!first) throw new Error('The selected Cutter Grid entry trajectory is empty.');
    this.status = 'positioning';
    this.positioningWaypoints = positioningWaypoints;
    this.positioningMotionV3 = positioningMotion;
    this.positioningElapsedMs = 0;
    this.positioningWaypointIndex = 0;
    this.positioningCompletion = completion;
    this.robotController.setTrajectoryAngles(first.jointAngles);
  }

  private handleCutterStepStart(step: CutterTrajectoryStepV1, index: number): void {
    this.addLog(
      'command',
      step.kind === 'wait'
        ? `#${index + 1} Wait ${step.durationMs}ms`
        : `#${index + 1} Move to (${step.endCoord.join(', ')})`,
      step.sourceBlockId,
    );
  }

  private handleCutterStepComplete(step: CutterTrajectoryStepV1): void {
    this.metrics = {
      ...this.metrics,
      executedCommandCount: this.metrics.executedCommandCount + 1,
    };
    this.addLog('command', 'Cutter Grid action completed.', step.sourceBlockId);
  }

  private completeProgram(): void {
    this.status = 'completed';
    this.stepTargetCommandCount = undefined;
    this.addLog('system', 'Program completed; calculating score.');
    this.publish();

    const scoreGeneration = this.runGeneration;
    const scoreInput = {
        initialVoxels: this.challenge.initialHair.voxels,
        targetVoxels: this.challenge.targetHair.voxels,
        resultVoxels: this.hairVoxels,
        programMetrics: this.metrics,
        scoring: this.challenge.scoring,
      };
    // Cutter Grid is deliberately local-only until `hcr_sim` owns the same
    // V3 planner and cross-language fixtures prove deterministic replay.
    this.scorePromise = (this.executionMode === 'cutter-grid'
      ? Promise.resolve(calculateScore(scoreInput))
      : this.scoreProvider.score(scoreInput))
      .then((result) => {
        if (scoreGeneration !== this.runGeneration) {
          return result;
        }
        this.scoreResult = result;
        this.addLog(
          'score',
          `Score calculated: ${result.finalScore.toFixed(1)} points.`,
        );
        this.publish();
        return result;
      })
      .catch((error: unknown) => {
        if (scoreGeneration === this.runGeneration) {
          this.fail(error);
        }
        return undefined;
      });
  }

  private fail(error: unknown, blockId?: string): void {
    const message =
      error instanceof Error ? error.message : 'Unknown simulation error.';
    this.status = 'error';
    this.errorMessage = message;
    this.addLog('error', message, blockId);
    this.publish();
  }

  private addLog(
    type: SimulationLogType,
    message: string,
    blockId?: string,
  ): void {
    const entry: SimulationLogEntry = {
      id: this.nextLogId,
      simulationTimeMs: this.simulationTimeMs,
      type,
      message,
      ...(blockId ? { blockId } : {}),
    };
    this.nextLogId += 1;
    this.logs = [...this.logs, entry].slice(-MAX_LOG_ENTRIES);
  }

  private publish(): void {
    this.snapshot = this.createSnapshot();
    this.listeners.forEach((listener) => listener());
  }

  private createSnapshot(): SimulationSnapshot {
    const currentCommand = this.executor.getCurrentCommand();
    const currentCutterStep = this.cutterExecutor.getCurrentStep();
    const cutterPlan = this.cutterExecutor.getPlan();
    const cutterGrid =
      this.executionMode === 'cutter-grid'
        ? {
            currentCoord: currentCutterStep?.startCoord ??
              cutterPlan?.endCoord ?? [0, 0, 0] as const,
            ...(currentCutterStep
              ? { nextCoord: currentCutterStep.endCoord }
              : {}),
            stepIndex: this.cutterExecutor.getStepIndex(),
            totalSteps: cutterPlan?.steps.length ?? 0,
            stepProgress: currentCutterStep?.durationMs
              ? Math.min(
                  1,
                  this.cutterExecutor.getElapsedInStepMs() /
                    currentCutterStep.durationMs,
                )
              : 0,
            ...(cutterPlan
              ? { trajectorySignature: cutterPlan.trajectorySignature }
              : {}),
            ...(cutterPlan?.version !== undefined && cutterPlan.version !== 1
              ? {
                  entryOptionId: cutterPlan.entryOptionId,
                  diagnostics: cutterPlan.diagnostics,
                }
              : {}),
          }
        : undefined;
    return {
      status: this.status,
      jointAngles: this.robotController.getAngles(),
      endEffector: this.robotController.getPose().endEffector,
      hairVoxels: this.hairVoxels,
      initialVoxelCount: this.challenge.initialHair.voxels.size,
      targetVoxelCount: this.challenge.targetHair.voxels.size,
      currentBlockId:
        this.executionMode === 'cutter-grid'
          ? currentCutterStep?.sourceBlockId
          : currentCommand?.sourceBlockId,
      activeJointId:
        currentCommand?.type === 'set-joint-angle'
          ? currentCommand.jointId
          : undefined,
      metrics: { ...this.metrics },
      scoreResult: this.scoreResult
        ? { ...this.scoreResult }
        : undefined,
      logs: this.logs,
      errorMessage: this.errorMessage,
      ...(cutterGrid ? { cutterGrid } : {}),
    };
  }
}

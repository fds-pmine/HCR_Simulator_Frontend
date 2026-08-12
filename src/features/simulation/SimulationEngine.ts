import type { CompiledProgram, RobotCommand } from '../blockly/programTypes';
import type { CutterGridProfileV1, CutterTrajectoryPlanV1, CutterTrajectoryStepV1 } from '../cutter-grid/types';
import { estimateProgramDuration } from '../scoring/scoring';
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
    this.cutterExecutor = new CutterTrajectoryExecutor(this.robotController);
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
    for (const waypoint of profile.entryTrajectory) {
      this.robotController.setTrajectoryAngles(waypoint.jointAngles);
    }
    this.status = 'idle';
    this.addLog('system', 'Cutter positioned at the certified grid origin.');
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
    plan: CutterTrajectoryPlanV1,
    sourceBlockCount: number,
  ): void {
    if (this.status !== 'idle' && this.status !== 'planning') {
      throw new Error(`Run is not allowed while status is "${this.status}".`);
    }
    this.prepareCutterGridPlan(plan, sourceBlockCount);
    this.status = 'running';
    this.addLog('system', 'Cutter Grid program started running.');
    this.publish();
  }

  stepCutterGrid(
    plan?: CutterTrajectoryPlanV1,
    sourceBlockCount = 0,
  ): void {
    if (this.status === 'idle' || this.status === 'planning') {
      if (!plan) throw new Error('A Cutter Grid trajectory is required for the first step.');
      this.prepareCutterGridPlan(plan, sourceBlockCount);
    } else if (this.status !== 'paused' || this.executionMode !== 'cutter-grid') {
      return;
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
    if (this.status === 'idle') {
      if (!compiled) {
        throw new Error('A compiled program is required for the first step.');
      }
      this.prepareProgram(compiled);
    } else if (this.status !== 'paused') {
      return;
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

  tick(deltaMs: number): void {
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
    plan: CutterTrajectoryPlanV1,
    sourceBlockCount: number,
  ): void {
    if (plan.steps.length === 0) throw new Error('Cutter Grid plan contains no actions.');
    const positionedAngles = this.robotController.getAngles();
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
    this.robotController.setTrajectoryAngles(positionedAngles);
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
    this.scorePromise = this.scoreProvider
      .score({
        initialVoxels: this.challenge.initialHair.voxels,
        targetVoxels: this.challenge.targetHair.voxels,
        resultVoxels: this.hairVoxels,
        programMetrics: this.metrics,
        scoring: this.challenge.scoring,
      })
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
    };
  }
}

import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Blockly from 'blockly/core';
import {
  Braces,
  ChevronLeft,
  ChevronRight,
  Cpu,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import type { Challenge } from '../../types/domain';
import {
  BlocklyEditor,
  type BlocklyEditorHandle,
} from '../../features/blockly/BlocklyEditor';
import {
  ProgramCompilationError,
} from '../../features/blockly/programCompiler';
import type { CompiledProgram, Program } from '../../features/blockly/programTypes';
import {
  PROGRAMMING_MODE_LABEL,
  canSwitchProgrammingMode,
  type ProgrammingMode,
} from '../../features/blockly/programmingMode';
import {
  compileCutterGridExecutableProgramV2,
  CutterGridCompilationError,
} from '../../features/cutter-grid/programCompiler';
import { CutterGridPlannerClient } from '../../features/cutter-grid/plannerClient';
import { registeredCutterGridProfileV4 } from '../../features/cutter-grid/profileRegistry';
import { CutterGridCompactPtpV4PlanningError } from '../../features/cutter-grid/compactPtpV4';
import { CutterGridPlanningError } from '../../features/cutter-grid/trajectory';
import type {
  CompiledCutterGridProgramV2,
  CutterGridPlanningProgressV4,
  CutterTrajectoryPlanV4,
} from '../../features/cutter-grid/types';
import { SimulatorCanvas } from '../../features/simulation/SimulatorCanvas';
import type { SimulationEngine } from '../../features/simulation/SimulationEngine';
import {
  runCutterGridHeadless,
  runHeadless,
} from '../../features/simulation/headlessRun';
import { useSimulationSnapshot } from '../../features/simulation/useSimulationSnapshot';
import { useWorkbenchStore } from '../../features/simulation/simulationStore';
import { SimulationControls } from '../controls/SimulationControls';
import { ArmDock } from '../controls/ArmDock';
import { InspectorPanel } from '../inspector/InspectorPanel';
import { LogDrawer } from './LogDrawer';

/**
 * Everything a competitive round adds to the workbench.
 *
 * Optional, and inert when absent — solo practice renders the identical
 * workbench with no round attached, so there is one editor, one engine and one
 * scoring path rather than a second, drifting copy for versus mode.
 */
export interface WorkbenchMatch {
  /** Timer, roster and submission status, overlaid on the stage. */
  hud: ReactNode;
  /** Full-stage overlay — the start flash, then the scoreboard. */
  overlay?: ReactNode;
  /** Whether the round is currently accepting entries. */
  canSubmit: boolean;
  submitting: boolean;
  onSubmit: (compiled: CompiledProgram) => void;
}

/**
 * Everything the guided tutorial adds.
 *
 * Like {@link WorkbenchMatch}, optional and inert when absent — the tutorial
 * runs over the real workbench rather than a mock-up of it, so what a learner
 * practises on is the thing they will use.
 */
export interface WorkbenchTutorial {
  /** The step card, overlaid on the stage. */
  panel: ReactNode;
  /**
   * The workspace as it stands, on every edit — `undefined` while it does not
   * compile, which is most of the time mid-drag.
   *
   * Reported live rather than on Run so a lesson can notice a block being
   * placed. Compiling on each change is a small tree walk over a program capped
   * at 500 commands.
   */
  onProgramChange: (program: Program | undefined, blockCount: number) => void;
  /** Test was pressed. */
  onTested: () => void;
}

export interface SimulationWorkbenchProps {
  challenge: Challenge;
  engine: SimulationEngine;
  /** Shown in the topbar instead of the offline badge. */
  modeLabel?: string;
  onExit?: () => void;
  match?: WorkbenchMatch;
  tutorial?: WorkbenchTutorial;
  /** Modes certified by the caller for this challenge and product surface. */
  availableProgrammingModes?: readonly ProgrammingMode[];
  initialProgrammingMode?: ProgrammingMode;
}

export function SimulationWorkbench({
  challenge,
  engine,
  modeLabel,
  onExit,
  match,
  tutorial,
  availableProgrammingModes = ['servo'],
  initialProgrammingMode = 'servo',
}: SimulationWorkbenchProps) {
  const editorRef = useRef<BlocklyEditorHandle>(null);
  const plannerRef = useRef(new CutterGridPlannerClient());
  const cutterPlanRef = useRef<
    | {
        workspaceVersion: number;
        compiled: CompiledCutterGridProgramV2;
        plan: CutterTrajectoryPlanV4;
      }
    | undefined
  >(undefined);
  const workspaceVersionRef = useRef(0);
  const snapshot = useSimulationSnapshot(engine);
  const [compileError, setCompileError] = useState<string>();
  const [testing, setTesting] = useState(false);
  const [cutterPlan, setCutterPlan] = useState<CutterTrajectoryPlanV4>();
  const [planningProgress, setPlanningProgress] = useState<
    Omit<CutterGridPlanningProgressV4, 'type' | 'requestId'>
  >();
  const [programmingMode, setProgrammingMode] = useState<ProgrammingMode>(() =>
    availableProgrammingModes.includes(initialProgrammingMode)
      ? initialProgrammingMode
      : (availableProgrammingModes[0] ?? 'servo'),
  );
  const {
    leftPanelOpen,
    rightPanelOpen,
    logOpen,
    showTarget,
    showCutterGrid,
    toggleLeftPanel,
    toggleRightPanel,
    toggleLog,
    toggleTarget,
    toggleCutterGrid,
  } = useWorkbenchStore();
  const cutterProfile =
    programmingMode === 'cutter-grid'
      ? registeredCutterGridProfileV4(challenge)
      : undefined;
  const editorLocked =
    snapshot.status === 'running' ||
    snapshot.status === 'paused' ||
    snapshot.status === 'planning' ||
    snapshot.status === 'positioning';

  useEffect(() => () => plannerRef.current.cancel(), []);

  useEffect(() => {
    cutterPlanRef.current = undefined;
    plannerRef.current.cancel();
    workspaceVersionRef.current = 0;
    const workspace = editorRef.current?.getWorkspace();
    if (!workspace) return;
    const onWorkspaceChange = (event: Blockly.Events.Abstract) => {
      if (event.isUiEvent) return;
      workspaceVersionRef.current += 1;
      cutterPlanRef.current = undefined;
      setCutterPlan(undefined);
      setPlanningProgress(undefined);
      plannerRef.current.cancel();
      if (engine.getSnapshot().status === 'planning') engine.cancelPlanning();
    };
    workspace.addChangeListener(onWorkspaceChange);
    return () => workspace.removeChangeListener(onWorkspaceChange);
  }, [challenge, engine, programmingMode]);

  useEffect(() => {
    editorRef.current?.highlightBlock(snapshot.currentBlockId);
  }, [snapshot.currentBlockId]);

  // Report the workspace to the tutorial on every edit. Subscribing here rather
  // than inside the editor keeps the editor unaware that a tutorial exists.
  const report = tutorial?.onProgramChange;
  useEffect(() => {
    if (!report) {
      return;
    }
    const workspace = editorRef.current?.getWorkspace();
    if (!workspace) {
      return;
    }
    const publish = () => {
      const blockCount = workspace
        .getAllBlocks(false)
        .filter((block) => block.isEnabled() && !block.isShadow()).length;
      try {
        const compilation = editorRef.current?.compile();
        report(
          compilation?.mode === 'servo'
            ? compilation.compiled.program
            : undefined,
          blockCount,
        );
      } catch {
        // Half-built programs do not compile, which is the normal state while
        // somebody is dragging blocks around. Report the block count anyway so
        // a "place a block" step can still notice.
        report(undefined, blockCount);
      }
    };
    publish();
    workspace.addChangeListener(publish);
    return () => workspace.removeChangeListener(publish);
  }, [programmingMode, report]);

  const compile = (): CompiledProgram | undefined => {
    try {
      const result = editorRef.current?.compile();
      if (!result) {
        throw new Error('The Blockly workspace is not ready.');
      }
      if (result.mode === 'cutter-grid') {
        throw new Error(
          'Cutter Grid trajectory planning is not available until its certified planner is loaded.',
        );
      }
      setCompileError(undefined);
      return result.compiled;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Program compilation failed.';
      setCompileError(message);
      if (
        error instanceof ProgramCompilationError ||
        error instanceof CutterGridCompilationError
      ) {
        editorRef.current?.locateError(error);
      }
      return undefined;
    }
  };

  const compileCutterGrid = (): CompiledCutterGridProgramV2 | undefined => {
    try {
      const result = editorRef.current?.compile();
      if (!result || result.mode !== 'cutter-grid') {
        throw new Error('The Cutter Grid workspace is not ready.');
      }
      setCompileError(undefined);
      return compileCutterGridExecutableProgramV2(result.compiled.program);
    } catch (error) {
      setCompileError(
        error instanceof Error ? error.message : 'Cutter Grid compilation failed.',
      );
      if (error instanceof CutterGridCompilationError) {
        editorRef.current?.locateError(error);
      }
      return undefined;
    }
  };

  const frozenCutterPlan = async () => {
    const compiled = compileCutterGrid();
    const profile = registeredCutterGridProfileV4(challenge);
    if (!compiled || !profile) return undefined;
    const workspaceVersion = workspaceVersionRef.current;
    const cached = cutterPlanRef.current;
    if (cached?.workspaceVersion === workspaceVersion) return cached;
    engine.beginPlanning();
    setPlanningProgress(undefined);
    try {
      const plan = await plannerRef.current.planV4(challenge, compiled, profile, setPlanningProgress);
      if (workspaceVersion !== workspaceVersionRef.current) return undefined;
      const frozen = { workspaceVersion, compiled, plan };
      cutterPlanRef.current = frozen;
      setCutterPlan(plan);
      engine.cancelPlanning();
      setPlanningProgress(undefined);
      return frozen;
    } catch (error) {
      engine.cancelPlanning();
      setPlanningProgress(undefined);
      if (
        (
          error instanceof CutterGridPlanningError ||
          error instanceof CutterGridCompactPtpV4PlanningError
        ) &&
        error.code === 'planning-cancelled'
      ) return undefined;
      setCompileError(
        error instanceof Error ? error.message : 'Cutter Grid planning failed.',
      );
      if (
        error instanceof CutterGridCompactPtpV4PlanningError
      ) {
        editorRef.current?.locateError({
          blockId: error.details.sourceBlockId,
        });
      }
      return undefined;
    }
  };

  const handleRun = async () => {
    if (programmingMode === 'cutter-grid') {
      const frozen = await frozenCutterPlan();
      if (frozen) {
        engine.runCutterGrid(
          frozen.plan,
          frozen.compiled.program.sourceBlockCount,
        );
      }
      return;
    }
    const compiled = compile();
    if (compiled) engine.run(compiled);
  };

  const handleTest = async () => {
    if (programmingMode === 'cutter-grid') {
      setTesting(true);
      try {
        const frozen = await frozenCutterPlan();
        if (frozen) {
          await runCutterGridHeadless(
            engine,
            frozen.plan,
            frozen.compiled.program.sourceBlockCount,
          );
          tutorial?.onTested();
        }
      } finally {
        setTesting(false);
      }
      return;
    }
    const compiled = compile();
    if (!compiled) return;
    setTesting(true);
    try {
      await runHeadless(engine, compiled);
      tutorial?.onTested();
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = () => {
    const compiled = compile();
    if (compiled) {
      match?.onSubmit(compiled);
    }
  };

  const handleStep = async () => {
    // Only a paused run continues where it left off. Everything else starts a
    // fresh one and therefore needs the program, including the terminal states
    // — stepping after a completed run used to be a silent no-op, so the only
    // way forward was Reset.
    const resuming = snapshot.status === 'paused';

    if (programmingMode === 'cutter-grid') {
      if (resuming) {
        engine.stepCutterGrid();
        return;
      }
      const frozen = await frozenCutterPlan();
      if (frozen) {
        engine.stepCutterGrid(
          frozen.plan,
          frozen.compiled.program.sourceBlockCount,
        );
      }
      return;
    }

    if (resuming) {
      engine.step();
      return;
    }
    const compiled = compile();
    if (compiled) {
      engine.step(compiled);
    }
  };

  const handleReset = () => {
    setCompileError(undefined);
    editorRef.current?.highlightBlock();
    plannerRef.current.cancel();
    setPlanningProgress(undefined);
    engine.reset();
  };

  const handleProgrammingModeChange = (nextMode: ProgrammingMode) => {
    if (
      nextMode === programmingMode ||
      !availableProgrammingModes.includes(nextMode) ||
      !canSwitchProgrammingMode(snapshot.status)
    ) {
      return;
    }
    setCompileError(undefined);
    engine.reset();
    cutterPlanRef.current = undefined;
    setCutterPlan(undefined);
    plannerRef.current.cancel();
    setPlanningProgress(undefined);
    setProgrammingMode(nextMode);
  };

  const visibleError = compileError ?? snapshot.errorMessage;

  return (
    <main className="workbench">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Braces size={17} />
          </div>
          <div>
            <h1>HCR Simulator</h1>
            <span>HAIRCUT CONTROL RUNTIME</span>
          </div>
        </div>

        <div className="challenge-crumb">
          <span>CHALLENGE</span>
          <ChevronRight size={14} />
          <strong>{challenge.name}</strong>
        </div>

        <div className="topbar-actions">
          <span className={`local-badge ${match ? 'local-badge--live' : ''}`}>
            <i />
            {modeLabel ?? 'LOCAL'}
          </span>
          {onExit ? (
            <button type="button" onClick={onExit} aria-label="Leave and return to the menu">
              <LogOut size={16} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggleLeftPanel}
            aria-label={
              leftPanelOpen
                ? 'Collapse program panel'
                : 'Expand program panel'
            }
            aria-pressed={leftPanelOpen}
          >
            {leftPanelOpen ? (
              <PanelLeftClose size={17} />
            ) : (
              <PanelLeftOpen size={17} />
            )}
          </button>
          <button
            type="button"
            onClick={toggleRightPanel}
            aria-label={
              rightPanelOpen ? 'Collapse status panel' : 'Expand status panel'
            }
            aria-pressed={rightPanelOpen}
          >
            {rightPanelOpen ? (
              <PanelRightClose size={17} />
            ) : (
              <PanelRightOpen size={17} />
            )}
          </button>
        </div>
      </header>

      <section className="stage">
        <SimulatorCanvas
          engine={engine}
          showTarget={showTarget}
          {...(cutterProfile
            ? {
                cutterGrid: {
                  profile: cutterProfile,
                  ...(cutterPlan
                    ? { plan: cutterPlan }
                    : {}),
                  visible: showCutterGrid,
                },
              }
            : {})}
        />

        <aside
          className={`side-panel side-panel--left ${
            leftPanelOpen ? 'is-open' : 'is-closed'
          }`}
          aria-label="Blockly program panel"
        >
          <div className="panel-header">
            <div>
              <span>PROGRAM</span>
              <strong>{PROGRAMMING_MODE_LABEL[programmingMode]} Program</strong>
            </div>
            <button
              type="button"
              onClick={toggleLeftPanel}
              aria-label="Collapse program panel"
            >
              <ChevronLeft size={17} />
            </button>
          </div>
          {availableProgrammingModes.length > 1 ? (
            <div
              className="programming-mode-switch segmented"
              role="group"
              aria-label="Programming mode"
            >
              {availableProgrammingModes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={mode === programmingMode ? 'is-active' : ''}
                  aria-pressed={mode === programmingMode}
                  disabled={!canSwitchProgrammingMode(snapshot.status)}
                  onClick={() => handleProgrammingModeChange(mode)}
                >
                  {PROGRAMMING_MODE_LABEL[mode]}
                </button>
              ))}
            </div>
          ) : null}
          <BlocklyEditor
            ref={editorRef}
            challenge={challenge}
            locked={editorLocked}
            visible={leftPanelOpen}
            programmingMode={programmingMode}
          />
          <div className="panel-footer">
            <span>
              <Cpu size={13} />
              PROGRAM IR
            </span>
            <span>{snapshot.metrics.sourceBlockCount} BLOCKS</span>
          </div>
        </aside>

        <aside
          className={`side-panel side-panel--right ${
            rightPanelOpen ? 'is-open' : 'is-closed'
          }`}
          aria-label="Simulation status panel"
        >
          <div className="panel-header">
            <div>
              <span>INSPECTOR</span>
              <strong>Simulation Status</strong>
            </div>
            <button
              type="button"
              onClick={toggleRightPanel}
              aria-label="Collapse status panel"
            >
              <ChevronRight size={17} />
            </button>
          </div>
          <InspectorPanel
            challenge={challenge}
            snapshot={snapshot}
            showTarget={showTarget}
            onToggleTarget={toggleTarget}
            {...(cutterProfile
              ? {
                  cutterGrid: {
                    profile: cutterProfile,
                    ...(cutterPlan
                      ? { plan: cutterPlan }
                      : {}),
                    visible: showCutterGrid,
                    onToggle: toggleCutterGrid,
                  },
                }
              : {})}
          />
        </aside>

        {!leftPanelOpen ? (
          <button
            className="edge-tab edge-tab--left"
            type="button"
            onClick={toggleLeftPanel}
          >
            <PanelLeftOpen size={15} />
            PROGRAM
          </button>
        ) : null}
        {!rightPanelOpen ? (
          <button
            className="edge-tab edge-tab--right"
            type="button"
            onClick={toggleRightPanel}
          >
            INSPECTOR
            <PanelRightOpen size={15} />
          </button>
        ) : null}

        {match?.hud}
        {tutorial?.panel}

        {visibleError ? (
          <div className="error-banner" role="alert">
            <strong>PROGRAM ERROR</strong>
            <span>{visibleError}</span>
            <button
              type="button"
              onClick={() => setCompileError(undefined)}
              aria-label="Dismiss error message"
            >
              ×
            </button>
          </div>
        ) : null}

        <div className="stage-readout" aria-hidden="true">
          <span>CAMERA / ORBIT</span>
          <strong>
            X {snapshot.endEffector[0].toFixed(2)} · Y{' '}
            {snapshot.endEffector[1].toFixed(2)} · Z{' '}
            {snapshot.endEffector[2].toFixed(2)}
          </strong>
        </div>

        <SimulationControls
          status={snapshot.status}
          onRun={() => void handleRun()}
          onPause={() => engine.pause()}
          onResume={() => engine.resume()}
          onStep={() => void handleStep()}
          onStop={() => engine.stop()}
          onReset={handleReset}
          onTest={() => void handleTest()}
          testing={testing}
          {...(match
            ? {
                submit: {
                  onSubmit: handleSubmit,
                  disabled:
                    programmingMode === 'cutter-grid' || !match.canSubmit,
                  busy: match.submitting,
                  ...(programmingMode === 'cutter-grid'
                    ? { title: 'Backend replay not yet supported' }
                    : {}),
                },
              }
            : {})}
        />
        {/*
          Absent in the web build — `ArmDock` returns null when no Electron
          preload has exposed the bridge, which is every browser tab.
        */}
        {/*
          Shown in both modes. It used to be servo-only, which meant the dock
          silently vanished when you switched to Cutter Grid — the arm looked
          unsupported rather than unable, and there was nowhere to say which.
          It now explains itself: a Cutter Grid trajectory needs a shoulder-roll
          servo this arm does not have, and the dock says so with the measured
          error rather than hiding.
        */}
        <ArmDock
          challenge={challenge}
          mode={programmingMode}
          compile={compile}
          cutterPlan={async () => (await frozenCutterPlan())?.plan}
        />

        {programmingMode === 'cutter-grid' && match ? (
          <>
          <div className="backend-replay-notice" role="status">
            Backend replay not yet supported. Scoring stays in this browser.
          </div>
          {snapshot.status === 'planning' && planningProgress ? (
            <div className="planning-progress" aria-live="polite">
              Planning: {planningProgress.phase.replaceAll('-', ' ')} · {planningProgress.completedActions}/{planningProgress.totalActions} actions{planningProgress.expandedActionIndex === undefined ? '' : ` · expanding action ${planningProgress.expandedActionIndex + 1}`}
            </div>
          ) : null}
          </>
        ) : null}
        <LogDrawer
          logs={snapshot.logs}
          open={logOpen}
          onToggle={toggleLog}
        />

        {match?.overlay}
      </section>
    </main>
  );
}

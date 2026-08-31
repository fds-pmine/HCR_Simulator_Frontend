import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import type { CompiledProgram } from '../../features/blockly/programTypes';
import type { EditorCompilation } from '../../features/blockly/editorCompilation';
import {
  canSwitchProgrammingMode,
  type ProgrammingMode,
} from '../../features/blockly/programmingMode';
import {
  compileCutterGridExecutableProgramV2,
  CutterGridCompilationError,
} from '../../features/cutter-grid/programCompiler';
import {
  CutterGridPlannerProvider,
  CutterGridRemotePlanningError,
  type CutterGridPlannerSource,
} from '../../features/cutter-grid/plannerProvider';
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
import { useLocalization } from '../../features/preferences/localization';
import { DEFAULT_CHALLENGE_ID } from '../../data/challenges/defaultChallenge';
import { LESSONS } from '../../data/challenges/lessons';
import { localizeServoLesson } from '../../features/tutorial/servoLessonLocalization';

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
  onProgramChange: (
    compilation: EditorCompilation | undefined,
    blockCount: number,
  ) => void;
  /** Test was pressed. */
  onTested: () => void;
  /** Step was pressed and a step was actually issued to the engine. */
  onStepped?: () => void;
  /** The Grid and planned-path overlay was shown or hidden. */
  onGridOverlayChange?: (visible: boolean) => void;
  /**
   * When defined, changing this key clears Blockly and resets the simulation.
   * Lesson assessments use it when the learner enters a closed-book quiz.
   */
  clearWorkspaceKey?: string;
  /**
   * A serialized program to put on the canvas when `clearWorkspaceKey` changes,
   * instead of leaving it empty. Sections that ask the learner to change or
   * repair a route need that route to be there.
   */
  starterWorkspace?: Record<string, unknown>;
  /** Active Blockly language, used by tutorials that teach mode switching. */
  onProgrammingModeChange?: (mode: ProgrammingMode) => void;
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
  /** Remote planning is opt-in; lessons and offline workbenches stay local. */
  cutterGridPlannerMode?: 'local' | 'remote';
  /** Pinned catalog version sent to the remote planner. */
  challengeVersion?: number;
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
  cutterGridPlannerMode = 'local',
  challengeVersion = 1,
}: SimulationWorkbenchProps) {
  const { locale, t } = useLocalization();
  const editorRef = useRef<BlocklyEditorHandle>(null);
  const planner = useMemo(
    () =>
      new CutterGridPlannerProvider({
        offline: cutterGridPlannerMode === 'local',
        challengeVersion,
      }),
    [challengeVersion, cutterGridPlannerMode],
  );
  const cutterPlanRef = useRef<
    | {
        workspaceVersion: number;
        compiled: CompiledCutterGridProgramV2;
        plan: CutterTrajectoryPlanV4;
        source: CutterGridPlannerSource;
      }
    | undefined
  >(undefined);
  const workspaceVersionRef = useRef(0);
  const snapshot = useSimulationSnapshot(engine);
  const [compileError, setCompileError] = useState<string>();
  const [testing, setTesting] = useState(false);
  const [cutterPlan, setCutterPlan] = useState<CutterTrajectoryPlanV4>();
  const [cutterPlanChallengeSignature, setCutterPlanChallengeSignature] = useState<string>();
  const [cutterPlannerSource, setCutterPlannerSource] = useState<CutterGridPlannerSource>();
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
  const displayedCutterPlan = cutterPlanChallengeSignature === cutterProfile?.challengeSignature
    ? cutterPlan
    : undefined;
  const editorLocked =
    snapshot.status === 'running' ||
    snapshot.status === 'paused' ||
    snapshot.status === 'planning' ||
    snapshot.status === 'positioning';

  useEffect(() => () => planner.cancel(), [planner]);

  useEffect(() => {
    cutterPlanRef.current = undefined;
    planner.cancel();
    workspaceVersionRef.current = 0;
    const workspace = editorRef.current?.getWorkspace();
    if (!workspace) return;
    const onWorkspaceChange = (event: Blockly.Events.Abstract) => {
      if (event.isUiEvent) return;
      setCompileError(undefined);
      workspaceVersionRef.current += 1;
      cutterPlanRef.current = undefined;
      setCutterPlan(undefined);
      setCutterPlanChallengeSignature(undefined);
      setCutterPlannerSource(undefined);
      setPlanningProgress(undefined);
      planner.cancel();
      if (engine.getSnapshot().status === 'planning') engine.cancelPlanning();
    };
    workspace.addChangeListener(onWorkspaceChange);
    return () => workspace.removeChangeListener(onWorkspaceChange);
  }, [challenge, engine, locale, planner, programmingMode]);

  useEffect(() => {
    editorRef.current?.highlightBlock(snapshot.currentBlockId);
  }, [snapshot.currentBlockId]);

  const clearWorkspaceKey = tutorial?.clearWorkspaceKey;
  const starterWorkspace = tutorial?.starterWorkspace;
  useEffect(() => {
    if (clearWorkspaceKey === undefined) return;
    editorRef.current?.clear();
    if (starterWorkspace) editorRef.current?.load(starterWorkspace);
    editorRef.current?.highlightBlock();
    planner.cancel();
    engine.reset();
    // `starterWorkspace` is deliberately not a dependency: the key is what
    // says "this is a new exercise". Reacting to the object as well would
    // reseed the canvas under a learner who had started editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearWorkspaceKey, engine, planner]);

  // Report the workspace to the tutorial on every edit. Subscribing here rather
  // than inside the editor keeps the editor unaware that a tutorial exists.
  const report = tutorial?.onProgramChange;
  const reportProgrammingMode = tutorial?.onProgrammingModeChange;
  // Sections that ask the learner to read the overlay are satisfied by the
  // overlay, so its state is reported the same way the workspace is.
  const reportGridOverlay = tutorial?.onGridOverlayChange;
  useEffect(() => {
    reportGridOverlay?.(showCutterGrid);
  }, [reportGridOverlay, showCutterGrid]);
  useEffect(() => {
    reportProgrammingMode?.(programmingMode);
  }, [programmingMode, reportProgrammingMode]);

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
        report(compilation, blockCount);
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
  }, [challenge, locale, programmingMode, report]);

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
      const result = await planner.planV4(challenge, compiled, profile, setPlanningProgress);
      if (workspaceVersion !== workspaceVersionRef.current) return undefined;
      const frozen = { workspaceVersion, compiled, plan: result.plan, source: result.source };
      cutterPlanRef.current = frozen;
      setCutterPlan(result.plan);
      setCutterPlanChallengeSignature(profile.challengeSignature);
      setCutterPlannerSource(result.source);
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
      if (error instanceof CutterGridRemotePlanningError) {
        editorRef.current?.locateError({ blockId: error.sourceBlockId });
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

    // A step the engine declines — one pressed mid-motion, say — is not
    // evidence that the learner stepped, so the tutorial hears about it only
    // when a step actually starts.
    if (programmingMode === 'cutter-grid') {
      if (resuming) {
        if (engine.stepCutterGrid()) tutorial?.onStepped?.();
        return;
      }
      const frozen = await frozenCutterPlan();
      if (frozen) {
        const stepped = engine.stepCutterGrid(
          frozen.plan,
          frozen.compiled.program.sourceBlockCount,
        );
        if (stepped) tutorial?.onStepped?.();
      }
      return;
    }

    if (resuming) {
      if (engine.step()) tutorial?.onStepped?.();
      return;
    }
    const compiled = compile();
    if (compiled && engine.step(compiled)) {
      tutorial?.onStepped?.();
    }
  };

  const handleReset = () => {
    setCompileError(undefined);
    editorRef.current?.highlightBlock();
    planner.cancel();
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
    setCutterPlanChallengeSignature(undefined);
    setCutterPlannerSource(undefined);
    planner.cancel();
    setPlanningProgress(undefined);
    setProgrammingMode(nextMode);
  };

  const visibleError = compileError ?? snapshot.errorMessage;
  const displayLesson = LESSONS.find(({ id }) => id === challenge.id);
  const challengeName = challenge.id === DEFAULT_CHALLENGE_ID
    ? t('defaultChallengeName')
    : displayLesson
      ? localizeServoLesson(displayLesson, locale).name
      : challenge.name;

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
          <span>{t('challenge')}</span>
          <ChevronRight size={14} />
          <strong>{challengeName}</strong>
        </div>

        <div className="topbar-actions">
          <span className={`local-badge ${match ? 'local-badge--live' : ''}`}>
            <i />
            {modeLabel ?? t('local')}
          </span>
          {onExit ? (
            <button type="button" onClick={onExit} aria-label={t('backToMenu')}>
              <LogOut size={16} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggleLeftPanel}
            aria-label={
              leftPanelOpen
                ? t('collapseProgram')
                : t('expandProgram')
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
              rightPanelOpen ? t('collapseInspector') : t('expandInspector')
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
                  ...(displayedCutterPlan
                    ? { plan: displayedCutterPlan }
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
          aria-label={t('programPanel')}
        >
          <div className="panel-header">
            <div>
              <span>{t('program')}</span>
              <strong>{t(programmingMode === 'servo' ? 'servoAnglesProgram' : 'cutterGridProgram')}</strong>
            </div>
            <button
              type="button"
              onClick={toggleLeftPanel}
              aria-label={t('collapseProgram')}
            >
              <ChevronLeft size={17} />
            </button>
          </div>
          {availableProgrammingModes.length > 1 ? (
            <div
              className="programming-mode-switch segmented"
              role="group"
              aria-label={t('programmingMode')}
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
                  {t(mode === 'servo' ? 'servoAnglesMode' : 'cutterGridMode')}
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
              {t('programIr')}
            </span>
            <span>{snapshot.metrics.sourceBlockCount} {t('blocks')}</span>
          </div>
        </aside>

        <aside
          className={`side-panel side-panel--right ${
            rightPanelOpen ? 'is-open' : 'is-closed'
          }`}
          aria-label={t('simulationStatus')}
        >
          <div className="panel-header">
            <div>
              <span>{t('inspector')}</span>
              <strong>{t('simulationStatus')}</strong>
            </div>
            <button
              type="button"
              onClick={toggleRightPanel}
              aria-label={t('collapseInspector')}
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
                    ...(displayedCutterPlan
                      ? { plan: displayedCutterPlan }
                      : {}),
                    ...(cutterPlannerSource
                      ? { plannerSource: cutterPlannerSource }
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
            {t('program')}
          </button>
        ) : null}
        {!rightPanelOpen ? (
          <button
            className="edge-tab edge-tab--right"
            type="button"
            onClick={toggleRightPanel}
          >
            {t('inspector')}
            <PanelRightOpen size={15} />
          </button>
        ) : null}

        {match?.hud}
        {tutorial?.panel}

        {visibleError ? (
          <div className="error-banner" role="alert">
            <strong>{t('programError')}</strong>
            <span>{visibleError}</span>
            <button
              type="button"
              onClick={() => setCompileError(undefined)}
              aria-label={t('dismissError')}
            >
              ×
            </button>
          </div>
        ) : null}

        <div className="stage-readout" aria-hidden="true">
          <span>{t('cameraOrbit')}</span>
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
                    ? { title: t('backendReplayUnsupported') }
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

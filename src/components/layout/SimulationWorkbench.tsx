import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import {
  isScalpProgram,
  type ExecutableProgram,
} from '../../features/simulation/executableProgram';
import {
  type ScalpProgram,
} from '../../features/scalp-path';
import { SimulatorCanvas } from '../../features/simulation/SimulatorCanvas';
import type { SimulationEngine } from '../../features/simulation/SimulationEngine';
import { runHeadless } from '../../features/simulation/headlessRun';
import { useSimulationSnapshot } from '../../features/simulation/useSimulationSnapshot';
import { useWorkbenchStore } from '../../features/simulation/simulationStore';
import { SimulationControls } from '../controls/SimulationControls';
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
  onSubmit: (compiled: ExecutableProgram) => void;
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
  onProgramChange: (program: ScalpProgram | undefined, blockCount: number) => void;
  /** Test was pressed. */
  onTested: () => void;
}

interface SimulationWorkbenchProps {
  challenge: Challenge;
  engine: SimulationEngine;
  /** Shown in the topbar instead of the offline badge. */
  modeLabel?: string;
  onExit?: () => void;
  match?: WorkbenchMatch;
  tutorial?: WorkbenchTutorial;
}

export function SimulationWorkbench({
  challenge,
  engine,
  modeLabel,
  onExit,
  match,
  tutorial,
}: SimulationWorkbenchProps) {
  const editorRef = useRef<BlocklyEditorHandle>(null);
  const snapshot = useSimulationSnapshot(engine);
  const [compileError, setCompileError] = useState<string>();
  const [testing, setTesting] = useState(false);
  const {
    leftPanelOpen,
    rightPanelOpen,
    logOpen,
    showTarget,
    toggleLeftPanel,
    toggleRightPanel,
    toggleLog,
    toggleTarget,
  } = useWorkbenchStore();
  const editorLocked =
    snapshot.status === 'running' || snapshot.status === 'paused';

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
        const compiled = editorRef.current?.compile();
        report(
          compiled && isScalpProgram(compiled)
            ? compiled.scalpProgram
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
  }, [report]);

  const compile = (): ExecutableProgram | undefined => {
    try {
      const result = editorRef.current?.compile();
      if (!result) {
        throw new Error('The Blockly workspace is not ready.');
      }
      setCompileError(undefined);
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Program compilation failed.';
      setCompileError(message);
      if (error instanceof ProgramCompilationError) {
        editorRef.current?.locateError(error);
      }
      return undefined;
    }
  };

  const handleRun = () => {
    const compiled = compile();
    if (compiled) {
      engine.run(compiled);
    }
  };

  const handleTest = async () => {
    const compiled = compile();
    if (!compiled) {
      return;
    }
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

  const handleStep = () => {
    if (snapshot.status === 'idle') {
      const compiled = compile();
      if (compiled) {
        engine.step(compiled);
      }
      return;
    }
    engine.step();
  };

  const handleReset = () => {
    setCompileError(undefined);
    editorRef.current?.highlightBlock();
    engine.reset();
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
        <SimulatorCanvas engine={engine} showTarget={showTarget} />

        <aside
          className={`side-panel side-panel--left ${
            leftPanelOpen ? 'is-open' : 'is-closed'
          }`}
          aria-label="Blockly program panel"
        >
          <div className="panel-header">
            <div>
              <span>PROGRAM</span>
              <strong>Scalp Path Program</strong>
            </div>
            <button
              type="button"
              onClick={toggleLeftPanel}
              aria-label="Collapse program panel"
            >
              <ChevronLeft size={17} />
            </button>
          </div>
          <BlocklyEditor
            ref={editorRef}
            challenge={challenge}
            locked={editorLocked}
            visible={leftPanelOpen}
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
          onRun={handleRun}
          onPause={() => engine.pause()}
          onResume={() => engine.resume()}
          onStep={handleStep}
          onStop={() => engine.stop()}
          onReset={handleReset}
          onTest={() => void handleTest()}
          testing={testing}
          {...(match
            ? {
                submit: {
                  onSubmit: handleSubmit,
                  disabled: !match.canSubmit,
                  busy: match.submitting,
                },
              }
            : {})}
        />
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

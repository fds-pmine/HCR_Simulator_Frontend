import { useEffect, useRef, useState } from 'react';
import {
  Braces,
  ChevronLeft,
  ChevronRight,
  Cpu,
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
import { SimulatorCanvas } from '../../features/simulation/SimulatorCanvas';
import type { SimulationEngine } from '../../features/simulation/SimulationEngine';
import { useSimulationSnapshot } from '../../features/simulation/useSimulationSnapshot';
import { useWorkbenchStore } from '../../features/simulation/simulationStore';
import { SimulationControls } from '../controls/SimulationControls';
import { InspectorPanel } from '../inspector/InspectorPanel';
import { LogDrawer } from './LogDrawer';

interface SimulationWorkbenchProps {
  challenge: Challenge;
  engine: SimulationEngine;
}

export function SimulationWorkbench({
  challenge,
  engine,
}: SimulationWorkbenchProps) {
  const editorRef = useRef<BlocklyEditorHandle>(null);
  const snapshot = useSimulationSnapshot(engine);
  const [compileError, setCompileError] = useState<string>();
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

  const compile = (): CompiledProgram | undefined => {
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
          <span className="local-badge">
            <i />
            LOCAL
          </span>
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
              <strong>Servo Control Program</strong>
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
        />
        <LogDrawer
          logs={snapshot.logs}
          open={logOpen}
          onToggle={toggleLog}
        />
      </section>
    </main>
  );
}

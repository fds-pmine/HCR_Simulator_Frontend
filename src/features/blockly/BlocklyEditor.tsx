import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import * as Blockly from 'blockly/core';
import type { Challenge } from '../../types/domain';
import { createToolbox, registerHcrBlocks } from './blockDefinitions';
import {
  compileWorkspace,
  type ProgramCompilationError,
} from './programCompiler';
import { loadWorkspaceState, saveWorkspaceState } from './workspaceFactory';
import type { ProgrammingMode } from './programmingMode';
import {
  compileScalpWorkspace,
  createScalpTurtleToolbox,
  registerScalpTurtleBlocks,
} from '../scalp-path';
import type { ExecutableProgram } from '../simulation/executableProgram';

export interface BlocklyEditorHandle {
  compile: () => ExecutableProgram;
  highlightBlock: (blockId?: string) => void;
  locateError: (error: ProgramCompilationError) => void;
  clear: () => void;
  getWorkspace: () => Blockly.WorkspaceSvg | undefined;
}

interface BlocklyEditorProps {
  challenge: Challenge;
  programmingMode: ProgrammingMode;
  locked: boolean;
  visible: boolean;
}

export const BlocklyEditor = forwardRef<
  BlocklyEditorHandle,
  BlocklyEditorProps
>(function BlocklyEditor({ challenge, programmingMode, locked, visible }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | undefined>(undefined);
  const workspaceStatesRef = useRef<Record<string, Record<string, unknown>>>({});

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const workspaceStates = workspaceStatesRef.current;

    registerHcrBlocks(challenge.robotConfig.joints);
    registerScalpTurtleBlocks();
    const workspace = Blockly.inject(container, {
      toolbox:
        programmingMode === 'scalp-path'
          ? createScalpTurtleToolbox()
          : createToolbox(challenge),
      renderer: 'zelos',
      theme: Blockly.Themes.Zelos,
      trashcan: true,
      sounds: false,
      grid: {
        spacing: 24,
        length: 3,
        colour: '#28404e',
        snap: true,
      },
      zoom: {
        controls: true,
        wheel: true,
        startScale: 0.86,
        maxScale: 1.3,
        minScale: 0.55,
        scaleSpeed: 1.1,
      },
      move: {
        scrollbars: true,
        drag: true,
        wheel: true,
      },
    });
    workspaceRef.current = workspace;
    const stateKey = `${challenge.id}:${programmingMode}`;
    const savedState = workspaceStates[stateKey];
    // Servo mode preserves the challenge's existing starting workspace. The
    // opt-in path language begins blank, and switching modes keeps each canvas
    // in memory so choosing a new language never destroys the other program.
    loadWorkspaceState(
      workspace,
      savedState ?? (programmingMode === 'servo' ? challenge.starterWorkspace : {}),
    );
    Blockly.svgResize(workspace);

    // A seam for the end-to-end tests, and only for them.
    //
    // Competitive workbenches open blank (`withBlankCanvas`), so a browser test has no
    // program to drive unless it makes one. Four tests cover what happens *when
    // a program runs* — head collision, scoring, pause/step/resume, stop — and
    // authoring is incidental to all four, so they seed the workspace through
    // here rather than dragging blocks out of the flyout.
    //
    // That drag path is genuinely untested, and it is the only way a learner
    // now builds anything. This hook does not cover it and is not meant to.
    //
    // Dev-only: `import.meta.env.DEV` is statically replaced, so the whole
    // block is dropped from a production bundle rather than shipping a way to
    // rewrite a competitor's workspace mid-round.
    if (import.meta.env.DEV) {
      Object.assign(window, {
        __hcrSeedWorkspace: (state: Record<string, unknown>) => {
          loadWorkspaceState(workspace, state);
        },
      });
    }

    const resizeObserver = new ResizeObserver(() => {
      Blockly.svgResize(workspace);
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (import.meta.env.DEV) {
        delete (window as { __hcrSeedWorkspace?: unknown }).__hcrSeedWorkspace;
      }
      workspaceStates[stateKey] = saveWorkspaceState(workspace);
      workspace.dispose();
      workspaceRef.current = undefined;
    };
  }, [challenge, programmingMode]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) {
      return;
    }

    workspace.getAllBlocks(false).forEach((block) => {
      block.setEditable(!locked);
      block.setMovable(!locked);
      block.setDeletable(!locked);
    });
    if (locked && containerRef.current?.contains(document.activeElement)) {
      (document.activeElement as HTMLElement | null)?.blur();
    }
  }, [locked]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (workspace && visible) {
      requestAnimationFrame(() => Blockly.svgResize(workspace));
    }
  }, [visible]);

  useImperativeHandle(
    ref,
    () => ({
      compile() {
        const workspace = workspaceRef.current;
        if (!workspace) {
          throw new Error('The Blockly workspace is not ready.');
        }
        return programmingMode === 'scalp-path'
          ? compileScalpWorkspace(workspace, challenge)
          : compileWorkspace(workspace, challenge);
      },
      highlightBlock(blockId) {
        workspaceRef.current?.highlightBlock(blockId ?? null);
      },
      locateError(error) {
        const workspace = workspaceRef.current;
        if (!workspace || !error.blockId) {
          return;
        }
        workspace.highlightBlock(error.blockId);
        workspace.centerOnBlock(error.blockId);
        workspace.getBlockById(error.blockId)?.select();
      },
      clear() {
        workspaceRef.current?.clear();
      },
      getWorkspace() {
        return workspaceRef.current;
      },
    }),
    [challenge, programmingMode],
  );

  return (
    <div
      className="blockly-editor"
      data-testid="blockly-editor"
      data-programming-mode={programmingMode}
      aria-label="Blockly program editor"
      aria-disabled={locked}
    >
      <div ref={containerRef} className="blockly-editor__surface" />
      {locked ? (
        <div className="blockly-editor__lock" aria-live="polite">
          <span>PROGRAM LOCKED</span>
          Editing is locked while the program is running
        </div>
      ) : null}
    </div>
  );
});

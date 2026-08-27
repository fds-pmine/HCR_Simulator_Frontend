import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import * as Blockly from 'blockly/core';
import type { Challenge } from '../../types/domain';
import { compileCutterGridWorkspace } from '../cutter-grid/programCompiler';
import type { EditorCompilation } from './editorCompilation';
import {
  compileWorkspace,
} from './programCompiler';
import type { ProgrammingMode } from './programmingMode';
import {
  initialWorkspaceState,
  loadWorkspaceState,
  registerBlocksForMode,
  saveWorkspaceState,
  toolboxForMode,
} from './workspaceFactory';
import { programmingWorkspaceMemory } from './workspaceMemory';
import { useLocalization } from '../preferences/localization';

export interface BlocklyEditorHandle {
  compile: () => EditorCompilation;
  highlightBlock: (blockId?: string) => void;
  locateError: (error: { blockId?: string }) => void;
  clear: () => void;
  getWorkspace: () => Blockly.WorkspaceSvg | undefined;
}

interface BlocklyEditorProps {
  challenge: Challenge;
  locked: boolean;
  visible: boolean;
  programmingMode: ProgrammingMode;
}

export const BlocklyEditor = forwardRef<
  BlocklyEditorHandle,
  BlocklyEditorProps
>(function BlocklyEditor(
  { challenge, locked, visible, programmingMode },
  ref,
) {
  const { locale, t } = useLocalization();
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | undefined>(undefined);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    registerBlocksForMode(challenge, programmingMode, locale);
    const workspace = Blockly.inject(container, {
      toolbox: toolboxForMode(challenge, programmingMode, locale),
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
    loadWorkspaceState(
      workspace,
      programmingWorkspaceMemory.load(challenge, programmingMode) ??
        initialWorkspaceState(challenge, programmingMode),
    );
    Blockly.svgResize(workspace);

    // A seam for the end-to-end tests, and only for them.
    //
    // Every mode opens blank now (`withBlankCanvas`), so a browser test has no
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
      programmingWorkspaceMemory.save(
        challenge,
        programmingMode,
        saveWorkspaceState(workspace),
      );
      if (import.meta.env.DEV) {
        delete (window as { __hcrSeedWorkspace?: unknown }).__hcrSeedWorkspace;
      }
      workspace.dispose();
      workspaceRef.current = undefined;
    };
  }, [challenge, locale, programmingMode]);

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
        return programmingMode === 'servo'
          ? { mode: 'servo', compiled: compileWorkspace(workspace, challenge) }
          : {
              mode: 'cutter-grid',
              compiled: compileCutterGridWorkspace(workspace),
            };
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
      aria-label={t('programPanel')}
      aria-disabled={locked}
    >
      <div ref={containerRef} className="blockly-editor__surface" />
      {locked ? (
        <div className="blockly-editor__lock" aria-live="polite">
          <span>{t('programLocked')}</span>
          {t('programLockedBody')}
        </div>
      ) : null}
    </div>
  );
});

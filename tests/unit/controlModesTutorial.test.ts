import { describe, expect, it } from 'vitest';
import type { EditorCompilation } from '../../src/features/blockly/editorCompilation';
import { CONTROL_MODES_TUTORIAL_STEPS } from '../../src/features/tutorial/controlModesTutorial';

const gridCompilation: EditorCompilation = {
  mode: 'cutter-grid',
  compiled: {
    program: {
      kind: 'cutter-grid',
      version: 1,
      plannerVersion: 'test',
      sourceBlockCount: 1,
      nodes: [{
        type: 'move',
        direction: 'left',
        distance: 1,
        sourceBlockId: 'grid-move',
      }],
    },
    runtimeActions: [{
      type: 'move-cell',
      direction: 'left',
      sourceBlockId: 'grid-move',
    }],
    executedCommandCount: 1,
  },
};

const servoCompilation: EditorCompilation = {
  mode: 'servo',
  compiled: {
    program: {
      sourceBlockCount: 1,
      nodes: [{
        type: 'set-joint-angle',
        jointId: 'baseYaw',
        angleDeg: 90,
        sourceBlockId: 'servo-angle',
      }],
    },
    runtimeCommands: [{
      type: 'set-joint-angle',
      jointId: 'baseYaw',
      angleDeg: 90,
      sourceBlockId: 'servo-angle',
    }],
    executedCommandCount: 1,
  },
};

const step = (id: string) => {
  const found = CONTROL_MODES_TUTORIAL_STEPS.find((entry) => entry.id === id);
  if (!found) throw new Error(`Missing control-modes step "${id}".`);
  return found;
};

describe('Grid to Servo Angles tutorial', () => {
  it('has a unique nine-step progression with an informational finish', () => {
    expect(CONTROL_MODES_TUTORIAL_STEPS).toHaveLength(9);
    expect(new Set(CONTROL_MODES_TUTORIAL_STEPS.map((entry) => entry.id)).size).toBe(9);
    expect(CONTROL_MODES_TUTORIAL_STEPS.at(-1)?.done).toBeUndefined();
  });

  it('recognizes Grid intent, Servo switching, and a Servo command', () => {
    expect(step('bridge-grid-command').done?.({ programmingMode: 'cutter-grid' })).toBe(false);
    expect(step('bridge-grid-command').done?.({ programmingMode: 'cutter-grid', compilation: gridCompilation })).toBe(true);
    expect(step('bridge-switch-servo').done?.({ programmingMode: 'servo' })).toBe(true);
    expect(step('bridge-servo-command').done?.({ programmingMode: 'servo', compilation: servoCompilation })).toBe(true);
  });

  it('requires the original Grid program after switching back', () => {
    expect(step('bridge-return-grid').done?.({ programmingMode: 'cutter-grid' })).toBe(false);
    expect(step('bridge-return-grid').done?.({ programmingMode: 'servo', compilation: gridCompilation })).toBe(false);
    expect(step('bridge-return-grid').done?.({ programmingMode: 'cutter-grid', compilation: gridCompilation })).toBe(true);
  });
});

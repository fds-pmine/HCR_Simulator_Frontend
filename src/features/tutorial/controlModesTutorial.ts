import type { EditorCompilation } from '../blockly/editorCompilation';
import type { ProgrammingMode } from '../blockly/programmingMode';
import type { Lesson } from './lessons';

export interface ControlModesTutorialContext {
  compilation?: EditorCompilation;
  programmingMode: ProgrammingMode;
}

export interface ControlModesTutorialStep extends Omit<Lesson, 'done'> {
  done?: (context: ControlModesTutorialContext) => boolean;
}

export const CONTROL_MODES_TUTORIAL_STEPS: readonly ControlModesTutorialStep[] = [
  {
    id: 'bridge-welcome',
    title: 'One arm, two levels of control',
    body:
      'Cutter Grid describes where the cutter should go. Servo Angles describes ' +
      'the joint destinations that move it. This tour lets you use both on the same Challenge.',
  },
  {
    id: 'bridge-grid-command',
    title: 'Start with spatial intent',
    body:
      'In Cutter Grid, add any Move block. You choose a fixed world direction ' +
      'and distance; the planner chooses synchronized joint motion.',
    hint: 'Open Cutter Grid and drag “Move left”. Distance 1 is enough for this comparison.',
    done: ({ compilation }) =>
      compilation?.mode === 'cutter-grid' &&
      compilation.compiled.program.nodes.some((node) => node.type === 'move'),
  },
  {
    id: 'bridge-grid-ui',
    title: 'See what Grid gives you',
    body:
      'The Inspector shows world axes, logical coordinates, safe IK knowledge, ' +
      'and the planned path. Grid owns spatial intent; the planner owns the joint solution.',
  },
  {
    id: 'bridge-switch-servo',
    title: 'Switch to Servo Angles',
    body:
      'Use the mode switch above Blockly and choose Servo Angles. Switching is ' +
      'allowed only while idle and resets the simulation, not the saved Grid workspace.',
    hint: 'The two mode buttons sit directly under the PROGRAM header.',
    done: ({ programmingMode }) => programmingMode === 'servo',
  },
  {
    id: 'bridge-servo-command',
    title: 'Now command a joint destination',
    body:
      'Add one “Set … to …°” block. In Servo mode you choose the joint and its ' +
      'absolute destination; there is no runtime IK planner between the block and the joint.',
    hint: 'Open Servo, drag a Set block, and leave any valid joint angle selected.',
    done: ({ compilation }) =>
      compilation?.mode === 'servo' &&
      compilation.compiled.program.nodes.some(
        (node) => node.type === 'set-joint-angle',
      ),
  },
  {
    id: 'bridge-home-angle',
    title: 'Home is 90°; telemetry is live',
    body:
      'A new hardware-backed Servo block initializes to the firmware Home value ' +
      'of 90°. Electron also homes X, Y, Z, B, and E to 90° before a run and ' +
      'shows the arm’s reported values in the ARM panel. The Inspector does not ' +
      'repeat five fixed 90° values: its X/Y/Z/B cells follow the rendered arm ' +
      'live, while E stays parked at 90° until cutter actuation is modelled.',
  },
  {
    id: 'bridge-telemetry',
    title: 'Use telemetry to connect both views',
    body:
      'Servo telemetry uses the same X/Y/Z/B names and absolute degrees that ' +
      'Electron sends to the arm. Grid ' +
      'coordinates show the cutter’s spatial destination. Together they explain ' +
      'what the planner solved and what the hardware would receive. On entry ' +
      'and after Reset, all five hardware axes read 90°.',
  },
  {
    id: 'bridge-return-grid',
    title: 'Prove the workspaces stay separate',
    body:
      'Switch back to Cutter Grid. Your Move block should still be there: each ' +
      'language keeps an independent workspace for this Challenge.',
    done: ({ programmingMode, compilation }) =>
      programmingMode === 'cutter-grid' &&
      compilation?.mode === 'cutter-grid' &&
      compilation.compiled.program.nodes.some((node) => node.type === 'move'),
  },
  {
    id: 'bridge-done',
    title: 'Choose the right level for the job',
    body:
      'Use Grid to teach and author cutter paths. Use Servo Angles to study ' +
      'joint behavior or drive compatible hardware commands. Safety limits and ' +
      'the shared all-90° Home pose remain authoritative in both views.',
  },
];

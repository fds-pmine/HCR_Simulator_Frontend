/**
 * The guided tutorial.
 *
 * Lessons are declarative: a title, what to do, and a predicate over the live
 * program and the engine's state. The tutorial never simulates anything of its
 * own and never mocks the workbench — a step is complete when the *real* engine
 * says so, so nothing here can drift away from how the app actually behaves.
 *
 * # What it teaches, and why these things
 *
 * Two rules account for almost every "it's broken" report, and neither is
 * discoverable by poking at the editor:
 *
 * 1. **Angles are absolute.** `Repeat 5 × [Set X · Base Yaw to 120°]` moves the
 *    arm once and then drives a joint to where it already is, four times. It
 *    looks exactly like a broken Repeat block, and it costs efficiency for
 *    nothing.
 * 2. **The head stops the arm.** A move through the head halts at the last safe
 *    pose and scores whatever it had managed. Better to meet that deliberately,
 *    in a step that expects it, than to hit it by accident and read it as a bug.
 *
 * # The angles are servo degrees
 *
 * Every angle here is what the servo is commanded to, exactly as the block
 * fields and the joint limits express it: every joint homes at 90°, and
 * `baseYaw` travels 30–150° on the shipped challenge. Sweeping it to 120°
 * removes four voxels and 145° removes all eleven, which is what makes the
 * repeat step visible.
 *
 * From Home, *no* `baseYaw` value reaches the head — the joint's whole travel is
 * clear of it — so the collision step commands the elbow instead. That is what
 * the values below are measured against, and why the tutorial pins itself to
 * the shipped challenge rather than whatever the catalog serves.
 */
import type { Program, ProgramNode } from '../blockly/programTypes';
import type { SimulationSnapshot } from '../simulation/SimulationEngine';

/** Everything a lesson may inspect. */
export interface TutorialContext {
  /** The workspace as it stands, or `undefined` while it does not compile. */
  program?: Program;
  /** Blocks on the canvas, including ones not yet connected. */
  blockCount: number;
  /** Live engine state — status, score, remaining voxels. */
  snapshot: SimulationSnapshot;
  /** How many times Test has been pressed this session. */
  testCount: number;
}

export interface Lesson {
  id: string;
  title: string;
  /** What the learner should do. */
  body: string;
  /** Shown after they have been on the step a while. */
  hint?: string;
  /**
   * Whether the step is satisfied. Absent means "informational" — the learner
   * moves on with Next.
   */
  done?: (context: TutorialContext) => boolean;
}

/** The joint the tutorial drives. Its travel is what the safe angles assume. */
export const TUTORIAL_JOINT = 'baseYaw';

/** The first angle taught: a short sweep off Home that removes four voxels. */
export const TUTORIAL_ANGLE_DEG = 120;

/** The second angle in the repeat, far enough past the first to cut more. */
export const TUTORIAL_SWEEP_ANGLE_DEG = 145;

/**
 * The joint and angle the collision step commands.
 *
 * The elbow, not `baseYaw`: with the base swept off Home the elbow can be
 * driven down into the head, whereas `baseYaw` alone never can.
 */
export const TUTORIAL_HEAD_JOINT = 'elbow';
export const TUTORIAL_HEAD_ANGLE_DEG = 60;

export const LESSONS: readonly Lesson[] = [
  {
    id: 'welcome',
    title: 'The arm cuts, you write the program',
    body:
      'The orange blocks are hair. The faint outline is the target haircut. ' +
      'You cannot move the arm by hand — you write a program, and the tool ' +
      'removes whatever hair it sweeps through.',
  },
  {
    id: 'first-block',
    title: 'Add your first command',
    body:
      'Open the Servo category on the left and drag a "Set … to …°" block onto ' +
      'the canvas.',
    hint: 'The category list is the narrow strip down the left of the program panel.',
    done: (context) => targetsOf(context.program, TUTORIAL_JOINT).length > 0,
  },
  {
    id: 'absolute',
    title: 'Angles are absolute, not relative',
    body:
      `Set the block to X · Base Yaw and ${TUTORIAL_ANGLE_DEG}°. That means ` +
      `"drive this joint to ${TUTORIAL_ANGLE_DEG}°", not "turn it ` +
      `${TUTORIAL_ANGLE_DEG}° further". Every command in this language works ` +
      'that way, and every angle is a servo degree: the same number the real ' +
      'arm is commanded to, with Home at 90°.',
    hint:
      'Pick X · Base Yaw in the dropdown, then click the number and type ' +
      `${TUTORIAL_ANGLE_DEG}.`,
    done: (context) =>
      targetsOf(context.program, TUTORIAL_JOINT).includes(TUTORIAL_ANGLE_DEG),
  },
  {
    id: 'test',
    title: 'Test runs it instantly',
    body:
      'Press Test. It evaluates the program in milliseconds instead of animating ' +
      'it in real time — so how fast you can try ideas does not depend on how ' +
      'fast your machine draws. Run is for watching.',
    done: (context) => context.testCount > 0 && context.snapshot.scoreResult !== undefined,
  },
  {
    id: 'head',
    title: 'The head stops the arm',
    body:
      'Base Yaw on its own always clears the head. Add a second block below the ' +
      `first — Z · Elbow to ${TUTORIAL_HEAD_ANGLE_DEG}° — and press Test. The ` +
      'elbow will not get there: the arm stops at the last safe pose and tells ' +
      'you which block was to blame. This is meant to happen — delete the Elbow ' +
      'block when you have seen it.',
    hint: 'Look for the red banner naming the joint and where it stopped.',
    done: (context) =>
      context.snapshot.status === 'error' &&
      (context.snapshot.errorMessage ?? '').toLowerCase().includes('head'),
  },
  {
    id: 'repeat-noop',
    title: 'Repeat, and why it looks broken',
    body:
      'From Control, drag a Repeat block in and put your Base Yaw block inside ' +
      'it. Press Test. Nothing changes — the score is identical. The first ' +
      `iteration drives the joint to ${TUTORIAL_ANGLE_DEG}°; the rest drive it ` +
      'to where it already is.',
    hint: 'Drop the Set block into the "Do" slot inside the Repeat block.',
    done: (context) => hasRepeat(context.program),
  },
  {
    id: 'repeat-sweep',
    title: 'Make the repeat actually sweep',
    body:
      'Add a second Set block inside the Repeat, below the first, and give it a ' +
      `different angle — ${TUTORIAL_SWEEP_ANGLE_DEG}° works. Now each iteration ` +
      'moves the tool back and forth across the hair instead of parking it. ' +
      'Press Test and watch the score climb.',
    hint:
      `Two blocks inside Do: X · Base Yaw ${TUTORIAL_ANGLE_DEG}°, then ` +
      `X · Base Yaw ${TUTORIAL_SWEEP_ANGLE_DEG}°.`,
    done: (context) => repeatSweeps(context.program, TUTORIAL_JOINT),
  },
  {
    id: 'done',
    title: 'That is the whole language',
    body:
      'Absolute angles, Wait, and Repeat. Everything else is deciding where to ' +
      'cut and in what order. Try Solo Practice for the full challenge, or a ' +
      'Versus round against other people.',
  },
];

/** Flatten repeat bodies so a command inside one is still visible. */
function flatten(nodes: readonly ProgramNode[]): ProgramNode[] {
  return nodes.flatMap((node) =>
    node.type === 'repeat' ? flatten(node.body) : [node],
  );
}

/** Every angle the program drives `jointId` to, in order. */
function targetsOf(program: Program | undefined, jointId: string): number[] {
  if (!program) return [];
  return flatten(program.nodes)
    .filter((node) => node.type === 'set-joint-angle' && node.jointId === jointId)
    .map((node) => (node as { angleDeg: number }).angleDeg);
}

/**
 * Whether the program contains a repeat anywhere.
 *
 * A top-level scan is complete: `repeat` is the only node that nests, so a
 * nested one always has an ancestor at the top level.
 */
function hasRepeat(program: Program | undefined): boolean {
  return program?.nodes.some((node) => node.type === 'repeat') ?? false;
}

/**
 * Whether a repeat body drives `jointId` to more than one angle.
 *
 * This is exactly the condition under which repeating does anything at all:
 * with absolute commands, a body that only ever writes one value per joint
 * leaves the arm where the first iteration put it.
 */
function repeatSweeps(program: Program | undefined, jointId: string): boolean {
  if (!program) return false;
  const check = (nodes: readonly ProgramNode[]): boolean =>
    nodes.some((node) => {
      if (node.type !== 'repeat') return false;
      const distinct = new Set(
        flatten(node.body)
          .filter((inner) => inner.type === 'set-joint-angle' && inner.jointId === jointId)
          .map((inner) => (inner as { angleDeg: number }).angleDeg),
      );
      return distinct.size > 1 || check(node.body);
    });
  return check(program.nodes);
}

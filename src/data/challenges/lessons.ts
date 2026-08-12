import { defaultChallengeDefinition } from './defaultChallenge';
import type { ChallengeDefinition } from '../../types/domain';

/**
 * The eight teaching challenges.
 *
 * # Every target is measured, never drawn
 *
 * A lesson is defined by its **starting pose** and the **program that solves
 * it**. The target is then whatever that program actually leaves behind, so
 * every lesson is achievable at exactly 100 by construction.
 *
 * That is not a stylistic preference. The shipped challenge was authored the
 * other way — a target drawn by hand — and asked for 26 voxels of which the arm
 * could reach 4. Nobody could beat the score for doing nothing, and the example
 * program scored below it. Deriving the target from a program that demonstrably
 * runs makes that failure impossible to reproduce.
 *
 * # Every lesson is minimal
 *
 * `lessons.test.ts` checks that no *strictly shorter* program reaches 100 on any
 * lesson. A step that can be deleted teaches nothing, and four of the first
 * eight candidates were thrown out for exactly that: at a given working height a
 * single sweep already removes everything within reach, so "sweep again" and
 * "sweep back" were padding.
 *
 * # Why the difficulty is where it is
 *
 * The arm can only ever touch 50 of the 241 hair voxels, and no single program
 * removes more than 12. So difficulty cannot come from asking for more hair. It
 * comes from which joint the learner has to work out, whether the head is in the
 * way, and — in the last two — whether they cut too much.
 */
export interface LessonStep {
  jointId: string;
  angleDeg: number;
}

export interface Lesson {
  id: string;
  name: string;
  /** Shown as the challenge description. */
  description: string;
  /** How to solve it, in words. Progressive: later lessons say less. */
  goal: string;
  /** Joint angles the arm starts at. This is most of what sets the difficulty. */
  startPose: Readonly<Record<string, number>>;
  /** The program the target is derived from — the lesson's existence proof. */
  solution: readonly LessonStep[];
}

const step = (jointId: string, angleDeg: number): LessonStep => ({ jointId, angleDeg });

export const LESSONS: readonly Lesson[] = [
  {
    id: 'lesson-1-first-cut',
    name: '1 · First Cut',
    description: 'The arm is already in position. One command finishes the job.',
    goal:
      'Drag in one "Set … to …°" block, choose Base Yaw, and set it to 135°. ' +
      'The arm is already at the right height — all it needs is to swing across.',
    startPose: { baseYaw: 35, shoulder: 120, elbow: 162.5, wrist: 10 },
    solution: [step('baseYaw', 135)],
  },
  {
    id: 'lesson-2-clear-the-head',
    name: '2 · Mind the Head',
    description:
      'The arm starts low, in front of the head. Swinging straight across will not work.',
    goal:
      'Swing across from here and the arm stops dead against the head. Lift it ' +
      'clear first: Shoulder 120°, Elbow 162.5°, Wrist 10°, and only then Base Yaw 135°.',
    startPose: { baseYaw: 45, shoulder: 95, elbow: 72.5, wrist: 125 },
    solution: [
      step('shoulder', 120),
      step('elbow', 162.5),
      step('wrist', 10),
      step('baseYaw', 135),
    ],
  },
  {
    id: 'lesson-3-shoulder',
    name: '3 · Reach Higher',
    description: 'The tool passes underneath the hair. Something has to lift it.',
    goal:
      'Base Yaw alone sweeps through empty air. Raise the Shoulder to 120° first, ' +
      'then sweep to 135°.',
    startPose: { baseYaw: 35, shoulder: 70, elbow: 162.5, wrist: 10 },
    solution: [step('shoulder', 120), step('baseYaw', 135)],
  },
  {
    id: 'lesson-4-elbow',
    name: '4 · Straighten the Arm',
    description: 'The shoulder is right, but the arm is folded up.',
    goal:
      'The Shoulder is already at 120°; the Elbow is what is folding the tool away. ' +
      'Open it to 162.5°, then sweep Base Yaw to 135°.',
    startPose: { baseYaw: 35, shoulder: 120, elbow: 62.5, wrist: 10 },
    solution: [step('elbow', 162.5), step('baseYaw', 135)],
  },
  {
    id: 'lesson-5-wrist',
    name: '5 · Angle the Tool',
    description: 'Everything is in place except the angle of the tool itself.',
    goal:
      'Shoulder and Elbow are set. The Wrist is pointing the tool away from the ' +
      'hair — bring it to 70°, then sweep Base Yaw to 145°.',
    startPose: { baseYaw: 35, shoulder: 140, elbow: 112.5, wrist: 150 },
    solution: [step('wrist', 70), step('baseYaw', 145)],
  },
  {
    id: 'lesson-6-stop-short',
    name: '6 · Do Not Overcut',
    description:
      'Only part of this crown should come off. Sweeping the whole way costs you.',
    goal:
      'A full sweep to 135° would take hair that is meant to stay — worth about ' +
      '98 out of 100. Stop at 80° instead and take only what the target asks for.',
    startPose: { baseYaw: 35, shoulder: 120, elbow: 162.5, wrist: 10 },
    solution: [step('baseYaw', 80)],
  },
  {
    id: 'lesson-7-narrow-band',
    name: '7 · Precision',
    description: 'A narrow band, and a wide sweep is nearly right but not right.',
    goal:
      'Sweeping all the way to 145° scores about 99.6 — close enough to look ' +
      'correct and still wrong. Find the angle that stops exactly at the edge of ' +
      'the band.',
    startPose: { baseYaw: 35, shoulder: 140, elbow: 112.5, wrist: 70 },
    solution: [step('baseYaw', 90)],
  },
  {
    id: 'lesson-8-full-cut',
    name: '8 · The Whole Crown',
    description:
      'Everything you have learned, and one patch that a single pass cannot reach.',
    goal:
      'Twelve voxels, and no single sweep gets them all: one sits at a different ' +
      'height. Set up, sweep both ways, change height, and sweep again.',
    startPose: { baseYaw: 45, shoulder: 95, elbow: 72.5, wrist: 125 },
    solution: [
      step('shoulder', 140),
      step('elbow', 112.5),
      step('wrist', 70),
      step('baseYaw', 145),
      step('baseYaw', 35),
      step('shoulder', 120),
      step('elbow', 152.5),
      step('baseYaw', 145),
    ],
  },
];

/**
 * The lesson's challenge, minus its target.
 *
 * The target cannot be written here because it is derived by *running* the
 * solution, which needs the engine — see `buildLessonChallenge` in
 * `services/local/lessonChallenges.ts`. Splitting it this way keeps the data
 * file free of a dependency on the simulator.
 */
export function lessonBase(lesson: Lesson): ChallengeDefinition {
  return {
    ...defaultChallengeDefinition,
    id: lesson.id,
    name: lesson.name,
    description: lesson.description,
    robotConfig: {
      ...defaultChallengeDefinition.robotConfig,
      joints: defaultChallengeDefinition.robotConfig.joints.map((joint) => ({
        ...joint,
        initialAngleDeg: lesson.startPose[joint.id] ?? joint.initialAngleDeg,
      })),
    },
    // Lessons open on an empty canvas: the whole point is writing the program.
    starterWorkspace: {},
  };
}

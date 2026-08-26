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
  /** Twenty-step learning sequence; the final section is the scored checkpoint. */
  sections: readonly ServoLessonSection[];
}

export interface ServoLessonSection {
  id: string;
  title: string;
  body: string;
  activity: 'read' | 'predict' | 'build' | 'observe' | 'challenge' | 'recap';
}

interface LessonSeed extends Omit<Lesson, 'sections'> {
  concepts: readonly [string, string, string, string];
  activities: readonly [string, string, string, string];
}

const step = (jointId: string, angleDeg: number): LessonStep => ({ jointId, angleDeg });

const LESSON_SEEDS: readonly LessonSeed[] = [
  {
    id: 'lesson-1-first-cut',
    name: '1 · First Cut',
    description: 'The arm is already in position. One command finishes the job.',
    goal:
      'Drag in one "Set … to …°" block, choose Base Yaw, and set it to 135°. ' +
      'The arm is already at the right height — all it needs is to swing across.',
    startPose: { baseYaw: 35, shoulder: 120, elbow: 162.5, wrist: 10 },
    solution: [step('baseYaw', 135)],
    concepts: [
      'Servo angles are absolute destinations: 135° means go to 135°, not turn another 135°.',
      'Base Yaw rotates the whole arm around the head and creates the cutting sweep in this lesson.',
      'The supplied start pose is already clear of the head, so no setup joint needs to move first.',
      'Adding unnecessary setup blocks makes the program longer without improving the target cut.',
    ],
    activities: [
      'Predict the direction of travel from the starting Base Yaw before running.',
      'Change only Base Yaw and watch which telemetry row moves.',
      'Debug a block that controls the wrong joint.',
      'Solve the target with exactly one enabled source block.',
    ],
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
    concepts: [
      'A safe sweep depends on the complete pose, not only the final Base Yaw angle.',
      'Shoulder, Elbow, and Wrist first lift and orient the cutter; Base Yaw performs the final sweep.',
      'Head collision stops at the last safe pose and does not award a formal score.',
      'Moving Base Yaw first is unsafe because the setup commands have not yet created clearance.',
    ],
    activities: [
      'Predict which link approaches the head if Base Yaw runs first.',
      'Build the three setup commands before adding the sweep.',
      'Debug the program by locating the first collision-producing block.',
      'Reach 100 while preserving the safe command order.',
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
    concepts: [
      'Shoulder changes the working height of the arm before the horizontal sweep.',
      'Base Yaw cannot cut hair that the tool passes underneath, regardless of sweep width.',
      'Changing one setup joint at a time makes cause and effect visible in telemetry.',
      'A wider Base Yaw sweep is not a substitute for correcting the tool height.',
    ],
    activities: [
      'Predict the cutter height before and after changing Shoulder.',
      'Use Step to separate the lift from the sweep.',
      'Debug a program that sweeps correctly but remains below the hair.',
      'Solve with one Shoulder setup block followed by one Base Yaw block.',
    ],
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
    concepts: [
      'Elbow changes how folded or extended the arm is at the current shoulder angle.',
      'The correct Shoulder angle cannot compensate for an Elbow that keeps the cutter folded away.',
      'Joint limits are expressed in servo degrees and are enforced by the Blockly angle field.',
      'Changing both Shoulder and Elbow hides which joint actually caused the reach problem.',
    ],
    activities: [
      'Predict how straightening Elbow changes the end-effector position.',
      'Step the Elbow command and inspect telemetry before sweeping.',
      'Debug a solution that unnecessarily changes Shoulder.',
      'Reach 100 with only the required reach correction and sweep.',
    ],
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
    concepts: [
      'Wrist controls the final tool orientation after Shoulder and Elbow establish the reach.',
      'A reachable hand position can still miss the hair when the cutter points the wrong way.',
      'Tool orientation affects the swept cutter volume and therefore which voxels are removed.',
      'Changing Base Yaw alone cannot repair a Wrist orientation error.',
    ],
    activities: [
      'Predict how the tool direction changes when Wrist moves toward the target value.',
      'Step Wrist first and observe the tool before adding the sweep.',
      'Debug a route whose reach is correct but whose tool points away.',
      'Use one orientation command and one sweep to reach 100.',
    ],
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
    concepts: [
      'Precision includes stopping at the target boundary, not merely touching every target voxel.',
      'A longer Base Yaw sweep removes a superset of the hair removed by a shorter sweep.',
      'Completion scoring compares the final hair set with the target and penalizes unwanted removal.',
      'Nearly 100 is evidence of an overcut here, not permission to accept the wider sweep.',
    ],
    activities: [
      'Predict which side of the target a full sweep removes unnecessarily.',
      'Reduce only the Base Yaw endpoint and compare successive Test scores.',
      'Debug a score near 98 by checking the stopping angle rather than the setup pose.',
      'Find the exact one-block stopping angle that scores 100.',
    ],
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
    concepts: [
      'A narrow target band makes small angle errors visible in the final voxel set.',
      'The correct endpoint is found by controlling the absolute Base Yaw stop angle.',
      'A score around 99.6 can still represent one boundary mismatch and is not solved.',
      'Adding more blocks does not improve precision when one exact endpoint defines the cut.',
    ],
    activities: [
      'Predict whether the current attempt stops before or after the target edge.',
      'Change the endpoint in small steps and compare the score direction.',
      'Debug a nearly perfect attempt by inspecting the target outline.',
      'Reach exactly 100 with one Base Yaw block.',
    ],
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
    concepts: [
      'A complete crown cut can require multiple working heights and sweeps in both directions.',
      'Each absolute Base Yaw command starts from the pose left by the previous command.',
      'Changing height between sweeps reaches the patch that the first working plane misses.',
      'Reordering setup, sweep, height change, and final sweep can collide or change the cut.',
    ],
    activities: [
      'Divide the solution into initial setup, first sweep pair, height change, and final sweep.',
      'Use Step to inspect the pose at every transition between those phases.',
      'Debug a program that gets most voxels but misses the second-height patch.',
      'Build the full minimal program and verify all twelve target removals.',
    ],
  },
];

const SERVO_SECTION_COUNT = 20;

function formatPose(pose: Readonly<Record<string, number>>): string {
  return Object.entries(pose)
    .map(([joint, angle]) => `${joint} ${angle}°`)
    .join(' · ');
}

function buildServoSections(seed: LessonSeed): ServoLessonSection[] {
  const jointNames = [...new Set(seed.solution.map((entry) => entry.jointId))].join(', ');
  const entries: Array<Omit<ServoLessonSection, 'id'>> = [
    { title: 'Why this matters', body: seed.description, activity: 'read' },
    { title: 'Lesson outcome', body: seed.goal, activity: 'read' },
    { title: 'Absolute angles', body: seed.concepts[0], activity: 'read' },
    { title: 'Joint responsibility', body: seed.concepts[1], activity: 'read' },
    { title: 'Safety and scoring', body: seed.concepts[2], activity: 'read' },
    { title: 'Common mistake', body: seed.concepts[3], activity: 'predict' },
    { title: 'Read the start pose', body: formatPose(seed.startPose), activity: 'read' },
    { title: 'Inspect telemetry', body: 'Find every starting angle in the Inspector and identify which values already match the intended setup.', activity: 'observe' },
    { title: 'Identify the active joints', body: `This lesson can be solved by reasoning about: ${jointNames}. Explain the role of each before adding blocks.`, activity: 'predict' },
    { title: 'Predict the motion', body: seed.activities[0], activity: 'predict' },
    { title: 'Build a first attempt', body: 'Create the smallest program you think can reach the target. Keep all commands in the intended execution order.', activity: 'build' },
    { title: 'Use Step', body: seed.activities[1], activity: 'observe' },
    { title: 'Use Test', body: 'Press Test and compare completion, the target outline, and any collision message with your prediction.', activity: 'observe' },
    { title: 'Change one variable', body: 'Reset and change only one joint angle or one command position so the score difference has a clear cause.', activity: 'challenge' },
    { title: 'Read the evidence', body: 'Use joint telemetry, executed block highlighting, and the event log to explain what the program actually did.', activity: 'observe' },
    { title: 'Debugging drill', body: seed.activities[2], activity: 'challenge' },
    { title: 'Independent challenge', body: seed.activities[3], activity: 'challenge' },
    { title: 'Explain it back', body: `Explain why this rule matters here: ${seed.concepts[1]}`, activity: 'recap' },
    { title: 'Prepare the checkpoint', body: 'Reset to the lesson start, clear accidental extra blocks, and build your final answer without running it yet.', activity: 'recap' },
    { title: 'Scored checkpoint', body: 'Press Test. Reach 100 completion to finish this lesson and unlock the next one. Use “Show me” only if you are stuck.', activity: 'recap' },
  ];
  if (entries.length < SERVO_SECTION_COUNT) {
    throw new Error(`Servo lesson "${seed.id}" requires at least ${SERVO_SECTION_COUNT} sections.`);
  }
  return entries.map((section, index) => ({
    ...section,
    id: `${seed.id}-section-${index + 1}`,
  }));
}

export const LESSONS: readonly Lesson[] = LESSON_SEEDS.map((seed) => ({
  id: seed.id,
  name: seed.name,
  description: seed.description,
  goal: seed.goal,
  startPose: seed.startPose,
  solution: seed.solution,
  sections: buildServoSections(seed),
}));

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

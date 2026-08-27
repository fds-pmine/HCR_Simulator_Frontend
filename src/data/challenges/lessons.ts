import { defaultChallengeDefinition } from './defaultChallenge';
import type { ChallengeDefinition } from '../../types/domain';
import { servoJointLabel } from '../../features/robot/servoMapping';
import {
  buildConceptQuestion,
  type LessonAssessments,
} from '../../features/tutorial/lessonAssessments';

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
 * The arm can only touch part of the 241 hair voxels, and the calibrated Home
 * sweep removes at most 11. So difficulty cannot come from asking for more hair. It
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
  assessments: LessonAssessments;
  /** Twenty-step learning sequence; the final section is the scored checkpoint. */
  sections: readonly ServoLessonSection[];
}

export interface ServoLessonSection {
  id: string;
  title: string;
  body: string;
  activity: 'read' | 'predict' | 'build' | 'observe' | 'challenge' | 'recap';
}

interface LessonSeed extends Omit<Lesson, 'sections' | 'assessments'> {
  concepts: readonly [string, string, string, string];
  activities: readonly [string, string, string, string];
}

const step = (jointId: string, angleDeg: number): LessonStep => ({ jointId, angleDeg });

const LESSON_SEEDS: readonly LessonSeed[] = [
  {
    id: 'lesson-1-first-cut',
    name: '1 · First Cut',
    description: 'Every motor starts at 90°. One X-axis command makes the first cut.',
    goal:
      'Confirm X, Y, Z, B, and E all show 90°, then set X · Base Yaw to 120°.',
    startPose: { baseYaw: 90, shoulder: 90, elbow: 90, wrist: 90 },
    solution: [step('baseYaw', 120)],
    concepts: [
      'Servo angles are absolute destinations: 120° means move X to 120°, not add 120°.',
      'X · Base Yaw rotates the complete arm around the head.',
      'The calibrated all-90° Home pose is clear of the head and ready for this short sweep.',
      'Sending 90° again produces no movement because X is already at 90°.',
    ],
    activities: [
      'Predict the direction of travel from X = 90° to X = 120°.',
      'Run one block and watch only the live X cell change.',
      'Debug a block that controls the wrong joint.',
      'Solve the target with exactly one enabled source block.',
    ],
  },
  {
    id: 'lesson-2-clear-the-head',
    name: '2 · Sweep Further',
    description: 'Start from the same all-90° Home and extend the X sweep by ten degrees.',
    goal:
      'Set X · Base Yaw to 130°. Compare the seven removed voxels with Lesson 1.',
    startPose: { baseYaw: 90, shoulder: 90, elbow: 90, wrist: 90 },
    solution: [step('baseYaw', 130)],
    concepts: [
      'A larger absolute X destination lengthens the sweep from the same 90° start.',
      'The X axis changes horizontal reach without changing Y, Z, or B.',
      'The target preview shows the additional boundary reached by the longer sweep.',
      'Changing several motors would hide the single cause of the extra cut.',
    ],
    activities: [
      'Predict which side gains voxels between 120° and 130°.',
      'Step the X command and read its live tenth-degree value.',
      'Debug an attempt that accidentally stops at the previous lesson’s 120°.',
      'Reach 100 using one X command.',
    ],
  },
  {
    id: 'lesson-3-shoulder',
    name: '3 · Ten-Voxel Sweep',
    description: 'A five-degree change reaches a complete ten-voxel band.',
    goal: 'Keep Y, Z, and B at Home 90°. Set X · Base Yaw to 135°.',
    startPose: { baseYaw: 90, shoulder: 90, elbow: 90, wrist: 90 },
    solution: [step('baseYaw', 135)],
    concepts: [
      'Small servo changes can cross several voxel boundaries during a continuous sweep.',
      'Y · Shoulder remains at 90°; Home is an actual command value, not a hidden pose.',
      'Target voxels are measured from the simulated cutter path.',
      'Stopping at 130° leaves part of this target standing.',
    ],
    activities: [
      'Predict the extra boundary crossed after 130°.',
      'Use Step and compare X telemetry with the end-effector coordinate.',
      'Debug a program that copied the previous endpoint.',
      'Solve with one exact absolute destination.',
    ],
  },
  {
    id: 'lesson-4-elbow',
    name: '4 · Find the Edge',
    description: 'One final boundary voxel sits beyond the ten-voxel band.',
    goal: 'Set X · Base Yaw to 145° without changing the other 90° motors.',
    startPose: { baseYaw: 90, shoulder: 90, elbow: 90, wrist: 90 },
    solution: [step('baseYaw', 145)],
    concepts: [
      'A target edge is defined by the swept cutter volume, not by a rounded camera view.',
      'X telemetry is the authoritative servo destination for this lesson.',
      'Joint limits and head collision checks still apply throughout the move.',
      'Stopping before the edge leaves one requested voxel standing.',
    ],
    activities: [
      'Predict whether 140° reaches the last voxel.',
      'Step X and inspect the target outline near the sweep boundary.',
      'Debug a solution that stops five degrees early.',
      'Reach 100 without changing Y, Z, or B.',
    ],
  },
  {
    id: 'lesson-5-wrist',
    name: '5 · Elbow Band',
    description: 'Use Z · Elbow to select a lower three-voxel band before sweeping.',
    goal:
      'Set Z · Elbow to 95°, then set X · Base Yaw to 135°.',
    startPose: { baseYaw: 90, shoulder: 90, elbow: 90, wrist: 90 },
    solution: [step('elbow', 95), step('baseYaw', 135)],
    concepts: [
      'Z · Elbow changes the cutter’s working band while X provides the sweep.',
      'A five-degree Z adjustment selects three lower voxels instead of the Home band.',
      'The Z move must complete before X starts so the whole sweep uses one band.',
      'Leaving Z at 90° overcuts this narrow target.',
    ],
    activities: [
      'Predict how Z = 95° changes the end-effector height.',
      'Step Z first and confirm X is still 90°.',
      'Debug a program whose two commands are reversed.',
      'Use exactly one Z setup and one X sweep.',
    ],
  },
  {
    id: 'lesson-6-stop-short',
    name: '6 · Wrist Band',
    description: 'Use B · Wrist to select the upper three-voxel band.',
    goal:
      'Set B · Wrist to 105°, then sweep X · Base Yaw to 135°.',
    startPose: { baseYaw: 90, shoulder: 90, elbow: 90, wrist: 90 },
    solution: [step('wrist', 105), step('baseYaw', 135)],
    concepts: [
      'B · Wrist changes tool orientation without changing the elbow joint.',
      'The selected orientation moves the cutter onto a different three-voxel band.',
      'Completion penalizes the ten-voxel Home sweep as an overcut.',
      'Using Z instead of B reaches the other band and misses this target.',
    ],
    activities: [
      'Predict the tool orientation at B = 105°.',
      'Step B and watch the live B cell before sweeping X.',
      'Debug a solution that changes Z instead of B.',
      'Reach only the upper band with two commands.',
    ],
  },
  {
    id: 'lesson-7-narrow-band',
    name: '7 · Stop the Lower Band',
    description: 'The lower band is narrow; the X endpoint decides whether two or three voxels come off.',
    goal:
      'Set Z · Elbow to 95°, then stop X · Base Yaw at 130°.',
    startPose: { baseYaw: 90, shoulder: 90, elbow: 90, wrist: 90 },
    solution: [step('elbow', 95), step('baseYaw', 130)],
    concepts: [
      'The same Z band can contain different targets at different X endpoints.',
      'Stopping at 130° removes two lower-band voxels.',
      'Continuing to 135° removes one extra voxel and is therefore an overcut.',
      'Both setup and endpoint must be correct for a precision score.',
    ],
    activities: [
      'Predict which lower-band edge remains at 130°.',
      'Compare Test scores for X = 130° and X = 135°.',
      'Debug the one-voxel overcut using target preview.',
      'Reach exactly two lower-band voxels.',
    ],
  },
  {
    id: 'lesson-8-full-cut',
    name: '8 · Two Working Bands',
    description: 'Combine the lower Z band and upper B band from one all-90° Home.',
    goal:
      'Cut the lower band with Z = 95° and X = 135°. Return X and Z to 90°, ' +
      'set B = 105°, then sweep X to 135° again.',
    startPose: { baseYaw: 90, shoulder: 90, elbow: 90, wrist: 90 },
    solution: [
      step('elbow', 95),
      step('baseYaw', 135),
      step('baseYaw', 90),
      step('elbow', 90),
      step('wrist', 105),
      step('baseYaw', 135),
    ],
    concepts: [
      'Multiple working bands require explicit transitions between absolute servo states.',
      'Returning X to 90° creates the start position for the second sweep.',
      'Returning Z to 90° prevents the second B setup from inheriting the lower band.',
      'Skipping or reordering a reset changes the path and the cut.',
    ],
    activities: [
      'Divide the program into lower sweep, Home transition, and upper sweep.',
      'Use Step to confirm every commanded 90° reset.',
      'Debug a program that reaches only one of the two three-voxel bands.',
      'Build the complete six-command program and verify all six target removals.',
    ],
  },
];

const SERVO_SECTION_COUNT = 20;

function formatPose(pose: Readonly<Record<string, number>>): string {
  return Object.entries(pose)
    .map(([jointId, angle]) => {
      const joint = defaultChallengeDefinition.robotConfig.joints.find(
        (candidate) => candidate.id === jointId,
      );
      return `${joint ? servoJointLabel(joint) : jointId} ${angle}°`;
    })
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
    { title: 'Scored checkpoint', body: 'Build your own final program and press Test. Reach 100 completion to finish this lesson and unlock the next one.', activity: 'recap' },
  ];
  if (entries.length < SERVO_SECTION_COUNT) {
    throw new Error(`Servo lesson "${seed.id}" requires at least ${SERVO_SECTION_COUNT} sections.`);
  }
  return entries.map((section, index) => ({
    ...section,
    id: `${seed.id}-section-${index + 1}`,
  }));
}

export const LESSONS: readonly Lesson[] = LESSON_SEEDS.map((seed, index) => ({
  id: seed.id,
  name: seed.name,
  description: seed.description,
  goal: seed.goal,
  startPose: seed.startPose,
  solution: seed.solution,
  assessments: {
    multipleChoice: buildConceptQuestion(
      seed.name,
      seed.concepts[0],
      (index % 3) as 0 | 1 | 2,
      [
        'Every servo command adds an offset to the current angle rather than setting an absolute target.',
        'Changing several joints at once always makes the cause of a score change easier to identify.',
      ],
    ),
    practicalPrompt: 'Build your own Blockly program, press Test, and reach 100 completion.',
  },
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

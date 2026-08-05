import { defaultChallengeDefinition } from './defaultChallenge';
import type { ChallengeDefinition } from '../../types/domain';

/** The original absolute-angle Servo lesson track. */
export interface LessonStep {
  jointId: string;
  angleDeg: number;
}

export interface Lesson {
  id: string;
  name: string;
  description: string;
  goal: string;
  startPose: Readonly<Record<string, number>>;
  solution: readonly LessonStep[];
}

const step = (jointId: string, angleDeg: number): LessonStep => ({ jointId, angleDeg });

export const LESSONS: readonly Lesson[] = [
  {
    id: 'lesson-1-first-cut',
    name: '1 · First Cut',
    description: 'The arm is already in position. One command finishes the job.',
    goal: 'Drag Set to, choose Base Yaw, and set it to 45°. The arm is already at the right height.',
    startPose: { baseYaw: -55, shoulder: 70, elbow: 10, wrist: -80 },
    solution: [step('baseYaw', 45)],
  },
  {
    id: 'lesson-2-clear-the-head',
    name: '2 · Mind the Head',
    description: 'The arm starts low, in front of the head. Swinging straight across will not work.',
    goal: 'Lift clear first: Shoulder 70°, Elbow 10°, Wrist −80°, and only then Base Yaw 45°.',
    startPose: { baseYaw: -45, shoulder: 45, elbow: -80, wrist: 35 },
    solution: [step('shoulder', 70), step('elbow', 10), step('wrist', -80), step('baseYaw', 45)],
  },
  {
    id: 'lesson-3-shoulder',
    name: '3 · Reach Higher',
    description: 'The tool passes underneath the hair. Something has to lift it.',
    goal: 'Raise the Shoulder to 70° first, then sweep Base Yaw to 45°.',
    startPose: { baseYaw: -55, shoulder: 20, elbow: 10, wrist: -80 },
    solution: [step('shoulder', 70), step('baseYaw', 45)],
  },
  {
    id: 'lesson-4-elbow',
    name: '4 · Straighten the Arm',
    description: 'The shoulder is right, but the arm is folded up.',
    goal: 'Open the Elbow to 10°, then sweep Base Yaw to 45°.',
    startPose: { baseYaw: -55, shoulder: 70, elbow: -90, wrist: -80 },
    solution: [step('elbow', 10), step('baseYaw', 45)],
  },
  {
    id: 'lesson-5-wrist',
    name: '5 · Angle the Tool',
    description: 'Everything is in place except the angle of the tool itself.',
    goal: 'Bring the Wrist to −20°, then sweep Base Yaw to 55°.',
    startPose: { baseYaw: -55, shoulder: 90, elbow: -40, wrist: 60 },
    solution: [step('wrist', -20), step('baseYaw', 55)],
  },
  {
    id: 'lesson-6-stop-short',
    name: '6 · Do Not Overcut',
    description: 'Only part of this crown should come off. Sweeping the whole way costs you.',
    goal: 'Stop at −10° instead of making the full wide sweep.',
    startPose: { baseYaw: -55, shoulder: 70, elbow: 10, wrist: -80 },
    solution: [step('baseYaw', -10)],
  },
  {
    id: 'lesson-7-narrow-band',
    name: '7 · Precision',
    description: 'A narrow band, and a wide sweep is nearly right but not right.',
    goal: 'Find the Base Yaw angle that stops exactly at the band edge.',
    startPose: { baseYaw: -55, shoulder: 90, elbow: -40, wrist: -20 },
    solution: [step('baseYaw', 0)],
  },
  {
    id: 'lesson-8-full-cut',
    name: '8 · The Whole Crown',
    description: 'Everything you have learned, and one patch that a single pass cannot reach.',
    goal: 'Set up, sweep both ways, change height, and sweep again.',
    startPose: { baseYaw: -45, shoulder: 45, elbow: -80, wrist: 35 },
    solution: [
      step('shoulder', 90), step('elbow', -40), step('wrist', -20), step('baseYaw', 55),
      step('baseYaw', -55), step('shoulder', 70), step('elbow', 0), step('baseYaw', 55),
    ],
  },
];

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
    starterWorkspace: {},
  };
}

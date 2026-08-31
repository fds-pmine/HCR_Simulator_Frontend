import {
  buildConceptQuestion,
  type LessonAssessments,
  type LessonSectionRequirement,
} from './lessonAssessments';

export interface CutterGridLesson {
  id: string;
  name: string;
  description: string;
  goal: string;
  example: string;
  assessments: LessonAssessments;
  sections: readonly CutterGridLessonSection[];
}

export interface CutterGridLessonSection {
  id: string;
  title: string;
  body: string;
  activity: 'read' | 'predict' | 'build' | 'observe' | 'challenge' | 'recap';
  /**
   * The control this section teaches, when the activity alone would name the
   * wrong one. "Use Step" asks for Step; every other observe section asks for
   * a completed Test.
   */
  requirement?: LessonSectionRequirement;
  /** A route put on the canvas when the section opens, for it to work on. */
  starter?: string;
  /** The route the workspace must hold for this section to be satisfied. */
  expected?: string;
}

/**
 * A workspace exercise: the route the learner is given, and the route they are
 * asked to turn it into.
 *
 * A challenge that says "swap Right for Left" or "debug a route whose Forward
 * and Backward blocks were exchanged" has no work in it on an empty canvas —
 * there is nothing to swap or repair — so those sections gave the learner
 * nothing to do but press Test. `expected` is omitted where the section asks
 * for a prediction rather than an edit; the route is still placed so there is
 * something concrete to predict about.
 */
export interface CutterGridDrill {
  starter?: string;
  expected?: string;
  requirement?: LessonSectionRequirement;
  /** The starter deliberately ends on a coordinate the arm cannot reach. */
  unreachableStarter?: true;
}

interface CutterGridLessonSeed extends Omit<CutterGridLesson, 'sections' | 'assessments'> {
  concepts: readonly [string, string, string, string];
  activities: readonly [string, string, string, string];
  /** The two workspace exercises: activities[0] and activities[2]. */
  drills: { variation: CutterGridDrill; debug: CutterGridDrill };
}

const CUTTER_GRID_LESSON_SEEDS: readonly CutterGridLessonSeed[] = [
  {
    id: 'cutter-grid-fixed-axes',
    name: 'Grid 1 · Fixed World Axes',
    description: 'Learn the six directions around the fixed world coordinate frame.',
    goal: 'Use Right (+X), Up (+Y), and Forward (−Z). The axes never rotate with the arm.',
    example: 'Right 1 → Up 1 → Forward 1',
    concepts: [
      'Right/Left change world X, Up/Down change world Y, and Forward/Backward change world Z.',
      'The grid belongs to the world, so turning the arm or camera never rotates a direction.',
      'Every Move endpoint must be inside the certified grid and connected by a safe planned motion.',
      'A common mistake is reading Forward from the camera view instead of the fixed −Z axis.',
    ],
    activities: [
      'Swap Right for Left and predict which coordinate sign changes.',
      'Orbit the camera, then confirm the same block still changes the same world axis.',
      'Debug a route whose Forward and Backward blocks were exchanged.',
      'Build a three-axis route that ends one cell from the origin on every axis.',
    ],
    drills: {
      variation: { starter: 'Right 1 → Up 1 → Forward 1', expected: 'Left 1 → Up 1 → Forward 1' },
      debug: { starter: 'Right 1 → Up 1 → Backward 1', expected: 'Right 1 → Up 1 → Forward 1' },
    },
  },
  {
    id: 'cutter-grid-distance',
    name: 'Grid 2 · Distance',
    description: 'Move several voxel cells with one visible block.',
    goal: 'Set an integer distance from 1 to 12. Step still advances one cell at a time.',
    example: 'Left 3',
    concepts: [
      'Distance is an integer voxel count, not metres, seconds, or servo degrees.',
      'One visible Move N remains one V4 action while its logical command cost is N cells.',
      'The accepted distance range is 1–12; zero, fractions, and larger values fail compilation.',
      'A common mistake is assuming a longer Move skips contact between its start and endpoint.',
    ],
    activities: [
      'Rebuild Left 3 as three connected Left 1 blocks, then compare the two.',
      'Change a distance from 3 to 4 and predict the new endpoint before running.',
      'Repair a route that moves too far: it should end three cells to the left.',
      'Reach coordinate (−3, 2, 0) using only two visible Move blocks.',
    ],
    drills: {
      variation: { starter: 'Left 3', expected: 'Left 1 → Left 1 → Left 1' },
      debug: { starter: 'Left 6', expected: 'Left 3' },
    },
  },
  {
    id: 'cutter-grid-repeat',
    name: 'Grid 3 · Repeat a Path',
    description: 'Build a small axis-aligned pattern with Repeat.',
    goal: 'Repeat movement blocks without exceeding the 500-action expanded limit.',
    example: 'Repeat 3 × [Up 1 → Down 1]',
    concepts: [
      'Repeat expands its body in order and can contain Move, Wait, or another Repeat.',
      'The Repeat block itself costs no runtime command; each expanded leaf contributes its normal cost.',
      'Expanded programs must stay at or below 500 logical commands and Repeat counts stay within 1–20.',
      'Repeating a one-way Move accumulates displacement; it does not reset to the loop start.',
    ],
    activities: [
      'Predict the endpoint of Repeat 3 × [Up 1].',
      'Add the inverse move so every iteration returns to its starting waypoint.',
      'Repair a Repeat whose body climbs twice instead of returning to its start.',
      'Build a four-edge loop and repeat it twice without changing the final coordinate.',
    ],
    drills: {
      variation: { starter: 'Repeat 3 × [Up 1]' },
      debug: {
        starter: 'Repeat 3 × [Up 1 → Up 1]',
        expected: 'Repeat 3 × [Up 1 → Down 1]',
      },
    },
  },
  {
    id: 'cutter-grid-overcut',
    name: 'Grid 4 · Watch the Swept Path',
    description: 'The cutter is always active and can remove more than one voxel.',
    goal: 'Choose a path that removes only target hair. The planner never routes around hair.',
    example: 'Left 2 → Up 2',
    concepts: [
      'The cutter stays active for positioning between every pair of programmed endpoints.',
      'Hair removal follows the actual swept tool volume, not just the visible endpoint coordinates.',
      'The planner finds a safe arm motion but never treats non-target hair as an obstacle to route around.',
      'Two programs with the same endpoint can produce different cuts because their swept paths differ.',
    ],
    activities: [
      'Predict which voxels a two-axis L-shaped route crosses.',
      'Reverse the order of two moves and compare the Test result.',
      'Debug an unwanted cut by locating the first segment that crosses it.',
      'Build a two-axis L-shaped route, then swap its two moves and compare which voxels each order removes.',
    ],
    drills: {
      variation: { starter: 'Left 2 → Up 2' },
      debug: { starter: 'Up 2 → Left 2', expected: 'Left 2 → Up 2' },
    },
  },
  {
    id: 'cutter-grid-blocked',
    name: 'Grid 5 · Blocked Nodes',
    description: 'Some grid coordinates are outside the arm’s certified joint space.',
    goal: 'Use the overlay to avoid blocked nodes; an unreachable move fails before execution.',
    example: 'Right 1 → Up 2',
    concepts: [
      'A grid coordinate can be inside the display bounds yet have no certified safe IK candidate.',
      'Orange nodes mean no safe IK was found; cyan nodes have known candidates but still need path planning.',
      'The whole program is planned before execution and fails closed at the first disconnected action.',
      'A blocked node is not permission to change limits, collision clearance, or the Challenge pose.',
    ],
    activities: [
      'Use the overlay legend to identify one reachable and one blocked coordinate.',
      'Predict whether adding another cell continues toward or away from the safe region.',
      'Run the blocked route, read the highlighted block, then shorten it to the last reachable cell.',
      'Build a route of at least three moves that only reaches coordinates the arm can certify.',
    ],
    drills: {
      variation: { requirement: 'overlay' },
      // Right 4 ends on (4, 0, 0), which has no certified safe pose: the route
      // fails to plan, which is the thing this lesson is about.
      debug: { starter: 'Right 4', expected: 'Right 3', unreachableStarter: true },
    },
  },
  {
    id: 'cutter-grid-opposites',
    name: 'Grid 6 · Opposite Directions',
    description: 'Undo displacement with the matching inverse direction.',
    goal: 'Pair Right with Left, Up with Down, and Forward with Backward to return to a waypoint.',
    example: 'Left 2 → Up 1 → Down 1 → Right 2',
    concepts: [
      'Right and Left, Up and Down, Forward and Backward are inverse displacement pairs.',
      'To reverse a multi-step path, invert every direction and apply the blocks in reverse order.',
      'Returning to a coordinate does not restore removed hair; cutting is irreversible within a run.',
      'A common mistake is inverting directions without reversing their order.',
    ],
    activities: [
      'Write the inverse of Left 2 → Up 1.',
      'Predict the final coordinate of the example before executing it.',
      'Debug an inverse route whose blocks are in the original order.',
      'Build a three-axis outbound route and its exact return path.',
    ],
    drills: {
      variation: {
        starter: 'Left 2 → Up 1',
        expected: 'Left 2 → Up 1 → Down 1 → Right 2',
      },
      debug: {
        starter: 'Left 2 → Up 1 → Left 2 → Up 1',
        expected: 'Left 2 → Up 1 → Down 1 → Right 2',
      },
    },
  },
  {
    id: 'cutter-grid-wait',
    name: 'Grid 7 · Pause at a Waypoint',
    description: 'Hold a planned pose without changing the grid coordinate.',
    goal: 'Insert Wait between moves. Wait affects timing, but does not move or switch off the cutter.',
    example: 'Up 2 → Wait 500 ms → Forward 2',
    concepts: [
      'Wait holds the current planned joint pose and does not change the logical grid coordinate.',
      'Wait accepts 0–5000 ms and contributes one logical runtime command.',
      'The cutter remains active during Wait, so pausing does not undo or protect already contacted hair.',
      'Wait is useful for observing a waypoint, not for solving a disconnected or colliding path.',
    ],
    activities: [
      'Predict the endpoint with and without the Wait block.',
      'Compare a 250 ms and 1000 ms pause while watching the same waypoint.',
      'Repair a route whose Wait runs before the first move instead of between the two moves.',
      'Place two different waits in a three-move route and inspect the event order.',
    ],
    drills: {
      variation: { starter: 'Up 2 → Wait 500 ms → Forward 2' },
      debug: {
        starter: 'Wait 500 ms → Up 2 → Forward 2',
        expected: 'Up 2 → Wait 500 ms → Forward 2',
      },
    },
  },
  {
    id: 'cutter-grid-route-order',
    name: 'Grid 8 · Route Order',
    description: 'Reach the same endpoint through different swept paths.',
    goal: 'Reorder axis moves and compare cuts: equal endpoints do not imply equal hair removal.',
    example: 'Left 3 → Up 2',
    concepts: [
      'Axis-aligned moves can commute algebraically while their physical swept paths do not.',
      'Program order fixes every intermediate waypoint even when the final coordinate is unchanged.',
      'Planning validates the ordered path as one frozen program, not as an unordered set of endpoints.',
      'Comparing only the final coordinate hides intermediate cuts and safety failures.',
    ],
    activities: [
      'Calculate the shared endpoint of Left 3 → Up 2 and Up 2 → Left 3.',
      'Test both orders and compare expected cuts and score.',
      'Debug the first segment responsible for a difference between the results.',
      'Build a three-block route that changes two axes, then reverse its order and compare both Test results.',
    ],
    drills: {
      variation: { starter: 'Left 3 → Up 2' },
      debug: { starter: 'Up 2 → Left 3', expected: 'Left 3 → Up 2' },
    },
  },
  {
    id: 'cutter-grid-compress',
    name: 'Grid 9 · Compact Programs',
    description: 'Express a straight run with one distance field.',
    goal: 'Replace adjacent moves in the same direction with one block, and know where that stops being free: the endpoints match, the motion between them does not.',
    example: 'Up 3',
    concepts: [
      'Adjacent moves in the same direction can be merged when their total distance is at most 12.',
      'Compression reduces source blocks and preserves logical distance, command cost, and every endpoint.',
      'Moves separated by Wait, another direction, or a Repeat boundary are not blindly merged.',
      'The planner flies one synchronized motion per visible block, so a merged run curves further from the straight line of cells than the separate moves did — past roughly six cells that difference starts cutting neighbours.',
    ],
    activities: [
      'Compress four Forward 1 blocks into one equivalent move.',
      'Explain why Up 2 → Wait → Up 2 should retain its waypoint.',
      'Debug a compression that accidentally changes direction order.',
      'Rewrite a seven-block route with the fewest safe visible blocks.',
    ],
    drills: {
      variation: {
        starter: 'Forward 1 → Forward 1 → Forward 1 → Forward 1',
        expected: 'Forward 4',
      },
      debug: { starter: 'Forward 2 → Up 3', expected: 'Up 3 → Forward 2' },
    },
  },
  {
    id: 'cutter-grid-certified-cut',
    name: 'Grid 10 · Certified Haircut',
    description: 'Combine all three axes into a complete target cut.',
    goal: 'Build the certified route, press Test, and reach 100 completion without an extra cut.',
    example: 'Left 3 → Up 6 → Up 2 → Forward 1 → Up 1 → Forward 1 → Up 1 → Forward 6 → Forward 1',
    concepts: [
      'The certified route combines X, Y, and Z moves to remove exactly eleven target voxels.',
      'Run, Test, and Step reuse the same frozen V4 plan and therefore must agree on the final cut.',
      'A 100 Completion result requires all target removals without changing the safety contract.',
      'The Challenge safe initial pose is distinct from the hardware Home 90° pose used for connection.',
    ],
    activities: [
      'Trace every waypoint of the nine-block reference route.',
      'Build the complete route from an empty Cutter Grid workspace.',
      'Debug one changed distance by comparing it with the certified sequence.',
      'Press Test, confirm 100 Completion, then replay the same plan with Run or Step.',
    ],
    drills: {
      variation: {
        starter: 'Left 3 → Up 6 → Up 2 → Forward 1 → Up 1 → Forward 1 → Up 1 → Forward 6 → Forward 1',
      },
      debug: {
        starter: 'Left 3 → Up 5 → Up 2 → Forward 1 → Up 1 → Forward 1 → Up 1 → Forward 6 → Forward 1',
        expected: 'Left 3 → Up 6 → Up 2 → Forward 1 → Up 1 → Forward 1 → Up 1 → Forward 6 → Forward 1',
      },
    },
  },
];

const SECTION_COUNT = 20;

/**
 * A drill's section fields. Without an `expected` route the section asks for a
 * prediction, so it keeps the Test requirement its activity implies and the
 * starter is there to predict about.
 */
function drill(exercise: CutterGridDrill): Partial<CutterGridLessonSection> {
  return {
    ...(exercise.starter ? { starter: exercise.starter } : {}),
    ...(exercise.expected ? { expected: exercise.expected } : {}),
    ...(exercise.requirement
      ? { requirement: exercise.requirement }
      : exercise.expected
        ? { requirement: 'program' as const }
        : {}),
  };
}

function buildSections(seed: CutterGridLessonSeed): CutterGridLessonSection[] {
  const entries: Array<Omit<CutterGridLessonSection, 'id'>> = [
    { title: 'Why this matters', body: seed.description, activity: 'read' },
    { title: 'Lesson outcome', body: seed.goal, activity: 'read' },
    { title: 'Key idea', body: seed.concepts[0], activity: 'read' },
    { title: 'Runtime rule', body: seed.concepts[1], activity: 'read' },
    { title: 'Safety rule', body: seed.concepts[2], activity: 'read' },
    { title: 'Common mistake', body: seed.concepts[3], activity: 'predict' },
    { title: 'Read the example', body: seed.example, activity: 'read' },
    { title: 'Trace it on paper', body: `Start at (0, 0, 0) and trace: ${seed.example}`, activity: 'predict' },
    { title: 'Predict before running', body: 'Write down the endpoint and the segments you expect the cutter to sweep.', activity: 'predict' },
    { title: 'Build the example', body: `Create this program in Blockly: ${seed.example}`, activity: 'build', expected: seed.example },
    { title: 'Inspect the overlay', body: 'Turn on Grid and planned path. Match each programmed waypoint to the world-axis overlay.', activity: 'observe', requirement: 'overlay' },
    { title: 'Use Step', body: 'Reset, then press Step once. Confirm which visible action completed and where the current coordinate moved.', activity: 'observe', requirement: 'step' },
    { title: 'Use Test', body: 'Press Test and compare the score, expected cuts, and final coordinate with your prediction.', activity: 'observe' },
    { title: 'First variation', body: seed.activities[0], activity: 'challenge', ...drill(seed.drills.variation) },
    { title: 'Second variation', body: seed.activities[1], activity: 'challenge' },
    { title: 'Debugging drill', body: seed.activities[2], activity: 'challenge', ...drill(seed.drills.debug) },
    // The closing challenge is the lesson's practical prompt, so it is checked
    // by the practical rather than by a route printed for the learner.
    { title: 'Independent challenge', body: seed.activities[3], activity: 'challenge', requirement: 'practical' },
    { title: 'Explain it back', body: `Explain in one sentence why this is true: ${seed.concepts[1]}`, activity: 'recap' },
    { title: 'Transfer the idea', body: 'Name one place this rule changes how you would design a longer haircut route.', activity: 'recap' },
    // Deliberately without the example: the checkpoint asks for recall, and
    // printing the program next to "from memory" hands over the answer. The
    // requirement the learner has to satisfy is the practical prompt below it.
    { title: 'Lesson checkpoint', body: 'Rebuild this lesson\u2019s program from memory, predict what it does, then verify it with Test.', activity: 'recap' },
  ];
  if (entries.length < SECTION_COUNT) {
    throw new Error(`Cutter Grid lesson "${seed.id}" requires at least ${SECTION_COUNT} sections.`);
  }
  return entries.map((section, index) => ({
    ...section,
    id: `${seed.id}-section-${index + 1}`,
  }));
}

export const CUTTER_GRID_LESSONS: readonly CutterGridLesson[] =
  CUTTER_GRID_LESSON_SEEDS.map((seed, index) => ({
    id: seed.id,
    name: seed.name,
    description: seed.description,
    goal: seed.goal,
    example: seed.example,
    assessments: {
      multipleChoice: buildConceptQuestion(
        seed.name,
        seed.concepts[0],
        (index % 3) as 0 | 1 | 2,
        [
          'The camera view defines the movement axes, so orbiting the camera changes the program.',
          'A program that compiles is guaranteed to follow a safe path and make the intended cut.',
        ],
      ),
      practicalPrompt: seed.activities[3],
    },
    sections: buildSections(seed),
  }));

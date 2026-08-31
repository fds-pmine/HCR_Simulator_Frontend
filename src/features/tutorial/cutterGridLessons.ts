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
}

interface CutterGridLessonSeed extends Omit<CutterGridLesson, 'sections' | 'assessments'> {
  concepts: readonly [string, string, string, string];
  activities: readonly [string, string, string, string];
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
      'Compare Left 3 with three connected Left 1 blocks.',
      'Change a distance from 3 to 4 and predict the new endpoint before running.',
      'Debug a distance field that is outside the 1–12 contract.',
      'Reach coordinate (−3, 2, 0) using only two visible Move blocks.',
    ],
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
      'Debug a Repeat whose empty body cannot compile.',
      'Build a four-edge loop and repeat it twice without changing the final coordinate.',
    ],
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
      'Find a route that reaches the same endpoint while avoiding an observed extra cut.',
    ],
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
      'Run an intentionally blocked route and read the highlighted source block.',
      'Replace only the failing segment while keeping the rest of the route unchanged.',
    ],
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
      'Debug a Wait duration outside its allowed range.',
      'Place two different waits in a three-move route and inspect the event order.',
    ],
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
      'Find two three-block routes with the same endpoint and compare their swept paths.',
    ],
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
  },
];

const SECTION_COUNT = 20;

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
    { title: 'Build the example', body: `Create this program in Blockly: ${seed.example}`, activity: 'build' },
    { title: 'Inspect the overlay', body: 'Turn on Grid and planned path. Match each programmed waypoint to the world-axis overlay.', activity: 'observe', requirement: 'overlay' },
    { title: 'Use Step', body: 'Reset, then press Step once. Confirm which visible action completed and where the current coordinate moved.', activity: 'observe', requirement: 'step' },
    { title: 'Use Test', body: 'Press Test and compare the score, expected cuts, and final coordinate with your prediction.', activity: 'observe' },
    { title: 'First variation', body: seed.activities[0], activity: 'challenge' },
    { title: 'Second variation', body: seed.activities[1], activity: 'challenge' },
    { title: 'Debugging drill', body: seed.activities[2], activity: 'challenge' },
    { title: 'Independent challenge', body: seed.activities[3], activity: 'challenge' },
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

export interface CutterGridLesson {
  id: string;
  name: string;
  description: string;
  goal: string;
}

export const CUTTER_GRID_LESSONS: readonly CutterGridLesson[] = [
  {
    id: 'cutter-grid-fixed-axes',
    name: 'Grid 1 · Fixed World Axes',
    description: 'Learn the six directions around the fixed world coordinate frame.',
    goal: 'Use Right (+X), Up (+Y), and Forward (−Z). The axes never rotate with the arm.',
  },
  {
    id: 'cutter-grid-distance',
    name: 'Grid 2 · Distance',
    description: 'Move several voxel cells with one visible block.',
    goal: 'Set an integer distance from 1 to 12. Step still advances one cell at a time.',
  },
  {
    id: 'cutter-grid-repeat',
    name: 'Grid 3 · Repeat a Path',
    description: 'Build a small axis-aligned pattern with Repeat.',
    goal: 'Repeat movement blocks without exceeding the 500-action expanded limit.',
  },
  {
    id: 'cutter-grid-overcut',
    name: 'Grid 4 · Watch the Swept Path',
    description: 'The cutter is always active and can remove more than one voxel.',
    goal: 'Choose a path that removes only target hair. The planner never routes around hair.',
  },
  {
    id: 'cutter-grid-blocked',
    name: 'Grid 5 · Blocked Nodes',
    description: 'Some grid coordinates are outside the arm’s certified joint space.',
    goal: 'Use the overlay to avoid blocked nodes; an unreachable move fails before execution.',
  },
];

import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import { CUTTER_GRID_LESSONS } from '../../src/features/tutorial/cutterGridLessons';
import {
  parseCutterGridExample,
  passesCutterGridPractical,
  type ExampleNode,
} from '../../src/features/tutorial/lessonAssessments';
import type { CutterGridNodeV1, CutterGridProgramV1 } from '../../src/features/cutter-grid/types';
import { registeredCutterGridProfileV4 } from '../../src/features/cutter-grid/profileRegistry';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { CutterGridCoord, CutterGridProfileV4 } from '../../src/features/cutter-grid/types';

const STEP: Readonly<Record<string, CutterGridCoord>> = {
  right: [1, 0, 0], left: [-1, 0, 0],
  up: [0, 1, 0], down: [0, -1, 0],
  forward: [0, 0, -1], backward: [0, 0, 1],
};

/** Every cell the cutter passes through, one voxel at a time. */
function waypointsOf(nodes: readonly ExampleNode[], from: CutterGridCoord): CutterGridCoord[] {
  const visited: CutterGridCoord[] = [];
  let at = from;
  for (const node of nodes) {
    if (node.type === 'wait') continue;
    if (node.type === 'repeat') {
      for (let pass = 0; pass < node.count; pass += 1) {
        const body = waypointsOf(node.body, at);
        visited.push(...body);
        at = body.at(-1) ?? at;
      }
      continue;
    }
    const step = STEP[node.direction];
    for (let cell = 0; cell < node.distance; cell += 1) {
      at = [at[0] + step[0], at[1] + step[1], at[2] + step[2]];
      visited.push(at);
    }
  }
  return visited;
}

/**
 * Three sections template the example as a program the learner reads, traces
 * and then builds, and the build gate accepts the workspace only when it holds
 * exactly that route. An example that does not parse, or that leaves the
 * reachable grid, is one no learner can complete.
 */
describe('every Grid lesson example is a route a learner can build', () => {
  let profile: CutterGridProfileV4;

  beforeAll(async () => {
    const challenge = await new LocalChallengeProvider().getChallenge(DEFAULT_CHALLENGE_ID);
    const registered = registeredCutterGridProfileV4(challenge);
    if (!registered) throw new Error('Expected the certified Cutter Grid V4 Profile.');
    profile = registered;
  }, 120_000);

  it('parses with the grammar the build gate uses', () => {
    for (const lesson of CUTTER_GRID_LESSONS) {
      expect(parseCutterGridExample(lesson.example), lesson.id).toBeDefined();
    }
  });

  it('never leaves the reachable grid', () => {
    for (const lesson of CUTTER_GRID_LESSONS) {
      const nodes = parseCutterGridExample(lesson.example);
      expect(nodes).toBeDefined();
      const waypoints = waypointsOf(nodes!, [0, 0, 0]);
      expect(waypoints.length).toBeGreaterThan(0);

      for (const coord of waypoints) {
        const node = profile.nodes.find(
          (entry) => entry.coord[0] === coord[0]
            && entry.coord[1] === coord[1]
            && entry.coord[2] === coord[2],
        );
        expect(
          node?.staticIkStatus,
          `${lesson.id} example visits (${coord.join(', ')})`,
        ).toBe('safe-candidate-known');
      }
    }
  });

  /**
   * One worked answer per lesson. A practical that cannot be satisfied is
   * worse than one that is too easy, so each answer is checked against both
   * the gate and the reachable grid.
   */
  const MODEL_ANSWERS: Readonly<Record<string, string>> = {
    'cutter-grid-fixed-axes': 'Right 1 → Up 1 → Forward 1',
    'cutter-grid-distance': 'Left 3 → Up 2',
    'cutter-grid-repeat': 'Repeat 2 × [Up 1 → Left 1 → Down 1 → Right 1]',
    'cutter-grid-overcut': 'Left 2 → Up 2',
    'cutter-grid-blocked': 'Left 1 → Up 2 → Forward 1',
    'cutter-grid-opposites': 'Left 2 → Up 1 → Forward 1 → Backward 1 → Down 1 → Right 2',
    'cutter-grid-wait': 'Up 2 → Wait 100 ms → Left 1 → Wait 500 ms → Forward 1',
    'cutter-grid-route-order': 'Left 3 → Up 2 → Forward 1',
    'cutter-grid-compress': 'Up 4 → Left 3',
    'cutter-grid-certified-cut': 'Left 3 → Up 6 → Up 2 → Forward 1 → Up 1',
  };

  function programOf(nodes: readonly ExampleNode[], prefix = 'answer'): CutterGridNodeV1[] {
    return nodes.map((node, index): CutterGridNodeV1 => {
      const sourceBlockId = `${prefix}-${index}`;
      if (node.type === 'move') {
        return { type: 'move', direction: node.direction, distance: node.distance, sourceBlockId };
      }
      if (node.type === 'wait') {
        return { type: 'wait', durationMs: node.durationMs, sourceBlockId };
      }
      return {
        type: 'repeat',
        count: node.count,
        body: programOf(node.body, sourceBlockId),
        sourceBlockId,
      };
    });
  }

  it('has a completable practical, reachable on the certified grid', () => {
    for (const lesson of CUTTER_GRID_LESSONS) {
      const answer = MODEL_ANSWERS[lesson.id];
      expect(answer, `${lesson.id} has a model answer`).toBeDefined();
      const nodes = parseCutterGridExample(answer);
      expect(nodes, `${lesson.id} answer parses`).toBeDefined();

      const program: CutterGridProgramV1 = {
        kind: 'cutter-grid',
        version: 1,
        plannerVersion: 'test',
        nodes: programOf(nodes!),
        sourceBlockCount: nodes!.length,
      };
      expect(
        passesCutterGridPractical(lesson.id, program, 1, 100, 'completed'),
        `${lesson.id} practical accepts its model answer`,
      ).toBe(true);

      for (const coord of waypointsOf(nodes!, [0, 0, 0])) {
        const node = profile.nodes.find(
          (entry) => entry.coord[0] === coord[0]
            && entry.coord[1] === coord[1]
            && entry.coord[2] === coord[2],
        );
        expect(
          node?.staticIkStatus,
          `${lesson.id} answer visits (${coord.join(', ')})`,
        ).toBe('safe-candidate-known');
      }
    }
  });
});

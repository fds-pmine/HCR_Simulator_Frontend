import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import { CUTTER_GRID_LESSONS } from '../../src/features/tutorial/cutterGridLessons';
import {
  lessonSectionRequirement,
  matchesCutterGridExample,
  parseCutterGridExample,
  type ExampleNode,
} from '../../src/features/tutorial/lessonAssessments';
import { starterWorkspaceFor } from '../../src/features/tutorial/starterWorkspace';
import { registeredCutterGridProfileV4 } from '../../src/features/cutter-grid/profileRegistry';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type {
  CutterGridCoord,
  CutterGridNodeV1,
  CutterGridProfileV4,
  CutterGridProgramV1,
} from '../../src/features/cutter-grid/types';

const STEP: Readonly<Record<string, CutterGridCoord>> = {
  right: [1, 0, 0], left: [-1, 0, 0],
  up: [0, 1, 0], down: [0, -1, 0],
  forward: [0, 0, -1], backward: [0, 0, 1],
};

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

function programOf(nodes: readonly ExampleNode[], prefix = 'drill'): CutterGridNodeV1[] {
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

const drills = CUTTER_GRID_LESSONS.flatMap((lesson) =>
  lesson.sections
    .filter((section) => section.starter || section.expected)
    .map((section) => ({ lesson: lesson.id, section })),
);

/**
 * The variation and debugging sections hand the learner a route and ask them
 * to change or repair it. Every one has to be placeable on the canvas, and
 * every route the learner is asked to end up with has to be reachable and
 * accepted by the gate — otherwise the section is unfinishable.
 */
describe('Grid lesson drills', () => {
  let profile: CutterGridProfileV4;

  beforeAll(async () => {
    const challenge = await new LocalChallengeProvider().getChallenge(DEFAULT_CHALLENGE_ID);
    const registered = registeredCutterGridProfileV4(challenge);
    if (!registered) throw new Error('Expected the certified Cutter Grid V4 Profile.');
    profile = registered;
  }, 120_000);

  function statusOf(coord: CutterGridCoord): string | undefined {
    return profile.nodes.find(
      (entry) => entry.coord[0] === coord[0]
        && entry.coord[1] === coord[1]
        && entry.coord[2] === coord[2],
    )?.staticIkStatus;
  }

  it('gives every lesson a workspace exercise rather than another Test press', () => {
    for (const lesson of CUTTER_GRID_LESSONS) {
      const challenges = lesson.sections.filter((section) => section.activity === 'challenge');
      const checked = challenges.filter(
        (section) => lessonSectionRequirement(section) !== 'test',
      );
      expect(checked.length, `${lesson.id} challenge sections that check work`)
        .toBeGreaterThanOrEqual(2);
    }
  });

  it('places every starter on the canvas as real blocks', () => {
    expect(drills.length).toBeGreaterThan(0);
    for (const { lesson, section } of drills) {
      if (!section.starter) continue;
      const seeded = starterWorkspaceFor(section.starter);
      expect(seeded, `${lesson} / ${section.title}`).toBeDefined();
      const blocks = (seeded as { blocks: { blocks: unknown[] } }).blocks.blocks;
      expect(blocks).toHaveLength(1);
    }
  });

  it('asks for a route the gate accepts and the arm can reach', () => {
    for (const { lesson, section } of drills) {
      if (!section.expected) continue;
      const nodes = parseCutterGridExample(section.expected);
      expect(nodes, `${lesson} / ${section.title} expected parses`).toBeDefined();

      const program: CutterGridProgramV1 = {
        kind: 'cutter-grid',
        version: 1,
        plannerVersion: 'test',
        nodes: programOf(nodes!),
        sourceBlockCount: nodes!.length,
      };
      expect(
        matchesCutterGridExample(section.expected, program),
        `${lesson} / ${section.title} accepts its own answer`,
      ).toBe(true);
      if (section.starter) {
        expect(
          matchesCutterGridExample(section.expected, {
            ...program,
            nodes: programOf(parseCutterGridExample(section.starter)!),
          }),
          `${lesson} / ${section.title} is not already solved by its starter`,
        ).toBe(false);
      }

      for (const coord of waypointsOf(nodes!, [0, 0, 0])) {
        expect(
          statusOf(coord),
          `${lesson} / ${section.title} answer visits (${coord.join(', ')})`,
        ).toBe('safe-candidate-known');
      }
    }
  });

  it('keeps the blocked-node starter genuinely unreachable', () => {
    const blocked = CUTTER_GRID_LESSONS
      .find((lesson) => lesson.id === 'cutter-grid-blocked')!
      .sections.find((section) => section.title === 'Debugging drill');
    expect(blocked?.starter).toBeDefined();

    const waypoints = waypointsOf(parseCutterGridExample(blocked!.starter!)!, [0, 0, 0]);
    // The lesson only teaches anything here if the route really does fail.
    expect(waypoints.some((coord) => statusOf(coord) !== 'safe-candidate-known')).toBe(true);
  });
});

/**
 * Record the cheap Cutter Grid Phase 0 geometry gate.
 *
 * This intentionally does not certify joint-space trajectories. Phase 2 owns
 * that proof; until its Profile exists the UI must remain Servo-only.
 *
 *   npm run cutter-grid:audit
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { defaultChallengeDefinition } from '../src/data/challenges/defaultChallenge';
import { computeCutterGridGeometricAudit } from '../src/features/cutter-grid/feasibility';
import { normalizeChallenge } from '../src/services/normalizeChallenge';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(
  here,
  '../tests/fixtures/cutter-grid-geometric-audit.json',
);

it('records the default Cutter Grid geometric gate', () => {
  const challenge = normalizeChallenge(defaultChallengeDefinition);
  const audit = computeCutterGridGeometricAudit(challenge);

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(audit, null, 2)}\n`);

  process.stdout.write(
    `Cutter Grid geometry: ${audit.safeCutEdgeCount} safe cut edges, ` +
      `${audit.uncoveredTargetVoxelKeys.length} uncovered targets, ` +
      `${audit.directionsWithoutSafeEdge.length} missing directions\n`,
  );

  expect(audit.geometricGatePassed).toBe(true);
  expect(audit.trajectoryCertification).toBe('pending-planner');
});


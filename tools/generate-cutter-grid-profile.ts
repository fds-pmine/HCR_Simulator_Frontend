/**
 * Generate the signed, fail-closed Cutter Grid Profile bundled by the frontend.
 *
 *   npm run cutter-grid:profile
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { defaultChallengeDefinition } from '../src/data/challenges/defaultChallenge';
import { generateCutterGridProfile } from '../src/features/cutter-grid/profile';
import { normalizeChallenge } from '../src/services/normalizeChallenge';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, '../tests/fixtures/cutter-grid-profile.json');

it('generates the certified Cutter Grid Profile', () => {
  const challenge = normalizeChallenge(defaultChallengeDefinition);
  const profile = generateCutterGridProfile(challenge, [0, -5, 8], {
    includeNodeMap: true,
  });

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(profile, null, 2)}\n`);
  process.stdout.write(
    `Cutter Grid Profile: ${profile.nodes.length} nodes, ` +
      `${profile.certification.referenceCutVoxels.length} exact cuts, ` +
      `${profile.certification.certifiedDirections.length} directions\n`,
  );

  expect(profile.certification.passed).toBe(true);
});

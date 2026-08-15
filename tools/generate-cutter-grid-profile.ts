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
import { generateCutterGridProfileV2 } from '../src/features/cutter-grid/profileV2';
import { normalizeChallenge } from '../src/services/normalizeChallenge';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, '../tests/fixtures/cutter-grid-profile.json');
const outputV2 = resolve(here, '../tests/fixtures/cutter-grid-profile-v2.json');

it('generates the certified Cutter Grid Profile', () => {
  const challenge = normalizeChallenge(defaultChallengeDefinition);
  const profile = generateCutterGridProfile(challenge, [0, -5, 8], {
    includeNodeMap: true,
  });

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(profile, null, 2)}\n`);
  const profileV2 = generateCutterGridProfileV2(challenge, [0, -5, 8], {
    includeNodeMap: true,
  });
  writeFileSync(outputV2, `${JSON.stringify(profileV2, null, 2)}\n`);
  process.stdout.write(
    `Cutter Grid Profile: ${profile.nodes.length} nodes, ` +
      `${profile.certification.referenceCutVoxels.length} exact cuts, ` +
    `${profile.certification.certifiedDirections.length} directions\n`,
  );
  process.stdout.write(
    `Cutter Grid Profile V2: ${profileV2.nodes.length} static nodes, ` +
      `${profileV2.entryOptions.length} zero-contact entries, ` +
      `${profileV2.certification.certifiedDirections.length} geometric directions\n`,
  );

  expect(profile.certification.passed).toBe(true);
  expect(profileV2.certification.passed).toBe(true);
});

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
import { planCutterGridCompactPtpV4 } from '../src/features/cutter-grid/compactPtpPlannerV4';
import { compileCutterGridExecutableProgramV2 } from '../src/features/cutter-grid/programCompiler';
import { generateCutterGridProfile } from '../src/features/cutter-grid/profile';
import { generateCutterGridProfileV2 } from '../src/features/cutter-grid/profileV2';
import { upgradeCutterGridProfileV2ToV4 } from '../src/features/cutter-grid/profileV4';
import { normalizeChallenge } from '../src/services/normalizeChallenge';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, '../tests/fixtures/cutter-grid-profile.json');
const outputV2 = resolve(here, '../tests/fixtures/cutter-grid-profile-v2.json');
const outputV4 = resolve(here, '../tests/fixtures/cutter-grid-profile-v4.json');

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
  const profileV4 = upgradeCutterGridProfileV2ToV4(challenge, profileV2);
  writeFileSync(outputV4, `${JSON.stringify(profileV4, null, 2)}\n`);
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
  expect(profileV4.certification.passed).toBe(true);

  // V4 inherits V2's certification flags, but it flies its own compact PTP
  // path — one synchronized primitive per visible Move — and only the actual
  // sweep decides what comes off. Certifying the reference route under the
  // planner that will really run it is what catches a Profile whose reference
  // no longer removes exactly the target.
  const compactPlan = planCutterGridCompactPtpV4(
    challenge,
    compileCutterGridExecutableProgramV2(profileV4.referenceProgram),
    profileV4,
  );
  const compactCut = [...challenge.initialHair.voxels]
    .filter((key) => !compactPlan.expectedResultVoxels.includes(key))
    .sort();
  process.stdout.write(
    `Cutter Grid V4 reference sweep: ${compactCut.length} cut voxels, ` +
    `${compactPlan.diagnostics.maximumEndEffectorChordDeviation.toFixed(4)} max chord deviation\n`,
  );
  expect(compactCut).toEqual(
    [...challenge.initialHair.voxels]
      .filter((key) => !challenge.targetHair.voxels.has(key))
      .sort(),
  );
});

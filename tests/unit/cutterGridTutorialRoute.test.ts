import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import { CUTTER_GRID_TUTORIAL_STEPS } from '../../src/features/tutorial/cutterGridTutorial';
import { CUTTER_GRID_LESSONS } from '../../src/features/tutorial/cutterGridLessons';
import { registeredCutterGridProfileV4 } from '../../src/features/cutter-grid/profileRegistry';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { Challenge } from '../../src/types/domain';

describe('guided content follows the certified route', () => {
  let challenge: Challenge;
  let certifiedRoute: string;

  beforeAll(async () => {
    challenge = await new LocalChallengeProvider().getChallenge(DEFAULT_CHALLENGE_ID);
    const profile = registeredCutterGridProfileV4(challenge);
    if (!profile) throw new Error('Expected the bundled Cutter Grid V4 Profile.');
    certifiedRoute = profile.referenceProgram.nodes
      .map((node) => (node.type === 'move'
        ? `${node.direction[0].toUpperCase()}${node.direction.slice(1)} ${node.distance}`
        : node.type))
      .join(' → ');
  });

  // The tutorial's last step waits for a real 100 completion and can no longer
  // be skipped, so teaching a stale route would strand the learner there.
  it('names the certified route in the tutorial hint', () => {
    const finalRoute = CUTTER_GRID_TUTORIAL_STEPS
      .find((step) => step.id === 'grid-complete-route')?.hint;

    expect(finalRoute).toBeDefined();
    expect(finalRoute?.replace(/\s+/g, ' ').replace(/\.$/, '')).toBe(certifiedRoute);
  });

  it('names the certified route in the closing Grid lesson', () => {
    const lesson = CUTTER_GRID_LESSONS.find((entry) => entry.id === 'cutter-grid-certified-cut');

    expect(lesson?.example).toBe(certifiedRoute);
  });
});

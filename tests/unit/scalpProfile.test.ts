import { defaultChallengeDefinition } from '../../src/data/challenges/defaultChallenge';
import {
  defaultScalpMotionProfile,
  resolveScalpMotionProfile,
  SCALP_GRID_COLUMNS,
  SCALP_GRID_ROWS,
  scalpGeometrySignature,
  validateScalpMotionProfile,
} from '../../src/features/scalp-path';
import { normalizeChallenge } from '../../src/services/normalizeChallenge';

const challenge = normalizeChallenge(defaultChallengeDefinition);

describe('default Scalp Turtle motion profile', () => {
  it('renders the complete 7 by 12 grid while enabling only a connected safe patch', () => {
    const nodes = defaultScalpMotionProfile.nodes;
    const enabled = nodes.filter((node) => node.reachable);

    expect(nodes).toHaveLength(SCALP_GRID_ROWS * SCALP_GRID_COLUMNS);
    expect(enabled).toHaveLength(27);
    expect(new Set(enabled.map((node) => node.row)).size).toBe(3);
    expect(new Set(enabled.map((node) => node.column)).size).toBe(9);
    expect(nodes.find((node) => node.id === 'r0-c0')?.neighbors.west).toBe(
      'r0-c11',
    );
    expect(nodes.find((node) => node.id === 'r6-c11')?.neighbors.east).toBe(
      'r6-c0',
    );
  });

  it('matches the shipped geometry and certifies every stored pose', () => {
    expect(
      scalpGeometrySignature(challenge),
    ).toBe(defaultScalpMotionProfile.geometrySignature);
    expect(resolveScalpMotionProfile(challenge).profile).toBe(
      defaultScalpMotionProfile,
    );
    expect(validateScalpMotionProfile(defaultScalpMotionProfile, challenge)).toEqual([]);
  });

  it('fails closed when joint geometry drifts', () => {
    const shifted = {
      ...challenge,
      robotConfig: {
        ...challenge.robotConfig,
        joints: challenge.robotConfig.joints.map((joint) =>
          joint.id === 'baseYaw'
            ? { ...joint, maxAngleDeg: joint.maxAngleDeg - 1 }
            : joint,
        ),
      },
    };

    expect(resolveScalpMotionProfile(shifted).profile).toBeUndefined();
    expect(resolveScalpMotionProfile(shifted).error).toContain('not calibrated');
  });
});

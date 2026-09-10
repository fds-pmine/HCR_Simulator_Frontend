import { describe, expect, it } from 'vitest';
import {
  PROGRAMMING_MODES,
  canSwitchProgrammingMode,
} from '../../src/features/blockly/programmingMode';
import { withFreshCanvas } from '../../src/features/blockly/blankCanvas';
import { programmingWorkspaceMemory } from '../../src/features/blockly/workspaceMemory';
import { defaultChallengeDefinition } from '../../src/data/challenges/defaultChallenge';
import { normalizeChallenge } from '../../src/services/normalizeChallenge';

describe('programming mode switching', () => {
  it('is allowed only while the workbench is idle', () => {
    expect(canSwitchProgrammingMode('idle')).toBe(true);
    for (const status of ['running', 'paused', 'completed', 'stopped', 'error']) {
      expect(canSwitchProgrammingMode(status)).toBe(false);
    }
  });
});

describe('the canvas a new attempt opens on', () => {
  const challenge = normalizeChallenge(defaultChallengeDefinition);

  it('keeps a remembered canvas across an ordinary remount', () => {
    // The memory is why collapsing the program panel or switching modes
    // mid-attempt does not cost the learner their work.
    programmingWorkspaceMemory.save(challenge, 'servo', { blocks: 'servo' });
    expect(programmingWorkspaceMemory.load(challenge, 'servo')).toEqual({
      blocks: 'servo',
    });
  });

  it('drops every mode when a new attempt opens', () => {
    // A versus rematch reopens the same challenge, so a blank *starter* was not
    // enough: round two opened on round one's finished program.
    programmingWorkspaceMemory.save(challenge, 'servo', { blocks: 'servo' });
    programmingWorkspaceMemory.save(challenge, 'cutter-grid', { blocks: 'grid' });

    const fresh = withFreshCanvas(challenge);

    expect(fresh.starterWorkspace).toEqual({});
    for (const mode of PROGRAMMING_MODES) {
      expect(programmingWorkspaceMemory.load(challenge, mode)).toBeUndefined();
      // Keyed by signature, so the returned challenge is the same key.
      expect(programmingWorkspaceMemory.load(fresh, mode)).toBeUndefined();
    }
  });
});

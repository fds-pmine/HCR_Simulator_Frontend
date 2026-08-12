import { describe, expect, it } from 'vitest';
import { canSwitchProgrammingMode } from '../../src/features/blockly/programmingMode';

describe('programming mode switching', () => {
  it('is allowed only while the workbench is idle', () => {
    expect(canSwitchProgrammingMode('idle')).toBe(true);
    for (const status of ['running', 'paused', 'completed', 'stopped', 'error']) {
      expect(canSwitchProgrammingMode(status)).toBe(false);
    }
  });
});

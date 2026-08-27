import { describe, expect, it } from 'vitest';
import {
  formatPlayerLocalTime,
  formatUtcOffset,
} from '../../src/features/match/playerTime';

describe('multiplayer local time', () => {
  it('formats a local clock from UTC offset only', () => {
    const noonUtc = Date.parse('2026-08-26T12:00:00Z');
    expect(formatPlayerLocalTime(8 * 60, noonUtc)).toBe('20:00');
    expect(formatPlayerLocalTime(-4 * 60, noonUtc)).toBe('08:00');
    expect(formatUtcOffset(330)).toBe('UTC+05:30');
  });

  it('rejects missing and impossible offsets', () => {
    expect(formatPlayerLocalTime(undefined)).toBeUndefined();
    expect(formatPlayerLocalTime(14 * 60 + 1)).toBeUndefined();
    expect(formatPlayerLocalTime(1.5)).toBeUndefined();
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import {
  currentUtcOffsetMinutes,
  loadResearchPreferences,
  primaryLanguage,
  researchHeaders,
  saveResearchPreferences,
} from '../../src/features/preferences/researchPreferences';

describe('research preferences', () => {
  beforeEach(() => {
    localStorage.removeItem('hcr.research-preferences.v1');
    localStorage.removeItem('hcr.locale.v1');
  });

  it('defaults every secondary research field off', () => {
    expect(loadResearchPreferences()).toEqual({
      programAndScores: false,
      language: false,
      utcOffset: false,
      decided: false,
    });
  });

  it('sends only fields with granular permission', () => {
    saveResearchPreferences({
      programAndScores: true,
      language: true,
      utcOffset: false,
      decided: true,
    });
    expect(researchHeaders()).toMatchObject({
      'X-HCR-Research-Program-And-Scores': 'granted',
      'X-HCR-Research-Language-Consent': 'granted',
      'X-HCR-Research-Utc-Offset-Consent': 'declined',
    });
    expect(researchHeaders()).toHaveProperty('X-HCR-Research-Language');
    expect(researchHeaders()).not.toHaveProperty(
      'X-HCR-Research-Utc-Offset-Minutes',
    );
  });

  it('uses a coarse current offset without exposing a zone name', () => {
    expect(currentUtcOffsetMinutes(new Date('2026-01-01T00:00:00Z'))).toBe(
      -new Date('2026-01-01T00:00:00Z').getTimezoneOffset(),
    );
  });

  it('reduces the selected application locale to a coarse language code', () => {
    localStorage.setItem('hcr.locale.v1', 'zh-TW');
    expect(primaryLanguage()).toBe('zh');
  });

  it('shares only a coarse language code and a numeric minute offset when both are enabled', () => {
    localStorage.setItem('hcr.locale.v1', 'zh-HK');
    saveResearchPreferences({
      programAndScores: true,
      language: true,
      utcOffset: true,
      decided: true,
    });

    const headers = researchHeaders();
    expect(headers['X-HCR-Research-Language']).toBe('zh');
    expect(headers['X-HCR-Research-Utc-Offset-Minutes']).toMatch(/^-?\d+$/);
    expect(Object.keys(headers).join(' ')).not.toMatch(/time.?zone/i);
    expect(Object.values(headers).join(' ')).not.toContain('Asia/Hong_Kong');
  });
});

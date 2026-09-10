import { describe, expect, it } from 'vitest';
import { parseOklch, toHex } from '../../src/theme/oklch';

/** What the browser resolves these to, so the scene matches the panels. */
const KNOWN: readonly [string, string][] = [
  ['oklch(0.945 0.012 198)', '#e4eff0'],
  ['oklch(0.195 0.028 198)', '#041919'],
  ['oklch(0.50 0.125 194)', '#007878'],
  ['oklch(0.80 0.125 194)', '#39d7d5'],
  ['oklch(0.720 0.070 55)', '#c8997b'],
];

describe('reading the palette out of CSS', () => {
  it.each(KNOWN)('converts %s to %s', (value, expected) => {
    const parsed = parseOklch(value);
    expect(parsed).not.toBeNull();
    expect(toHex(parsed!.hex)).toBe(expected);
  });

  it('carries alpha separately, because three puts opacity on the material', () => {
    expect(parseOklch('oklch(0.08 0.015 198 / 0.82)')?.alpha).toBeCloseTo(0.82);
    expect(parseOklch('oklch(0.50 0.125 194)')?.alpha).toBe(1);
  });

  it('accepts percentages and a deg suffix, which CSS allows', () => {
    expect(parseOklch('oklch(50% 0.125 194deg)')).toEqual(
      parseOklch('oklch(0.5 0.125 194)'),
    );
  });

  it('clamps out-of-gamut chroma rather than scaling it', () => {
    // The palette authors chroma past sRGB on purpose so P3 screens get the
    // richer colour. Clamping keeps the sRGB result on the gamut boundary.
    const parsed = parseOklch('oklch(0.52 0.18 158)');
    expect(parsed).not.toBeNull();
    expect(toHex(parsed!.hex)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('returns null for anything it cannot read, including the empty string', () => {
    // jsdom does not resolve custom properties, so this is the path every unit
    // test takes; the caller falls back to a baked table instead of NaN.
    expect(parseOklch('')).toBeNull();
    expect(parseOklch('#0a141d')).toBeNull();
    expect(parseOklch('rgb(10, 20, 29)')).toBeNull();
    expect(parseOklch('color(srgb 0.1 0.2 0.3)')).toBeNull();
  });
});

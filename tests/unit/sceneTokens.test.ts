// Imported as text rather than read from disk: under jsdom the module URL is
// rewritten to an http scheme, which `readFileSync` refuses, and reaching for
// `node:path` would pull Node's types into a browser-environment test.
import { describe, expect, it } from 'vitest';
import CSS from '../../src/styles.css?raw';

import { parseOklch, toHex } from '../../src/theme/oklch';
import { readSceneTokens } from '../../src/theme/sceneTokens';

/**
 * The scene reads its colours from the stylesheet at runtime and falls back to
 * a baked table under jsdom, where custom properties do not resolve. If the two
 * drift, the 3D stage renders one palette while every panel around it renders
 * another — and no other test would notice, because the fallback is only taken
 * where `getComputedStyle` is inert.
 */

function paletteBlock(selector: string): Record<string, string> {
  const at = CSS.indexOf(selector);
  expect(at, `${selector} is missing from styles.css`).toBeGreaterThan(-1);
  const block = CSS.slice(at, CSS.indexOf('\n}', at));
  return Object.fromEntries(
    [...block.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()]),
  );
}

const BLOCKS = {
  light: paletteBlock(':root {'),
  dark: paletteBlock(":root[data-theme='dark'] {"),
} as const;

const SOURCES: readonly [keyof ReturnType<typeof readSceneTokens>, string][] = [
  ['stage', '--stage'],
  ['gridMajor', '--stage-grid-major'],
  ['gridMinor', '--stage-grid-minor'],
  ['stageSky', '--stage-sky'],
  ['stageBounce', '--stage-bounce'],
  ['skin', '--skin'],
  ['hair', '--hair'],
  ['hairTarget', '--hair-target'],
  ['robotJoint', '--robot-joint'],
  ['robotTool', '--robot-tool'],
  ['nodeReachable', '--node-reachable'],
  ['nodePlanned', '--node-planned'],
  ['blockMotion', '--block-motion'],
  ['accent', '--accent'],
  ['ink', '--ink'],
];

describe('the scene palette agrees with the stylesheet', () => {
  for (const theme of ['light', 'dark'] as const) {
    describe(theme, () => {
      const tokens = readSceneTokens(theme);

      it.each(SOURCES)('%s matches %s', (key, property) => {
        const declared = BLOCKS[theme][property];
        expect(declared, `${property} is not declared for ${theme}`).toBeDefined();
        const converted = parseOklch(declared);
        expect(converted, `${property} is not an oklch() value`).not.toBeNull();
        expect(toHex(tokens[key] as number)).toBe(toHex(converted!.hex));
      });
    });
  }

  it('keeps the target ghost readable against its own ground', () => {
    // The opacity is the thing that breaks silently when a theme flips: the
    // same 18% that reads against near-black vanishes against near-white.
    expect(readSceneTokens('light').targetVoxelOpacity).toBeGreaterThan(
      readSceneTokens('dark').targetVoxelOpacity,
    );
  });

  it('turns the key light down and the bounce up for a bright stage', () => {
    const light = readSceneTokens('light');
    const dark = readSceneTokens('dark');
    expect(light.keyIntensity).toBeLessThan(dark.keyIntensity);
    expect(light.hemiIntensity).toBeGreaterThan(dark.hemiIntensity);
    // Fog has to retreat past the working volume rather than wash it white.
    expect(light.fogNear).toBeGreaterThan(dark.fogNear);
  });
});

import { parseOklch } from './oklch';
import type { ResolvedTheme } from './theme';

/**
 * The palette, as the 3D scene needs it.
 *
 * Colours are read from the stylesheet so `styles.css` stays the one place a
 * colour is decided. The numbers beside them — light intensities, fog
 * distances, opacities — are declared here instead, because they are scene
 * physics rather than palette: a light intensity in a stylesheet is a category
 * error, and a bare number in a custom property would have to be parsed back
 * out for no gain.
 */
export interface SceneTokens {
  stage: number;
  gridMajor: number;
  gridMinor: number;
  stageSky: number;
  stageBounce: number;
  stageKey: number;
  skin: number;
  eye: number;
  hair: number;
  hairEmissive: number;
  hairTarget: number;
  hairTargetEmissive: number;
  robotBase: number;
  robotLink: number;
  robotJoint: number;
  robotJointActive: number;
  robotTool: number;
  robotBlade: number;
  nodeReachable: number;
  nodePlanned: number;
  nodeBlocked: number;
  nodeBounds: number;
  blockMotion: number;
  blockLogic: number;
  blockLoop: number;
  ink: number;
  accent: number;
  shadowColor: number;

  /** Scene physics. Not palette — see the note above. */
  ambientIntensity: number;
  hemiIntensity: number;
  keyIntensity: number;
  fogNear: number;
  fogFar: number;
  shadowOpacity: number;
  targetVoxelOpacity: number;
  targetVoxelEmissive: number;
  hairEmissiveIntensity: number;
  jointActiveEmissive: number;
  toolEmissive: number;
  nodeReachableOpacity: number;
  nodeBlockedOpacity: number;
  boundsOpacity: number;
  pathOpacity: number;
}

/** Which custom property each colour comes from. */
const SOURCE = {
  stage: '--stage',
  gridMajor: '--stage-grid-major',
  gridMinor: '--stage-grid-minor',
  stageSky: '--stage-sky',
  stageBounce: '--stage-bounce',
  stageKey: '--stage-key',
  skin: '--skin',
  eye: '--eye',
  hair: '--hair',
  hairEmissive: '--hair-emissive',
  hairTarget: '--hair-target',
  hairTargetEmissive: '--hair-target-emissive',
  robotBase: '--robot-base',
  robotLink: '--robot-link',
  robotJoint: '--robot-joint',
  robotJointActive: '--robot-joint-active',
  robotTool: '--robot-tool',
  robotBlade: '--robot-blade',
  nodeReachable: '--node-reachable',
  nodePlanned: '--node-planned',
  nodeBlocked: '--node-blocked',
  nodeBounds: '--node-bounds',
  blockMotion: '--block-motion',
  blockLogic: '--block-logic',
  blockLoop: '--block-loop',
  ink: '--ink',
  accent: '--accent',
} as const;

type ColourName = keyof typeof SOURCE;

/**
 * What the stylesheet resolves to, baked.
 *
 * Used whenever a custom property comes back empty, which is every unit test:
 * jsdom does not resolve custom properties, so without this the scene renders
 * a field of `NaN`. `tests/unit/sceneTokens.test.ts` reads `styles.css` as text
 * and asserts these still agree with it, so the two cannot drift apart.
 */
const BAKED: Record<ResolvedTheme, Record<ColourName, number>> = {
  light: {
    stage: 0xe4eff0, gridMajor: 0xc3d3d3, gridMinor: 0xd7e2e2,
    stageSky: 0xe8f8ff, stageBounce: 0xb3c1c1, stageKey: 0xffffff,
    skin: 0xc8997b, eye: 0x252f37,
    hair: 0x8c5331, hairEmissive: 0x321200,
    hairTarget: 0x1d94b7, hairTargetEmissive: 0x267c98,
    robotBase: 0x778996, robotLink: 0x92a8b9, robotJoint: 0x00a1a0,
    robotJointActive: 0xed8712, robotTool: 0xd7352d, robotBlade: 0x828e97,
    nodeReachable: 0x0077a0, nodePlanned: 0xeab526, nodeBlocked: 0xd7352d,
    nodeBounds: 0x6a8590,
    blockMotion: 0x109392, blockLogic: 0x795bbf, blockLoop: 0xcb7d34,
    ink: 0x031818, accent: 0x007878,
  },
  dark: {
    stage: 0x041919, gridMajor: 0x264344, gridMinor: 0x122a2a,
    stageSky: 0xbde5f9, stageBounce: 0x0d1b1c, stageKey: 0xf1f8ff,
    skin: 0xcda58a, eye: 0x19232a,
    hair: 0x905a3a, hairEmissive: 0x290d00,
    hairTarget: 0x69c5e7, hairTargetEmissive: 0x388ca8,
    robotBase: 0x263844, robotLink: 0x657e90, robotJoint: 0x2abbba,
    robotJointActive: 0xfaaa49, robotTool: 0xf47062, robotBlade: 0xa8b6c3,
    nodeReachable: 0x40b4da, nodePlanned: 0xffcd56, nodeBlocked: 0xf47062,
    nodeBounds: 0x93b4c1,
    blockMotion: 0x079a99, blockLogic: 0x8263cb, blockLoop: 0xd48235,
    ink: 0xe7f3f3, accent: 0x39d7d5,
  },
};

/**
 * Scene physics per theme.
 *
 * A light stage is not the dark stage with a pale background. The key light
 * comes down and the hemisphere goes up, because on a near-white floor a
 * strong key pushes the arm into the tone-mapping roll-off and the silhouette
 * dissolves; the fill instead comes from the floor bouncing light back, which
 * is what the hemisphere's ground colour models. Fog retreats past the whole
 * working volume, because washing toward near-white destroys contrast where
 * washing toward near-black merely vignettes. And emissive glow is a
 * dark-mode device: on a bright ground self-illumination flattens the form
 * instead of lighting it, so the "this joint is active" signal is carried by
 * the teal-to-amber hue jump alone.
 */
const PHYSICS: Record<ResolvedTheme, Omit<SceneTokens, ColourName | 'shadowColor'>> = {
  light: {
    ambientIntensity: 0.62,
    hemiIntensity: 0.95,
    keyIntensity: 1.35,
    fogNear: 10,
    fogFar: 24,
    shadowOpacity: 0.16,
    // A ghost at 18% works against near-black because the luminance gap is
    // enormous; against a near-white stage the same 18% is a difference of
    // 0.06 and the target hairstyle disappears. But the ghost is drawn *over*
    // the current hair as well as over the stage, and past about a quarter it
    // stops reading as a ghost and starts repainting the hair: teal at 34% on
    // brown composites to a dead olive, and the hair loses its own colour.
    // 24% is the most it can take and still leave brown looking brown.
    targetVoxelOpacity: 0.24,
    targetVoxelEmissive: 0.04,
    hairEmissiveIntensity: 0.02,
    jointActiveEmissive: 0.06,
    toolEmissive: 0.05,
    nodeReachableOpacity: 0.48,
    nodeBlockedOpacity: 0.4,
    boundsOpacity: 0.3,
    pathOpacity: 0.9,
  },
  dark: {
    ambientIntensity: 0.78,
    hemiIntensity: 0.46,
    keyIntensity: 2.2,
    fogNear: 6,
    fogFar: 12,
    shadowOpacity: 0.42,
    targetVoxelOpacity: 0.18,
    targetVoxelEmissive: 0.18,
    hairEmissiveIntensity: 0.08,
    jointActiveEmissive: 0.22,
    toolEmissive: 0.18,
    nodeReachableOpacity: 0.35,
    nodeBlockedOpacity: 0.22,
    boundsOpacity: 0.38,
    pathOpacity: 0.82,
  },
};

/**
 * One `getComputedStyle` call and a couple of dozen parses.
 *
 * Called once per theme change, never per frame.
 */
export function readSceneTokens(theme: ResolvedTheme): SceneTokens {
  const computed = globalThis.getComputedStyle?.(document.documentElement);
  const baked = BAKED[theme];

  const colour = (name: ColourName): number => {
    const raw = computed?.getPropertyValue(SOURCE[name]) ?? '';
    return parseOklch(raw)?.hex ?? baked[name];
  };

  const colours = Object.fromEntries(
    (Object.keys(SOURCE) as ColourName[]).map((name) => [name, colour(name)]),
  ) as Record<ColourName, number>;

  return {
    ...colours,
    // The floor is a shadow-only material, so the shadow's darkness is a value
    // we choose rather than a by-product of the light ratio.
    shadowColor: theme === 'dark' ? 0x000000 : colours.ink,
    ...PHYSICS[theme],
  };
}

import * as Blockly from 'blockly/core';
import { toHex } from '../../theme/oklch';
import type { SceneTokens } from '../../theme/sceneTokens';
import type { ResolvedTheme } from '../../theme/theme';

/**
 * Blockly's palette, from the app's palette.
 *
 * Blockly cannot read a custom property: block colours are baked into SVG
 * `fill` attributes when a block renders, and the hue is used to *derive* the
 * shadow and border shades, so it has to arrive as a resolvable colour. That is
 * also why every block here uses `setStyle`, not `setColour` — a block that
 * names its own hex is permanently skipped by `workspace.setTheme()`, and would
 * keep the dark palette on a light stage. Styles are indirection through the
 * theme, so re-theming reaches them.
 */
export const BLOCK_STYLES = {
  motion: 'hcr_motion',
  logic: 'hcr_logic',
  loop: 'hcr_loop',
} as const;

export function blocklyThemeFor(
  theme: ResolvedTheme,
  tokens: SceneTokens,
): Blockly.Theme {
  const light = theme === 'light';
  return Blockly.Theme.defineTheme(`hcr-${theme}`, {
    name: `hcr-${theme}`,
    base: Blockly.Themes.Zelos,
    blockStyles: {
      [BLOCK_STYLES.motion]: {
        colourPrimary: toHex(tokens.blockMotion),
        hat: '',
      },
      [BLOCK_STYLES.logic]: { colourPrimary: toHex(tokens.blockLogic) },
      [BLOCK_STYLES.loop]: { colourPrimary: toHex(tokens.blockLoop) },
    },
    categoryStyles: {
      [BLOCK_STYLES.motion]: { colour: toHex(tokens.blockMotion) },
      [BLOCK_STYLES.logic]: { colour: toHex(tokens.blockLogic) },
      [BLOCK_STYLES.loop]: { colour: toHex(tokens.blockLoop) },
    },
    componentStyles: {
      workspaceBackgroundColour: toHex(tokens.stage),
      toolboxBackgroundColour: toHex(tokens.stage),
      toolboxForegroundColour: toHex(tokens.ink),
      flyoutBackgroundColour: toHex(tokens.stage),
      flyoutForegroundColour: toHex(tokens.ink),
      flyoutOpacity: light ? 0.96 : 0.92,
      scrollbarColour: toHex(tokens.nodeBounds),
      scrollbarOpacity: light ? 0.5 : 0.35,
      insertionMarkerColour: toHex(tokens.accent),
      insertionMarkerOpacity: light ? 0.5 : 0.4,
      cursorColour: toHex(tokens.accent),
    },
    fontStyle: { family: 'inherit', weight: 'inherit', size: 11 },
    startHats: false,
  });
}

/** The workspace grid, which is an inject option rather than a theme value. */
export function gridColourFor(tokens: SceneTokens): string {
  return toHex(tokens.gridMajor);
}

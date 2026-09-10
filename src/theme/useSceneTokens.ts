import { useMemo } from 'react';
import { readSceneTokens, type SceneTokens } from './sceneTokens';
import { useResolvedTheme } from './useTheme';

/**
 * The scene palette for the active theme.
 *
 * Memoised on the theme, so the `getComputedStyle` call and its two dozen
 * colour parses happen once per flip rather than once per frame.
 */
export function useSceneTokens(): SceneTokens {
  const theme = useResolvedTheme();
  return useMemo(() => readSceneTokens(theme), [theme]);
}

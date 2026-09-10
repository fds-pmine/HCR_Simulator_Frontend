import { useSyncExternalStore } from 'react';
import { THEME_CHANGE_EVENT, type ResolvedTheme } from './theme';

/**
 * The active theme, read from the same place the stylesheet reads it.
 *
 * `theme.ts` already owns the decision and writes it to `data-theme` on the
 * root element; CSS keys off that attribute. Subscribing to the attribute
 * rather than to `prefers-color-scheme` means there is one source of truth: a
 * media-query listener would ignore an explicit preference and light a dark
 * scene inside a light shell. A React context would work — react-three-fiber
 * does bridge context across the reconciler — but it would be a second copy of
 * a fact the DOM already holds, and any drift shows up as a 3D stage that
 * disagrees with the panels around it.
 */
function subscribe(onChange: () => void): () => void {
  const root = document.documentElement;
  root.addEventListener(THEME_CHANGE_EVENT, onChange);

  // Belt and braces. `applyTheme()` only fires the event when the value
  // actually changes, and a `system` user flipping the OS reaches it through
  // `watchSystemTheme()`. This second listener costs nothing and closes the
  // window where something calls `applyTheme()` before the listener attaches.
  const query = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  query?.addEventListener('change', onChange);

  return () => {
    root.removeEventListener(THEME_CHANGE_EVENT, onChange);
    query?.removeEventListener('change', onChange);
  };
}

/** Reads a dataset property: this runs on every render, so it stays O(1). */
function getSnapshot(): ResolvedTheme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'dark');
}

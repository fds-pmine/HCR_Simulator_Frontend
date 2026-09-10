export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'hcr.theme.v1';
export const THEME_CHANGE_EVENT = 'hcr:themechange';

export function readPreference(): ThemePreference {
  try {
    const url = new URLSearchParams(globalThis.location?.search ?? '');
    const q = url.get('theme');
    if (q === 'light' || q === 'dark' || q === 'system') return q;
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch { /* private mode, file://, jsdom — fall through */ }
  return 'system';
}

export function resolveTheme(pref = readPreference()): ResolvedTheme {
  if (pref === 'light' || pref === 'dark') return pref;
  // No `matchMedia` means jsdom or an ancient browser. Dark is the app's own
  // default, and it is the one the 3D stage was designed against.
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
    ? 'dark'
    : 'light';
}

export function applyTheme(pref = readPreference()): ResolvedTheme {
  const theme = resolveTheme(pref);
  const root = globalThis.document?.documentElement;
  if (root && root.dataset.theme !== theme) {
    root.dataset.theme = theme;
    root.dispatchEvent(
      new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme }, bubbles: true }),
    );
  }
  return theme;
}

export function setPreference(pref: ThemePreference): ResolvedTheme {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, pref); } catch { /* ignore */ }
  // `?theme=` outranks storage, which is what makes it useful for screenshots
  // and bug reports — but it would then outrank this click too, and the toggle
  // would look broken on exactly those URLs. Taking the parameter out on the
  // first deliberate choice hands control back to the person pressing it.
  try {
    const url = new URL(globalThis.location?.href ?? '');
    if (url.searchParams.has('theme')) {
      url.searchParams.delete('theme');
      globalThis.history?.replaceState(null, '', url);
    }
  } catch { /* no history API — the preference is still saved */ }
  return applyTheme(pref);
}

/** Re-resolve when the OS flips and the user is on `system`. */
export function watchSystemTheme(): () => void {
  const mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  if (!mq) return () => {};
  const onChange = () => { if (readPreference() === 'system') applyTheme(); };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

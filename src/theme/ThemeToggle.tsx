import { useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
  readPreference,
  setPreference,
  THEME_CHANGE_EVENT,
  type ThemePreference,
} from './theme';
import { useLocalization } from '../features/preferences/localization';

/**
 * Cycles system → light → dark → system.
 *
 * Three states rather than a two-way switch, because "match the system" is a
 * real answer and not the absence of one: a learner who has their laptop on a
 * schedule expects the app to follow it, and a two-way toggle has no way back
 * once it has been touched.
 */
const ORDER: readonly ThemePreference[] = ['system', 'light', 'dark'];

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

function subscribe(onChange: () => void): () => void {
  const root = document.documentElement;
  root.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => root.removeEventListener(THEME_CHANGE_EVENT, onChange);
}

export function ThemeToggle() {
  const { t } = useLocalization();
  // The preference lives in localStorage, which React cannot observe. The
  // theme-change event is the only moment it can have moved, and `setPreference`
  // always fires it.
  const preference = useSyncExternalStore(
    subscribe,
    readPreference,
    () => 'system' as ThemePreference,
  );
  const Icon = ICONS[preference];
  const label = {
    system: t('themeSystem'),
    light: t('themeLight'),
    dark: t('themeDark'),
  }[preference];

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => {
        setPreference(ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length]);
      }}
      aria-label={`${t('theme')}: ${label}`}
      title={`${t('theme')}: ${label}`}
    >
      <Icon size={16} />
    </button>
  );
}

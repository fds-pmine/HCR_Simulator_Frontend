import { clearIdentity } from '../match/identity';

export interface ResearchPreferences {
  /** Required participation signal for the study client. */
  programAndScores: boolean;
  /** Optional context controls, enabled by the primary Participate action. */
  language: boolean;
  utcOffset: boolean;
  /** Whether the person has answered the first-visit choice. */
  decided: boolean;
}

const STORAGE_KEY = 'hcr.research-preferences.v1';
const DEFAULT_PREFERENCES: ResearchPreferences = {
  programAndScores: false,
  language: false,
  utcOffset: false,
  decided: false,
};
let unpersistedPreferences: ResearchPreferences | undefined;

export function loadResearchPreferences(): ResearchPreferences {
  if (unpersistedPreferences) return unpersistedPreferences;
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<ResearchPreferences>;
    const legacyConsent = (parsed as { consent?: unknown }).consent === true;
    return {
      programAndScores: parsed.programAndScores ?? legacyConsent,
      language: parsed.language ?? legacyConsent,
      utcOffset: parsed.utcOffset ?? legacyConsent,
      decided: parsed.decided === true,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function saveResearchPreferences(
  preferences: ResearchPreferences,
): ResearchPreferences {
  const normalized = {
    programAndScores: preferences.programAndScores === true,
    language: preferences.language === true,
    utcOffset: preferences.utcOffset === true,
    decided: preferences.decided === true,
  };
  if (!normalized.programAndScores) {
    clearIdentity();
    try {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
    } catch {
      // The current-tab choice below still applies if storage is inaccessible.
    }
  }
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(normalized));
    unpersistedPreferences = undefined;
  } catch {
    unpersistedPreferences = normalized;
  }
  globalThis.dispatchEvent?.(new Event('hcr:research-preferences-changed'));
  return normalized;
}

export function resetResearchParticipation(): void {
  clearIdentity();
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
    unpersistedPreferences = undefined;
  } catch {
    unpersistedPreferences = DEFAULT_PREFERENCES;
  }
  globalThis.dispatchEvent?.(new Event('hcr:research-preferences-changed'));
}

/** Whole-hour/minute offset only; never an IANA zone or inferred location. */
export function currentUtcOffsetMinutes(date = new Date()): number {
  return -date.getTimezoneOffset();
}

export function primaryLanguage(language?: string): string {
  let selected = language;
  if (!selected) {
    try {
      selected = globalThis.localStorage?.getItem('hcr.locale.v1') ?? undefined;
    } catch {
      // Browser storage is optional; navigator language remains a safe fallback.
    }
  }
  selected ??= globalThis.navigator?.language;
  const primary = selected?.trim().split(/[-_]/, 1)[0]?.toLowerCase();
  return primary && /^[a-z]{2,3}$/.test(primary) ? primary : 'und';
}

/**
 * Marks whether an operational submission may also enter the research dataset.
 * Language and offset are omitted entirely unless the user opted in.
 */
export function researchHeaders(): Record<string, string> {
  const preferences = loadResearchPreferences();
  return {
    'X-HCR-Research-Program-And-Scores': preferences.programAndScores
      ? 'granted'
      : 'declined',
    'X-HCR-Research-Language-Consent': preferences.language
      ? 'granted'
      : 'declined',
    'X-HCR-Research-Utc-Offset-Consent': preferences.utcOffset
      ? 'granted'
      : 'declined',
    ...(preferences.language
      ? { 'X-HCR-Research-Language': primaryLanguage() }
      : {}),
    ...(preferences.utcOffset
      ? {
          'X-HCR-Research-Utc-Offset-Minutes': String(
            currentUtcOffsetMinutes(),
          ),
        }
      : {}),
  };
}

export function anyResearchEnabled(preferences: ResearchPreferences): boolean {
  return (
    preferences.programAndScores || preferences.language || preferences.utcOffset
  );
}

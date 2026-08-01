/**
 * Who this browser plays as.
 *
 * The id is generated locally and kept in `localStorage` so a reload rejoins as
 * the same player. That is enough for a dev server and for offline practice, and
 * it is deliberately **not** enough for anything else: a real deployment derives
 * identity from an authenticated token and ignores what the client claims. The
 * display name is cosmetic either way.
 */
export interface PlayerIdentity {
  playerId: string;
  displayName: string;
}

const STORAGE_KEY = 'hcr.identity.v1';

const NAME_PARTS = [
  'Clipper',
  'Fade',
  'Taper',
  'Shear',
  'Razor',
  'Comb',
  'Buzz',
  'Crest',
];

export const MAX_NAME_LENGTH = 18;

/** Read the stored identity, minting one on first run. */
export function loadIdentity(): PlayerIdentity {
  const stored = readStorage();
  if (stored) {
    return stored;
  }
  const identity = {
    playerId: `u-${randomId()}`,
    displayName: `${pick(NAME_PARTS)}${100 + Math.floor(Math.random() * 900)}`,
  };
  saveIdentity(identity);
  return identity;
}

/** Persist an identity, ignoring a storage that refuses to cooperate. */
export function saveIdentity(identity: PlayerIdentity): PlayerIdentity {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Private browsing, a full quota, or no storage at all. The identity still
    // works for this tab; only its persistence is lost.
  }
  return identity;
}

/** Trim and clamp a name the player typed, refusing to produce an empty one. */
export function normalizeDisplayName(
  raw: string,
  fallback: string,
): string {
  const trimmed = raw.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : fallback;
}

/** Two-letter monogram for a roster avatar. */
export function initialsOf(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return '??';
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

function readStorage(): PlayerIdentity | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) {
      return undefined;
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as PlayerIdentity).playerId === 'string' &&
      typeof (parsed as PlayerIdentity).displayName === 'string'
    ) {
      return parsed as PlayerIdentity;
    }
  } catch {
    // Corrupt or unreadable: fall through and mint a fresh identity.
  }
  return undefined;
}

function randomId(): string {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
}

function pick(values: readonly string[]): string {
  return values[Math.floor(Math.random() * values.length)] ?? 'Stylist';
}

import type { MatchProvider, SessionProvider } from '../services/contracts';

/**
 * A match provider that fails every call.
 *
 * For tests about screens that must never touch a round — rendering the menu,
 * loading a solo challenge. A stub that throws makes an accidental call a test
 * failure instead of a silent no-op.
 */
export function unusedMatchProvider(
  kind: MatchProvider['kind'] = 'practice',
): MatchProvider {
  const refuse = () => {
    throw new Error('The match provider was not expected to be used here.');
  };
  return {
    kind,
    setPlayer: () => {},
    createMatch: refuse,
    joinMatch: refuse,
    startMatch: refuse,
    getMatch: refuse,
    getMatchChallenge: refuse,
    getResults: refuse,
    submit: refuse,
    syncClock: refuse,
  };
}

/** A session provider that fails every call, for screens that must not practise. */
export function unusedSessionProvider(): SessionProvider {
  const refuse = () => {
    throw new Error('The session provider was not expected to be used here.');
  };
  return {
    kind: 'fixed',
    start: refuse,
    next: refuse,
    submit: refuse,
    respond: refuse,
    finalize: refuse,
  };
}

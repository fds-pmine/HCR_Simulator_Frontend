import { LocalChallengeProvider } from '../services/local/LocalChallengeProvider';
import { LocalMatchProvider } from '../services/local/LocalMatchProvider';
import { LocalSessionProvider } from '../services/local/LocalSessionProvider';
import { LocalScoreProvider } from '../services/local/LocalScoreProvider';
import { createHttpServices, readBackendConfig } from '../services/http/config';
import type { AppServices } from './servicesContext';

function localServices(): AppServices {
  const challengeProvider = new LocalChallengeProvider();
  return {
    challengeProvider,
    scoreProvider: new LocalScoreProvider(),
    // Offline rounds are practice against local bots — see LocalMatchProvider.
    matchProvider: new LocalMatchProvider(challengeProvider),
    // No CAT engine in the browser: the lessons in order, which is the same
    // shape without claiming to be a measurement.
    sessionProvider: new LocalSessionProvider(),
  };
}

/**
 * Pick the provider set for this deployment.
 *
 * Local unless `VITE_HCR_API_BASE_URL` is configured, so the simulator makes no
 * network requests by default. Both sets satisfy the same interfaces, so nothing
 * downstream — workbench, engine, scoring, versus UI — can tell which is in use.
 * The one place the difference is deliberately visible is `MatchProvider.kind`,
 * which the UI reads to label a practice round as practice.
 *
 * Lives outside `providers.tsx` so that file exports only its component, which
 * is what React Fast Refresh needs.
 */
export function resolveServices(): AppServices {
  const config = readBackendConfig();
  return config ? createHttpServices(config) : localServices();
}

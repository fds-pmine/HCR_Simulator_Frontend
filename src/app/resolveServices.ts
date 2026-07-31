import { LocalChallengeProvider } from '../services/local/LocalChallengeProvider';
import { LocalScoreProvider } from '../services/local/LocalScoreProvider';
import { createHttpServices, readBackendConfig } from '../services/http/config';
import type { AppServices } from './servicesContext';

const localServices: AppServices = {
  challengeProvider: new LocalChallengeProvider(),
  scoreProvider: new LocalScoreProvider(),
};

/**
 * Pick the provider pair for this deployment.
 *
 * Local unless `VITE_HCR_API_BASE_URL` is configured, so the simulator makes no
 * network requests by default. Both pairs satisfy the same interfaces, so
 * nothing downstream — workbench, engine, scoring — can tell which is in use.
 *
 * Lives outside `providers.tsx` so that file exports only its component, which
 * is what React Fast Refresh needs.
 */
export function resolveServices(): AppServices {
  const config = readBackendConfig();
  return config ? createHttpServices(config) : localServices;
}

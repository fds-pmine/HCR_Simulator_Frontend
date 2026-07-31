import { ApiClient } from './apiClient';
import { HttpChallengeProvider } from './HttpChallengeProvider';
import { HttpScoreProvider } from './HttpScoreProvider';
import type { AppServices } from '../../app/servicesContext';

/**
 * Backend configuration, read from Vite environment variables.
 *
 * Absent by default. The simulator stays fully offline unless a deployment opts
 * in by setting `VITE_HCR_API_BASE_URL`, which keeps the v1 promise that the app
 * creates no network requests of its own.
 */
export interface BackendConfig {
  baseUrl: string;
  token?: string;
}

export function readBackendConfig(
  env: ImportMetaEnv = import.meta.env,
): BackendConfig | undefined {
  const baseUrl = env.VITE_HCR_API_BASE_URL?.trim();
  if (!baseUrl) {
    return undefined;
  }
  const token = env.VITE_HCR_API_TOKEN?.trim();
  return token ? { baseUrl, token } : { baseUrl };
}

/** Build the remote provider pair. */
export function createHttpServices(config: BackendConfig): AppServices {
  const client = new ApiClient(config);
  return {
    challengeProvider: new HttpChallengeProvider(client),
    scoreProvider: new HttpScoreProvider(client),
  };
}

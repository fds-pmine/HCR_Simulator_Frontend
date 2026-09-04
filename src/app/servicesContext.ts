import { createContext, useContext } from 'react';
import type {
  ChallengeProvider,
  MatchProvider,
  ScoreProvider,
  SessionProvider,
  UsageProvider,
} from '../services/contracts';

export interface AppServices {
  challengeProvider: ChallengeProvider;
  scoreProvider: ScoreProvider;
  matchProvider: MatchProvider;
  sessionProvider: SessionProvider;
  /** Lesson usage, when the deployment collects any. Offline: a no-op. */
  usageProvider: UsageProvider;
}

export const ServicesContext = createContext<AppServices | null>(null);

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) {
    throw new Error('App services are not available.');
  }
  return services;
}

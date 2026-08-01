import { createContext, useContext } from 'react';
import type {
  ChallengeProvider,
  MatchProvider,
  ScoreProvider,
  SessionProvider,
} from '../services/contracts';

export interface AppServices {
  challengeProvider: ChallengeProvider;
  scoreProvider: ScoreProvider;
  matchProvider: MatchProvider;
  sessionProvider: SessionProvider;
}

export const ServicesContext = createContext<AppServices | null>(null);

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) {
    throw new Error('App services are not available.');
  }
  return services;
}

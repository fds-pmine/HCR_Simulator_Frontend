import type { PropsWithChildren } from 'react';
import { resolveServices } from './resolveServices';
import {
  ServicesContext,
  type AppServices,
} from './servicesContext';

interface AppProvidersProps extends PropsWithChildren {
  services?: AppServices;
}

export function AppProviders({
  children,
  services,
}: AppProvidersProps) {
  return (
    <ServicesContext.Provider value={services ?? resolveServices()}>
      {children}
    </ServicesContext.Provider>
  );
}

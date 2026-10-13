import { GameShell } from './GameShell';
import { AppProviders } from './providers';
import { LocalizationProvider } from '../features/preferences/localization';
import { ResearchParticipationGate } from '../features/preferences/ResearchParticipationGate';
import { AppErrorBoundary } from './AppErrorBoundary';

export function App() {
  return (
    <LocalizationProvider>
      <AppErrorBoundary>
        <ResearchParticipationGate>
          <AppProviders>
            <GameShell />
          </AppProviders>
        </ResearchParticipationGate>
      </AppErrorBoundary>
    </LocalizationProvider>
  );
}

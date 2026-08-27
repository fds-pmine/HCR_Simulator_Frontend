import { GameShell } from './GameShell';
import { AppProviders } from './providers';
import { LocalizationProvider } from '../features/preferences/localization';
import { ResearchParticipationGate } from '../features/preferences/ResearchParticipationGate';

export function App() {
  return (
    <LocalizationProvider>
      <ResearchParticipationGate>
        <AppProviders>
          <GameShell />
        </AppProviders>
      </ResearchParticipationGate>
    </LocalizationProvider>
  );
}

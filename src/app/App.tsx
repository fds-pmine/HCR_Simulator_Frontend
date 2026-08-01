import { GameShell } from './GameShell';
import { AppProviders } from './providers';

export function App() {
  return (
    <AppProviders>
      <GameShell />
    </AppProviders>
  );
}

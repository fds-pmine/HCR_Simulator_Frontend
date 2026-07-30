import { Terminal, X } from 'lucide-react';
import type { SimulationLogEntry } from '../../features/simulation/SimulationEngine';

interface LogDrawerProps {
  logs: readonly SimulationLogEntry[];
  open: boolean;
  onToggle: () => void;
}

export function LogDrawer({ logs, open, onToggle }: LogDrawerProps) {
  const latest = logs.at(-1);

  return (
    <section
      className={`log-drawer ${open ? 'is-open' : ''}`}
      aria-label="Simulation event log"
    >
      <button
        type="button"
        className="log-drawer__summary"
        onClick={onToggle}
        aria-expanded={open}
        data-testid="log-toggle"
      >
        <Terminal size={15} />
        <span>EVENT LOG</span>
        <p>{latest?.message ?? 'Waiting for simulation events…'}</p>
        <small>{logs.length} EVENTS</small>
      </button>
      {open ? (
        <div className="log-drawer__body" data-testid="event-log">
          <div className="log-drawer__title">
            <span>Event Log · Latest {logs.length} Events</span>
            <button
              type="button"
              onClick={onToggle}
              aria-label="Close event log"
            >
              <X size={15} />
            </button>
          </div>
          <ol>
            {[...logs].reverse().map((entry) => (
              <li key={entry.id} data-type={entry.type}>
                <time>
                  {(entry.simulationTimeMs / 1_000).toFixed(2)}s
                </time>
                <span>{entry.message}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

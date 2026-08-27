import { Terminal, X } from 'lucide-react';
import type { SimulationLogEntry } from '../../features/simulation/SimulationEngine';
import { useLocalization } from '../../features/preferences/localization';

interface LogDrawerProps {
  logs: readonly SimulationLogEntry[];
  open: boolean;
  onToggle: () => void;
}

export function LogDrawer({ logs, open, onToggle }: LogDrawerProps) {
  const { t } = useLocalization();
  const latest = logs.at(-1);

  return (
    <section
      className={`log-drawer ${open ? 'is-open' : ''}`}
      aria-label={t('eventLog')}
    >
      <button
        type="button"
        className="log-drawer__summary"
        onClick={onToggle}
        aria-expanded={open}
        data-testid="log-toggle"
      >
        <Terminal size={15} />
        <span>{t('eventLog')}</span>
        <p>{latest?.message ?? t('waitingEvents')}</p>
        <small>{logs.length} {t('events')}</small>
      </button>
      {open ? (
        <div className="log-drawer__body" data-testid="event-log">
          <div className="log-drawer__title">
            <span>{t('eventLog')} · {logs.length} {t('events')}</span>
            <button
              type="button"
              onClick={onToggle}
              aria-label={t('closeEventLog')}
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

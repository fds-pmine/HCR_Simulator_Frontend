import { Component, type PropsWithChildren } from 'react';
import { useLocalization } from '../features/preferences/localization';

export class AppErrorBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed
      ? <ErrorRecovery onRecover={() => this.setState({ failed: false })} />
      : this.props.children;
  }
}

export function ErrorRecovery({ onRecover }: { onRecover: () => void }) {
  const { t } = useLocalization();
  return (
    <main className="research-entry research-entry--declined">
      <section className="research-exit" role="alert">
        <h1>{t('appErrorTitle')}</h1>
        <p>{t('appErrorBody')}</p>
        <button type="button" className="big-button big-button--primary" onClick={onRecover}>
          {t('backToMenu')}
        </button>
      </section>
    </main>
  );
}

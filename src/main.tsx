import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyTheme, watchSystemTheme } from './theme/theme';
import './styles.css';

// Stamped before React so the first paint is already in the right theme. The
// usual trick — a blocking inline script in index.html — is not available:
// `public/_headers` ships `script-src 'self'` with no `'unsafe-inline'`.
applyTheme();
watchSystemTheme();

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

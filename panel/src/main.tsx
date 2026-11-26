import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/fonts.css';
import './theme/tokens.css';
import './theme/base.css';
import './theme/layout.css';
import { loadCockpit } from './api/cockpit';

/*
 * Boot: connect to Cockpit first (user, OS info), then render. If cockpit.js
 * is missing we show a plain message instead of a blank page.
 */
const el = document.getElementById('root')!;
const root = createRoot(el);

loadCockpit()
  .then(async () => {
    const { App } = await import('./App');
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((err: unknown) => {
    root.render(
      <div className="empty" role="alert">
        <h2>Mirkomil Panel</h2>
        <p>{err instanceof Error ? err.message : String(err)}</p>
      </div>,
    );
  });

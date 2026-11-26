import { ExternalLink } from 'lucide-react';
import { cockpit } from '@/api/cockpit';
import { useT } from '@/i18n';
import type { PageProps } from './registry';

/*
 * Cockpit's own terminal (a documented, stable component) embedded in an
 * iframe — we never write our own terminal. Same origin, so the frame works
 * under Cockpit's CSP. The panel is Cockpit's shell now, so "full screen"
 * opens the component itself in a new tab.
 */
export default function TerminalPage(_props: PageProps) {
  const { t } = useT();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('terminal.title')}</h1>
          <p className="muted">{t('terminal.note')}</p>
        </div>
        <a className="btn" href="../system/terminal.html" target="_blank" rel="noopener">
          <ExternalLink size={16} /> {t('terminal.newTab')}
        </a>
      </div>
      {cockpit().__mock ? (
        <div className="card muted">Dev mode: terminal is available inside Cockpit.</div>
      ) : (
        <iframe className="terminal-frame" src="../system/terminal.html" title={t('terminal.title')} />
      )}
    </>
  );
}

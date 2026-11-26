import { Maximize2 } from 'lucide-react';
import { cockpit } from '@/api/cockpit';
import { useT } from '@/i18n';
import type { PageProps } from './registry';

/*
 * Cockpit's own terminal (a documented, stable component) embedded in an
 * iframe — we never write our own terminal. Same origin, so the frame works
 * under Cockpit's CSP. "Full screen" jumps to Cockpit's terminal page.
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
        <button className="btn" onClick={() => cockpit().jump('/system/terminal')}>
          <Maximize2 size={16} /> {t('terminal.open')}
        </button>
      </div>
      {cockpit().__mock ? (
        <div className="card muted">Dev mode: terminal is available inside Cockpit.</div>
      ) : (
        <iframe className="terminal-frame" src="../system/terminal.html" title={t('terminal.title')} />
      )}
    </>
  );
}

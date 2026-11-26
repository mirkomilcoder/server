import { useEffect, useState } from 'react';
import { ExternalLink, Folder } from 'lucide-react';
import { cockpit } from '@/api/cockpit';
import { useT } from '@/i18n';
import type { PageProps } from './registry';

/*
 * File manager = Cockpit's own "Files" component (package cockpit-files,
 * installed by the installer), embedded like the terminal. It already
 * respects the user's permissions and administrative access, so we don't
 * write a second file manager.
 */
export default function FilesPage(_props: PageProps) {
  const { t } = useT();
  const [installed, setInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    if (cockpit().__mock) return setInstalled(false);
    fetch('../files/manifest.json', { credentials: 'same-origin' })
      .then((r) => setInstalled(r.ok))
      .catch(() => setInstalled(false));
  }, []);

  return (
    <>
      <div className="page-head">
        <h1>{t('nav.files')}</h1>
        {installed && (
          <a className="btn" href="../files/index.html" target="_blank" rel="noopener">
            <ExternalLink size={16} /> {t('terminal.newTab')}
          </a>
        )}
      </div>
      {installed ? (
        <iframe className="terminal-frame files-frame" src="../files/index.html" title={t('nav.files')} />
      ) : (
        <div className="card">
          <div className="empty">
            <div className="empty__icon"><Folder size={28} strokeWidth={1.8} /></div>
            <h2>{t('nav.files')}</h2>
            <p>{installed === null ? t('common.loading') : t('files.missing')}</p>
            {installed === false && <code className="mono">sudo mirkomil repair</code>}
          </div>
        </div>
      )}
    </>
  );
}

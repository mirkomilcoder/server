import { ExternalLink, Folder } from 'lucide-react';
import { cockpit } from '@/api/cockpit';
import { useT } from '@/i18n';
import type { PageProps } from './registry';

/*
 * File manager = Cockpit's own "Files" component (package cockpit-files,
 * installed by the installer). We open it instead of writing a second file
 * manager: it already respects the user's permissions and admin mode.
 */
export default function FilesPage(_props: PageProps) {
  const { t } = useT();
  return (
    <div className="card">
      <div className="empty">
        <div className="empty__icon">
          <Folder size={28} strokeWidth={1.8} />
        </div>
        <h2>{t('nav.files')}</h2>
        <p>{t('files.body')}</p>
        <button className="btn btn--accent" onClick={() => cockpit().jump('/files')}>
          <ExternalLink size={16} /> {t('files.open')}
        </button>
      </div>
    </div>
  );
}

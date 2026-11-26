import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useT } from '@/i18n';
import { PAGES, pageById, type PageId } from '@/pages/registry';
import { Modal } from './Modal';

/* Phone navigation (≤720px): 4 main pages + "More" sheet with the rest. */

const PRIMARY: PageId[] = ['dashboard', 'monitoring', 'deploy', 'terminal'];

export function TabBar({ page, go }: { page: PageId; go: (id: PageId) => void }) {
  const { t } = useT();
  const [more, setMore] = useState(false);
  const inMore = !PRIMARY.includes(page);

  return (
    <>
      <nav className="tabbar" aria-label="Menu">
        {PRIMARY.map((id) => {
          const p = pageById(id);
          return (
            <button key={id} className={`tabbar__btn${page === id ? ' tabbar__btn--active' : ''}`} onClick={() => go(id)}>
              <p.icon size={20} strokeWidth={1.9} aria-hidden />
              {t(p.label)}
            </button>
          );
        })}
        <button className={`tabbar__btn${inMore ? ' tabbar__btn--active' : ''}`} onClick={() => setMore(true)}>
          <MoreHorizontal size={20} aria-hidden />
          {t('nav.more')}
        </button>
      </nav>
      <Modal open={more} onClose={() => setMore(false)} title={t('nav.more')}>
        <div style={{ display: 'grid', gap: 6 }}>
          {PAGES.filter((p) => !PRIMARY.includes(p.id)).map((p) => (
            <button
              key={p.id}
              className={`nav-item${p.danger ? ' nav-item--danger' : ''}`}
              onClick={() => {
                setMore(false);
                go(p.id);
              }}
            >
              <p.icon size={18} aria-hidden />
              <span className="nav-item__label">{t(p.label)}</span>
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}

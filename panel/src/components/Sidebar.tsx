import { motion } from 'framer-motion';
import { PanelLeftClose, PanelLeftOpen, Server } from 'lucide-react';
import { useT } from '@/i18n';
import { useSystem } from '@/state/system';
import { useSettings } from '@/state/settings';
import { useMotion } from '@/theme/motion';
import { PAGES, type PageDef, type PageId } from '@/pages/registry';

interface Props {
  page: PageId;
  go: (id: PageId) => void;
  /** Optional counters per page, e.g. { bots: '3/4', updates: '4' }. */
  badges?: Partial<Record<PageId, { text: string; tone: 'success' | 'warning' }>>;
}

export function Sidebar({ page, go, badges = {} }: Props) {
  const { t } = useT();
  const sys = useSystem();
  const { settings, update } = useSettings();
  const m = useMotion();
  const collapsed = settings.sidebarCollapsed;

  const item = (p: PageDef) => {
    const active = p.id === page;
    const badge = badges[p.id];
    return (
      <button
        key={p.id}
        className={`nav-item${active ? ' nav-item--active' : ''}${p.danger ? ' nav-item--danger' : ''}`}
        onClick={() => go(p.id)}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? t(p.label) : undefined}
      >
        {/* the active background slides between items (shared layoutId) */}
        {active && <motion.span layoutId="nav-active" className="nav-item__active-bg" transition={m.spring} />}
        <p.icon size={18} strokeWidth={1.9} aria-hidden />
        <span className="nav-item__label">{t(p.label)}</span>
        {badge && <span className={`badge badge--${badge.tone}`}>{badge.text}</span>}
      </button>
    );
  };

  return (
    <nav className="sidebar" aria-label="Menu">
      <div className="brand">
        <div className="brand__logo">
          <Server size={20} strokeWidth={2} />
        </div>
        <div className="brand__text">
          <div className="brand__name">{t('app.name')}</div>
          <div className="brand__host">
            {sys.hostname} · {sys.os}
          </div>
        </div>
      </div>
      <div className="sidebar__label">{t('nav.section.main')}</div>
      {PAGES.filter((p) => p.section === 'main').map(item)}
      <div className="sidebar__spacer" />
      {PAGES.filter((p) => p.section === 'bottom').map(item)}
      <button
        className="nav-item"
        onClick={() => update({ sidebarCollapsed: !collapsed })}
        title={t(collapsed ? 'nav.expand' : 'nav.collapse')}
      >
        {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        <span className="nav-item__label">{t(collapsed ? 'nav.expand' : 'nav.collapse')}</span>
      </button>
    </nav>
  );
}

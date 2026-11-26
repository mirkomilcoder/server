import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, PanelLeftClose, PanelLeftOpen, Server } from 'lucide-react';
import { useT } from '@/i18n';
import { useSettings } from '@/state/settings';
import { useMotion } from '@/theme/motion';
import { useBrand, useGuardian } from '@/state/guardian';
import { pagesFor, type NavGroup, type PageDef, type PageId } from '@/pages/registry';
import { BrandMark } from './BrandMark';

interface Props {
  page: PageId;
  go: (id: PageId) => void;
}

/*
 * Grouped navigation (matches the design): main items, an expandable
 * "Server" submenu, SERVER BOSHQARUVI, DEVELOPER, settings and a brand card.
 */
export function Sidebar({ page, go }: Props) {
  const { t } = useT();
  const { settings, update } = useSettings();
  const m = useMotion();
  const { brand, domain } = useBrand();
  const collapsed = settings.sidebarCollapsed;
  const PAGES = pagesFor(useGuardian().me?.role);
  const serverPages = PAGES.filter((p) => p.group === 'server');
  const inServer = serverPages.some((p) => p.id === page);
  const [serverOpen, setServerOpen] = useState(inServer);
  const open = serverOpen || inServer;

  const item = (p: PageDef, sub = false) => {
    const active = p.id === page;
    return (
      <button
        key={p.id}
        className={`nav-item${sub ? ' nav-item--sub' : ''}${active ? ' nav-item--active' : ''}${p.danger ? ' nav-item--danger' : ''}`}
        onClick={() => go(p.id)}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? t(p.label) : undefined}
      >
        {/* the active background glides between items (shared layoutId) */}
        {active && <motion.span layoutId="nav-active" className="nav-item__active-bg" transition={m.spring} />}
        <p.icon size={sub ? 17 : 19} strokeWidth={1.85} aria-hidden />
        <span className="nav-item__label">{t(p.label)}</span>
        {p.live && (
          <span className="live-pill">
            <span className="dot dot--success dot--live" aria-hidden />
            {t('nav.live')}
          </span>
        )}
      </button>
    );
  };

  const group = (g: NavGroup) => PAGES.filter((p) => p.group === g).map((p) => item(p));

  return (
    <nav className="sidebar" aria-label="Menu">
      <div className="brand">
        <BrandMark size={42} />
        <div className="brand__text">
          <div className="brand__name">{brand}</div>
          <div className="brand__host">{domain}</div>
        </div>
      </div>

      {item(PAGES[0])}
      <button
        className={`nav-item${inServer && !open ? ' nav-item--active-soft' : ''}`}
        onClick={() => setServerOpen(!open)}
        aria-expanded={open}
        title={collapsed ? t('nav.server') : undefined}
      >
        <Server size={19} strokeWidth={1.85} aria-hidden />
        <span className="nav-item__label">{t('nav.server')}</span>
        <ChevronDown size={16} className={`nav-item__chevron${open ? ' is-open' : ''}`} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="nav-sub"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: m.dur(0.22), ease: [0.2, 0.8, 0.2, 1] }}
          >
            {serverPages.map((p) => item(p, true))}
          </motion.div>
        )}
      </AnimatePresence>
      {group('main').slice(1)}

      <div className="sidebar__label">{t('nav.section.manage')}</div>
      {group('manage')}

      <div className="sidebar__label">{t('nav.section.dev')}</div>
      {group('dev')}

      <div className="sidebar__divider" />
      {group('bottom')}
      <button
        className="nav-item nav-item--quiet"
        onClick={() => update({ sidebarCollapsed: !collapsed })}
        title={t(collapsed ? 'nav.expand' : 'nav.collapse')}
      >
        {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
        <span className="nav-item__label">{t(collapsed ? 'nav.expand' : 'nav.collapse')}</span>
      </button>

      <div className="sidebar__spacer" />
      <div className="brand-card" aria-hidden>
        <svg className="brand-card__peaks" viewBox="0 0 200 60" preserveAspectRatio="none">
          <defs>
            <linearGradient id="peak" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--accent)', stopOpacity: 0.55 }} />
              <stop offset="1" style={{ stopColor: 'var(--accent)', stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <path d="M0 60 L38 26 L58 40 L92 8 L122 34 L146 20 L200 54 L200 60 Z" fill="url(#peak)" />
          <path d="M0 60 L38 26 L58 40 L92 8 L122 34 L146 20 L200 54" fill="none" stroke="var(--accent)" strokeWidth="1.2" strokeOpacity=".8" />
        </svg>
        <div className="brand-card__name">{brand}</div>
        <div className="brand-card__tag">
          <span className="dot dot--success" /> {t('brand.footer')}
        </div>
      </div>
    </nav>
  );
}

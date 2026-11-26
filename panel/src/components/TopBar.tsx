import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Bell, ChevronDown, LogOut, Moon, Search, Settings, Sun, XCircle } from 'lucide-react';
import { cockpit } from '@/api/cockpit';
import { useT, type TranslationKey } from '@/i18n';
import { useAlerts, useGuardian } from '@/state/guardian';
import { useSettings } from '@/state/settings';
import { useSystem } from '@/state/system';
import { useMotion } from '@/theme/motion';
import type { PageId } from '@/pages/registry';
import { ModeSwitch } from './ModeSwitch';

/* Search (opens Ctrl+K palette) · notifications · theme · account menu. */

function Popover({ open, onClose, children, className = '' }: { open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const m = useMotion();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          className={`popover ${className}`}
          role="menu"
          initial={{ opacity: 0, y: m.reduced ? 0 : -6, scale: m.reduced ? 1 : 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: m.reduced ? 0 : -4 }}
          transition={{ duration: m.dur(0.16) }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function TopBar({ onSearch, go }: { onSearch: () => void; go: (id: PageId) => void }) {
  const { t } = useT();
  const sys = useSystem();
  const { me } = useGuardian();
  const alerts = useAlerts();
  const { update } = useSettings();
  const [menu, setMenu] = useState<'bell' | 'user' | null>(null);
  const close = () => setMenu(null);

  const dark = document.documentElement.dataset.theme !== 'light';
  // admin = Guardian role, or (without the agent) Cockpit's administrative access
  const role = me?.role ?? (sys.admin ? 'admin' : 'none');
  const initial = (sys.displayName || sys.userName).charAt(0).toUpperCase();

  return (
    <header className="topbar">
      <button className="search-btn" onClick={onSearch} aria-keyshortcuts="Control+K">
        <Search size={18} aria-hidden />
        <span className="search-btn__text">{t('top.search')}</span>
        <span className="kbd">Ctrl + K</span>
      </button>

      <div className="topbar__actions">
        <div className="pop-anchor">
          <button className="icon-btn icon-btn--lg" aria-label={t('top.notifications')} aria-expanded={menu === 'bell'} onClick={() => setMenu(menu === 'bell' ? null : 'bell')}>
            <Bell size={19} />
            {alerts.length > 0 && <span className="count-badge">{alerts.length}</span>}
          </button>
          <Popover open={menu === 'bell'} onClose={close} className="popover--wide">
            <div className="popover__head">{t('top.notifications')}</div>
            {alerts.length === 0 ? (
              <div className="popover__empty">{t('top.noNotifications')}</div>
            ) : (
              alerts.map((a) => (
                <div className="popover__item" key={a.id}>
                  {a.severity === 'crit' ? <XCircle size={17} className="c-danger" /> : <AlertTriangle size={17} className="c-warning" />}
                  <span>
                    <span className="popover__title">{a.title}</span>
                    {a.detail && <span className="popover__meta">{a.detail}</span>}
                  </span>
                </div>
              ))
            )}
            <button className="popover__foot" onClick={() => { close(); go('monitoring'); }}>{t('top.viewAll')}</button>
          </Popover>
        </div>

        <button
          className="icon-btn icon-btn--lg"
          aria-label={t('top.theme')}
          title={t('top.theme')}
          onClick={() => update({ theme: dark ? 'light' : 'dark' })}
        >
          {dark ? <Sun size={19} /> : <Moon size={19} />}
        </button>

        <div className="pop-anchor">
          <button className="user-chip" aria-expanded={menu === 'user'} aria-label={t('top.account')} onClick={() => setMenu(menu === 'user' ? null : 'user')}>
            <span className="avatar">
              {initial}
              <span className="avatar__status" aria-hidden />
            </span>
            <span className="user-chip__text">
              <span className="user-chip__name">{sys.displayName}</span>
              <span className="user-chip__role">{t(`role.${role}` as TranslationKey)}</span>
            </span>
            <ChevronDown size={16} aria-hidden />
          </button>
          <Popover open={menu === 'user'} onClose={close}>
            <div className="popover__head">
              {sys.userName}@{sys.hostname}
            </div>
            <div className="popover__section">
              <div className="popover__meta" style={{ marginBottom: 8 }}>{t('settings.mode')}</div>
              <ModeSwitch />
            </div>
            <button className="popover__item popover__item--btn" onClick={() => { close(); go('settings'); }}>
              <Settings size={17} /> {t('nav.settings')}
            </button>
            <button className="popover__item popover__item--btn c-danger" onClick={() => cockpit().logout(true)}>
              <LogOut size={17} /> {t('top.logout')}
            </button>
          </Popover>
        </div>
      </div>
    </header>
  );
}

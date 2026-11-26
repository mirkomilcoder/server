import { Search } from 'lucide-react';
import { formatToday, useT } from '@/i18n';
import { useSystem } from '@/state/system';
import { useSettings } from '@/state/settings';
import { ModeSwitch } from './ModeSwitch';

/* Greeting + date line, search (opens the command palette), mode switch. */
export function TopBar({ onSearch, title }: { onSearch: () => void; title?: string }) {
  const { t, locale } = useT();
  const sys = useSystem();
  const { settings } = useSettings();

  return (
    <header className="topbar">
      <div>
        <h1 className="topbar__title">{title ?? t('top.greeting', { name: sys.displayName })}</h1>
        <p className="topbar__sub">
          {formatToday(locale)} · {t('top.refreshNote', { s: settings.refreshMs / 1000 })}
        </p>
      </div>
      <div className="topbar__actions">
        <button className="search-btn" onClick={onSearch} aria-keyshortcuts="Control+K">
          <Search size={16} aria-hidden />
          <span className="search-btn__text">{t('top.search')}</span>
          <span className="kbd">Ctrl K</span>
        </button>
        <ModeSwitch />
      </div>
    </header>
  );
}

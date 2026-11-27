import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { cockpit } from '@/api/cockpit';
import { useT } from '@/i18n';

/*
 * Cockpit keeps the panel's start page for the whole login session, so after an
 * update (installer or `mirkomil update`) an open session would keep running the
 * old version — reloading doesn't help, only a new login does. We compare the
 * bundle we run with the one the server has now and offer that re-login.
 */

const BUNDLE_RE = /assets\/index-[A-Za-z0-9_-]+\.js/;
const EVERY_MS = 5 * 60_000;

function loadedBundle(): { name: string; base: string } | null {
  const el = document.querySelector<HTMLScriptElement>('script[src*="/assets/index-"]');
  const m = el?.src.match(BUNDLE_RE);
  return el && m ? { name: m[0], base: el.src.slice(0, el.src.indexOf(m[0])) } : null;
}

export function UpdateNotice() {
  const { t } = useT();
  const [outdated, setOutdated] = useState(false);

  useEffect(() => {
    const mine = loadedBundle();
    if (!mine) return; // dev server
    let stop = false;
    const check = async () => {
      if (stop || document.hidden) return;
      try {
        const r = await fetch(`${mine.base}index.html`, { cache: 'no-store', credentials: 'same-origin' });
        const now = (await r.text()).match(BUNDLE_RE)?.[0];
        if (r.ok && now && now !== mine.name) setOutdated(true);
      } catch {
        /* offline / server restarting: try again later */
      }
    };
    void check();
    const timer = window.setInterval(check, EVERY_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      stop = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  if (!outdated) return null;
  return (
    <div className="update-notice" role="status">
      <RefreshCw size={16} aria-hidden />
      <span>{t('update.ready')}</span>
      <button className="btn btn--sm btn--accent" onClick={() => cockpit().logout(true)}>{t('update.relogin')}</button>
    </div>
  );
}

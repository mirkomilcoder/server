import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { tunnel, type TunnelStatus } from '@/api/guardian';
import { useT } from '@/i18n';
import { useGuardian } from '@/state/guardian';
import { useToast } from '@/state/toasts';
import { Card } from './Card';

/*
 * "2FA": Cloudflare Access in front of panel.<domain>. On (default): email check
 * by Cloudflare, then the server login. Off: only the server login (username +
 * password). Open sessions are not cut; Cloudflare asks again after 7 days anyway.
 */
export function AccessCard() {
  const { t } = useT();
  const toast = useToast();
  const { me } = useGuardian();
  const [st, setSt] = useState<TunnelStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me?.role === 'admin') tunnel.status().then(setSt, () => setSt(null));
  }, [me?.role]);

  if (!st?.configured) return null;
  const on = st.panel_access !== false;

  const toggle = async (v: boolean) => {
    setBusy(true);
    try {
      await tunnel.setAccess(v);
      setSt({ ...st, panel_access: v });
      toast({ kind: v ? 'success' : 'warning', title: v ? t('access2fa.on') : t('access2fa.off') });
    } catch (e) {
      toast({ kind: 'error', title: t('action.failed'), details: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={<><span className={`title-icon tint--${on ? 'success' : 'warning'}`}><ShieldCheck size={17} /></span>{t('access2fa.title')}</>} tools={
      <label className="switch">
        <input type="checkbox" role="switch" checked={on} disabled={busy} onChange={(e) => toggle(e.target.checked)} aria-label={t('access2fa.title')} />
        <span className="switch__track" aria-hidden />
      </label>
    }>
      <p className="muted">{on ? t('access2fa.descOn', { host: st.panel_host ?? '' }) : t('access2fa.descOff', { host: st.panel_host ?? '' })}</p>
      {!on && <p className="card__meta c-danger">{t('access2fa.warn')}</p>}
    </Card>
  );
}

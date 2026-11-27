import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Github, KeyRound, Mail } from 'lucide-react';
import { login, type LoginStatus } from '@/api/guardian';
import { useT } from '@/i18n';
import { useToast } from '@/state/toasts';
import { Card } from './Card';

/*
 * How super admins sign in on panel.<domain>: Google / GitHub (an OAuth app the
 * owner creates once) or a code sent to their email. The client secret goes
 * straight to Cloudflare — the server never stores it.
 */

const SETUP: Record<'google' | 'github', string> = {
  google: 'https://console.cloud.google.com/apis/credentials',
  github: 'https://github.com/settings/applications/new',
};

function GoogleMark() {
  return <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>;
}

export function LoginMethodsCard() {
  const { t } = useT();
  const toast = useToast();
  const [st, setSt] = useState<LoginStatus | null>(null);
  const [open, setOpen] = useState<'google' | 'github' | null>(null);
  const [cid, setCid] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    login.status().then(setSt, () => setSt({ configured: false }));
  }, []);

  if (!st?.configured) return null;
  const has = (k: string) => (st.providers ?? []).includes(k);

  const apply = async (kind: 'google' | 'github', enabled: boolean) => {
    setBusy(true);
    try {
      const r = await login.setProvider(kind, enabled ? cid.trim() : '', enabled ? secret.trim() : '', enabled);
      setSt({ ...st, ...r });
      setOpen(null);
      setCid('');
      setSecret('');
      toast({ kind: 'success', title: enabled ? t('login.on', { name: kind === 'google' ? 'Google' : 'GitHub' }) : t('login.off') });
    } catch (e) {
      toast({ kind: 'error', title: t('action.failed'), details: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const row = (kind: 'google' | 'github', icon: React.ReactNode, name: string) => (
    <div className="login-method" key={kind}>
      <div className="list-line">
        <span className="row-gap">{icon} <strong>{name}</strong></span>
        <span className="row-gap">
          <span className={`pill${has(kind) ? ' pill--success' : ''}`}>{has(kind) ? t('login.active') : t('login.notSet')}</span>
          <button className="btn btn--sm" onClick={() => { setOpen(open === kind ? null : kind); setCid(''); setSecret(''); }}>
            {has(kind) ? t('login.change') : t('login.setup')}
          </button>
          {has(kind) && <button className="btn btn--sm btn--danger-ghost" disabled={busy} onClick={() => apply(kind, false)}>{t('login.disable')}</button>}
        </span>
      </div>
      {open === kind && (
        <form className="wizard login-form" onSubmit={(e) => { e.preventDefault(); void apply(kind, true); }}>
          <ol className="howto">
            <li>{t(`login.${kind}.step1`)} <a className="ext-link" href={SETUP[kind]} target="_blank" rel="noopener noreferrer">{name} <ExternalLink size={13} /></a></li>
            <li>
              {t('login.callbackStep')}
              <span className="hook-value login-callback">
                <code className="mono">{st.callback}</code>
                <button type="button" className="icon-btn" aria-label={t('env.copy')} onClick={async () => {
                  try { await navigator.clipboard.writeText(st.callback ?? ''); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ }
                }}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>
              </span>
            </li>
            <li>{t('login.pasteStep')}</li>
          </ol>
          <label className="field"><span className="field__label">Client ID</span>
            <input className="input input--plain mono" value={cid} onChange={(e) => setCid(e.target.value)} autoComplete="off" spellCheck={false} /></label>
          <label className="field"><span className="field__label">Client Secret</span>
            <input className="input input--plain mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} />
            <span className="card__meta">{t('login.secretHint')}</span></label>
          <div className="modal__actions">
            <button type="button" className="btn" onClick={() => setOpen(null)}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn--accent" disabled={busy || cid.trim().length < 8 || secret.trim().length < 8}>{t('dom.save')}</button>
          </div>
        </form>
      )}
    </div>
  );

  return (
    <Card title={<><span className="title-icon tint--info"><KeyRound size={17} /></span>{t('login.title')}</>}>
      <p className="muted">{t('login.intro')}</p>
      {st.error && <p className="form-error">{st.error}</p>}
      <div className="login-methods">
        {row('google', <GoogleMark />, 'Google (Gmail)')}
        {row('github', <Github size={16} />, 'GitHub')}
        <div className="list-line">
          <span className="row-gap"><Mail size={16} /> <strong>{t('login.emailCode')}</strong></span>
          <span className={`pill${has('onetimepin') ? ' pill--success' : ''}`}>{has('onetimepin') ? t('login.active') : t('login.notSet')}</span>
        </div>
      </div>
      <p className="card__meta">{st.sso ? t('login.ssoOn') : t('login.ssoOff')}</p>
    </Card>
  );
}

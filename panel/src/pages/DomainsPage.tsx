import { useState } from 'react';
import { CheckCircle2, CloudCog, ExternalLink, Globe, KeyRound, Lock, RefreshCw, Settings2, ShieldCheck } from 'lucide-react';
import { apps, tunnel, type TunnelStatus } from '@/api/guardian';
import { usePoll } from '@/hooks/usePoll';
import { useT, type TranslationKey } from '@/i18n';
import { useBrand, useGuardian } from '@/state/guardian';
import { useToast } from '@/state/toasts';
import { Modal } from '@/components/Modal';
import { Card, MotionGrid } from '@/widgets/Card';
import { RowsSkeleton } from '@/widgets/Skeletons';
import type { PageProps } from './registry';

/*
 * Public access through Cloudflare Tunnel: panel.<domain> behind Cloudflare
 * Access, every app at <app>.<domain>. The API token is typed here once, sent
 * to the root helper and stored root-only; it is never shown again.
 */

const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,63}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{30,200}$/;
// Account API tokens ("cfat_…") live under Manage Account; the page redirects to the user's account
const TOKEN_URL = 'https://dash.cloudflare.com/?to=/:account/api-tokens';

const STATES = ['healthy', 'degraded', 'down', 'inactive'];
const stateKey = (s?: string) => `dom.state.${STATES.includes(s ?? '') ? s : 'unknown'}` as TranslationKey;
const tone = (s?: string) => (s === 'healthy' ? 'success' : s === 'degraded' ? 'warning' : 'danger');

export default function DomainsPage({ go }: PageProps) {
  const { t } = useT();
  const { me } = useGuardian();
  const isAdmin = me?.role === 'admin';
  const [tick, setTick] = useState(0);
  const st = usePoll(() => (isAdmin ? tunnel.status() : Promise.resolve<TunnelStatus>({ configured: false })), 15_000, [tick, isAdmin]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  if (!isAdmin) {
    return (
      <>
        <Head />
        <Card><p className="muted">{t('identity.adminOnly')}</p></Card>
      </>
    );
  }

  const s = st.data;
  const sync = async () => {
    setBusy(true);
    try {
      const r = await tunnel.sync();
      toast({ kind: 'success', title: t('dom.synced'), details: r.dns ? t('dom.syncDetails', { c: r.dns.created.length, r: r.dns.removed.length }) : undefined });
      setTick((x) => x + 1);
    } catch (e) {
      toast({ kind: 'error', title: t('action.failed'), details: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Head tools={s?.configured ? (
        <div className="row-gap">
          <button className="btn" disabled={busy} onClick={sync}><RefreshCw size={16} /> {t('dom.sync')}</button>
          <button className="btn btn--accent" onClick={() => setEditing(true)}><Settings2 size={16} /> {t('dom.edit')}</button>
        </div>
      ) : undefined} />

      {!s && !st.error ? <RowsSkeleton rows={2} h={140} /> : st.error ? (
        <div className="notice notice--warning" role="status">{st.error instanceof Error ? st.error.message : String(st.error)}</div>
      ) : !s?.configured ? (
        <SetupCard onDone={() => setTick((x) => x + 1)} />
      ) : (
        <Configured s={s} go={go} />
      )}

      <Modal open={editing} onClose={() => setEditing(false)} title={t('dom.edit')}>
        {s?.configured && <SetupForm initial={s} onDone={() => { setEditing(false); setTick((x) => x + 1); }} onCancel={() => setEditing(false)} />}
      </Modal>
    </>
  );
}

function Head({ tools }: { tools?: React.ReactNode }) {
  const { t } = useT();
  return (
    <div className="page-head">
      <div>
        <h1>{t('nav.domains')}</h1>
        <p className="muted">{t('dom.intro')}</p>
      </div>
      {tools}
    </div>
  );
}

function Configured({ s, go }: { s: TunnelStatus; go: PageProps['go'] }) {
  const { t } = useT();
  const { domain } = useBrand();
  const list = usePoll(apps.list, 30_000);
  const appOf = (h: string) => (list.data?.apps ?? []).find((a) => h === `${a.name}.${s.domain}`)?.name;
  const hosts = (s.hosts ?? []).filter((h) => h !== s.panel_host);
  const ok = s.status === 'healthy' && s.service === 'active';

  return (
    <>
      {s.domain && s.domain !== domain && (
        <div className="notice notice--warning" role="status">{t('dom.mismatch', { old: s.domain, now: domain })}</div>
      )}
      <MotionGrid className="grid grid--bottom">
        <Card title={<><span className={`title-icon tint--${ok ? 'success' : tone(s.status)}`}><CloudCog size={17} /></span>{t('dom.tunnel')}</>}>
          <div className="list-line">
            <span>{t('dom.cfState')}</span>
            <span className={`pill pill--${tone(s.status)}`}>{t(stateKey(s.status))}</span>
          </div>
          <div className="list-line"><span>{t('dom.connections')}</span><span className="mono">{s.connections ?? 0}</span></div>
          <div className="list-line"><span>cloudflared</span><span className={s.service === 'active' ? 'c-success' : 'c-danger'}>{s.service}</span></div>
          {s.error && <p className="form-error">{s.error}</p>}
          <p className="card__meta">{t('dom.noPorts')}</p>
        </Card>

        <Card title={<><span className="title-icon tint--info"><Lock size={17} /></span>{t('dom.panel')}</>}>
          <div className="list-line">
            <a className="mono ext-link" href={`https://${s.panel_host}`} target="_blank" rel="noopener noreferrer">{s.panel_host} <ExternalLink size={13} /></a>
            <span className="pill pill--success"><ShieldCheck size={13} /> Access</span>
          </div>
          <p className="card__meta">{t('dom.panelHint')}</p>
          {(s.emails ?? []).map((e) => <div className="list-line mono" key={e}><span>{e}</span><CheckCircle2 size={15} className="c-success" /></div>)}
        </Card>
      </MotionGrid>

      <Card title={<><span className="title-icon tint--accent"><Globe size={17} /></span>{t('dom.hosts')}</>}>
        {hosts.length === 0 ? (
          <div className="empty">
            <p>{t('dom.noHosts')}</p>
            <button className="btn btn--accent" onClick={() => go('deploy')}>{t('nav.deploy')}</button>
          </div>
        ) : hosts.map((h) => {
          const app = h === s.domain ? s.root_app ?? undefined : appOf(h);
          return (
            <div className="list-line" key={h}>
              <a className="mono ext-link" href={`https://${h}`} target="_blank" rel="noopener noreferrer">{h} <ExternalLink size={13} /></a>
              <span className="row-gap">
                {h === s.domain && <span className="pill">{t('dom.root')}</span>}
                {app ? <button className="btn btn--sm btn--ghost" onClick={() => go('deploy', { app })}>{app}</button> : <span className="muted">—</span>}
                <span className="pill pill--success">SSL</span>
              </span>
            </div>
          );
        })}
        <p className="card__meta">{t('dom.custom')}</p>
      </Card>
    </>
  );
}

function SetupCard({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const { domain } = useBrand();
  return (
    <MotionGrid className="grid grid--bottom">
      <Card title={<><span className="title-icon tint--info"><KeyRound size={17} /></span>{t('dom.setup.title')}</>}>
        <ol className="howto">
          <li>{t('dom.step1', { domain })}</li>
          <li>{t('dom.step2')}</li>
          <li>
            {t('dom.step3')}{' '}
            <a className="ext-link" href={TOKEN_URL} target="_blank" rel="noopener noreferrer">dash.cloudflare.com <ExternalLink size={13} /></a>
            <ul className="mono card__meta">
              <li>Account · Cloudflare Tunnel · Edit</li>
              <li>Account · Access: Apps and Policies · Edit</li>
              <li>Account · Access: Organizations, Identity Providers, and Groups · Read</li>
              <li>Zone · DNS · Edit — {domain}</li>
              <li>Zone · Zone · Read — {domain}</li>
            </ul>
          </li>
          <li>{t('dom.step4')}</li>
        </ol>
      </Card>
      <Card title={t('dom.setup.form')}>
        <SetupForm onDone={onDone} />
      </Card>
    </MotionGrid>
  );
}

function SetupForm({ initial, onDone, onCancel }: { initial?: TunnelStatus; onDone: () => void; onCancel?: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const { domain } = useBrand();
  const list = usePoll(apps.list, 60_000);
  const [token, setToken] = useState('');
  const [emails, setEmails] = useState((initial?.emails ?? []).join(', '));
  const [root, setRoot] = useState(initial?.root_app ?? '');
  const [busy, setBusy] = useState(false);

  const emailList = emails.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
  const emailsOk = emailList.length > 0 && emailList.every((e) => EMAIL_RE.test(e));
  const tokenOk = initial ? token === '' || TOKEN_RE.test(token) : TOKEN_RE.test(token);
  const webApps = (list.data?.apps ?? []).filter((a) => a.type !== 'bot').map((a) => a.name);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailsOk || !tokenOk) return;
    setBusy(true);
    try {
      const r = await tunnel.setup(token, emailList, root || null);
      setToken('');
      toast({ kind: 'success', title: t('dom.done'), details: (r.hosts ?? []).join(', ') });
      onDone();
    } catch (err) {
      toast({ kind: 'error', title: t('action.failed'), details: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="wizard" onSubmit={submit}>
      <label className="field">
        <span className="field__label">{t('dom.token')}</span>
        <input className="input input--plain mono" type="password" autoComplete="off" spellCheck={false} value={token}
          placeholder={initial ? t('dom.tokenKeep') : ''} onChange={(e) => setToken(e.target.value.trim())} aria-invalid={!!token && !tokenOk} />
        <span className={token && !tokenOk ? 'form-error' : 'card__meta'}>{token && !tokenOk ? t('dom.tokenBad') : t('dom.tokenHint')}</span>
      </label>
      <label className="field">
        <span className="field__label">{t('dom.emails')}</span>
        <input className="input input--plain mono" value={emails} placeholder="siz@gmail.com" onChange={(e) => setEmails(e.target.value)}
          aria-invalid={!!emails && !emailsOk} />
        <span className={emails && !emailsOk ? 'form-error' : 'card__meta'}>{emails && !emailsOk ? t('dom.emailsBad') : t('dom.emailsHint')}</span>
      </label>
      <label className="field">
        <span className="field__label">{t('dom.rootApp', { domain })}</span>
        <select className="select" value={root} onChange={(e) => setRoot(e.target.value)}>
          <option value="">{t('dom.rootNone')}</option>
          {webApps.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>
      <div className="modal__actions">
        {onCancel && <button type="button" className="btn" onClick={onCancel}>{t('common.cancel')}</button>}
        <button type="submit" className="btn btn--accent" disabled={busy || !emailsOk || !tokenOk}>
          <CloudCog size={16} /> {busy ? t('common.loading') : initial ? t('dom.save') : t('dom.connect')}
        </button>
      </div>
    </form>
  );
}

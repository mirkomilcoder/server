import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Eye, EyeOff, RefreshCw, Webhook } from 'lucide-react';
import { apps, type AppDetail, type WebhookInfo } from '@/api/guardian';
import { cockpit } from '@/api/cockpit';
import { useT, type TranslationKey } from '@/i18n';
import { useToast } from '@/state/toasts';
import { Card } from './Card';
import { timeAgo } from './home';

/*
 * GitHub webhook: a push to the project's branch starts a deploy at once.
 * The URL goes through the Cloudflare Tunnel (hooks.<domain>); every delivery
 * is signed with the project's own secret (HMAC-SHA256) and checked on the server.
 */

/** "https://github.com/acme/shop(.git)" or "git@github.com:acme/shop.git" → GitHub "add webhook" page. */
export function githubHooksPage(repo: string): string | null {
  const m = repo.match(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(\.git)?$/);
  return m ? `https://github.com/${m[1]}/${m[2]}/settings/hooks/new` : null;
}

const RESULT_TONE: Record<string, string> = { deployed: 'success', ok: 'success', queued: 'warning', ignored: '', rejected: 'danger', failed: 'danger' };

export function WebhookCard({ a }: { a: AppDetail }) {
  const { t } = useT();
  const toast = useToast();
  const [info, setInfo] = useState<WebhookInfo | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');

  const load = () => apps.webhook(a.name).then(setInfo, () => setInfo(null));
  useEffect(() => {
    void load();
    const id = window.setInterval(load, 15_000);
    return () => window.clearInterval(id);
  }, [a.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<WebhookInfo>, ok: string) => {
    setBusy(true);
    try {
      const r = await fn();
      setInfo(r);
      if (r.secret) {
        setSecret(r.secret);
        setShow(true);
      }
      toast({ kind: 'success', title: ok });
    } catch (e) {
      toast({ kind: 'error', title: t('action.failed'), details: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (what: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      toast({ kind: 'warning', title: t('invite.copyFail') });
    }
  };

  const reveal = async () => {
    if (secret) return setShow(!show);
    try {
      setSecret((await apps.webhookReveal(a.name)).secret);
      setShow(true);
    } catch (e) {
      toast({ kind: 'error', title: t('action.failed'), details: e instanceof Error ? e.message : String(e) });
    }
  };

  const page = githubHooksPage(a.repo);
  const on = !!info?.enabled;

  return (
    <Card title={<><span className="title-icon tint--accent"><Webhook size={17} /></span>{t('hook.title')}</>} tools={
      <label className="switch">
        <input type="checkbox" role="switch" checked={on} disabled={busy || !info}
          onChange={(e) => act(() => apps.setWebhook(a.name, { enabled: e.target.checked }), e.target.checked ? t('hook.enabled') : t('hook.disabled'))}
          aria-label={t('hook.title')} />
        <span className="switch__track" aria-hidden />
      </label>
    }>
      <p className="muted">{t('hook.intro', { branch: a.branch })}</p>

      {on && !info?.url && (
        <div className="notice notice--warning hook-notice">
          <span>{t('hook.needDomain')}</span>
          <button className="btn btn--sm" onClick={() => cockpit().location.go(['domains'])}>{t('nav.domains')}</button>
        </div>
      )}

      {on && info?.url && (
        <div className="hook-setup">
          <div className="hook-field">
            <span className="field__label">Payload URL</span>
            <div className="hook-value">
              <code className="mono">{info.url}</code>
              <button className="icon-btn" onClick={() => copy('url', info.url!)} aria-label={t('env.copy')}>{copied === 'url' ? <Check size={15} /> : <Copy size={15} />}</button>
            </div>
          </div>
          <div className="hook-field">
            <span className="field__label">Content type</span>
            <div className="hook-value"><code className="mono">application/json</code></div>
          </div>
          <div className="hook-field">
            <span className="field__label">Secret</span>
            <div className="hook-value">
              <code className="mono">{show && secret ? secret : '•'.repeat(24)}</code>
              <button className="icon-btn" onClick={reveal} aria-label={show ? t('env.hide') : t('env.show')}>{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
              {secret && <button className="icon-btn" onClick={() => copy('secret', secret)} aria-label={t('env.copy')}>{copied === 'secret' ? <Check size={15} /> : <Copy size={15} />}</button>}
            </div>
          </div>
          <ol className="howto hook-steps">
            <li>{t('hook.step1')} {page && <a className="ext-link" href={page} target="_blank" rel="noopener noreferrer">GitHub → Webhooks <ExternalLink size={13} /></a>}</li>
            <li>{t('hook.step2')}</li>
            <li>{t('hook.step3')}</li>
          </ol>
          <div className="row-gap">
            <button className="btn btn--sm btn--ghost" disabled={busy}
              onClick={() => act(() => apps.setWebhook(a.name, { rotate: true }), t('hook.rotated'))}>
              <RefreshCw size={14} /> {t('hook.rotate')}
            </button>
          </div>
        </div>
      )}

      {on && (
        <div className="hook-log">
          <div className="field__label">{t('hook.deliveries')}</div>
          {info?.pending && <div className="hook-item"><span className="pill pill--warning">{t('hook.r.queued')}</span><span className="mono">{info.pending.sha.slice(0, 7)}</span></div>}
          {(info?.deliveries ?? []).length === 0 ? <p className="card__meta">{t('hook.none')}</p> : info!.deliveries.slice(0, 8).map((d, i) => (
            <div className="hook-item" key={i}>
              <span className={`pill${RESULT_TONE[d.result] ? ` pill--${RESULT_TONE[d.result]}` : ''}`}>{t(`hook.r.${d.result}` as TranslationKey)}</span>
              <span className="mono hook-item__event">{d.event}</span>
              <span className="hook-item__detail">{d.detail}</span>
              <span className="card__meta">{timeAgo(t, d.ts)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

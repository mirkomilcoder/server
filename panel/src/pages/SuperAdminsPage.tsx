import { useEffect, useState } from 'react';
import { Crown, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { admins } from '@/api/guardian';
import { sessionUser } from '@/api/cockpit';
import { useT } from '@/i18n';
import { useGuardian } from '@/state/guardian';
import { useToast } from '@/state/toasts';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Card } from '@/widgets/Card';
import { RowsSkeleton } from '@/widgets/Skeletons';
import type { PageProps } from './registry';

/*
 * One role: super admin. Every email here may sign in through Cloudflare
 * (Google / GitHub / email code) and gets the whole panel; nobody else gets past
 * Cloudflare. The list is the Cloudflare Access rule itself.
 */

const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,63}$/;

export default function SuperAdminsPage({ go }: PageProps) {
  const { t } = useT();
  const toast = useToast();
  const { me } = useGuardian();
  const [emails, setEmails] = useState<string[] | null>(null);
  const [add, setAdd] = useState('');
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<string | null>(null);

  useEffect(() => {
    admins.list().then((r) => setEmails(r.emails), () => setEmails([]));
  }, []);

  const save = async (next: string[], ok: string) => {
    setBusy(true);
    try {
      const r = await admins.set(next);
      setEmails(r.emails);
      toast({ kind: r.access?.startsWith('xato') ? 'warning' : 'success', title: ok,
        details: r.access === 'off' ? t('admins.noDomain') : r.access?.startsWith('xato') ? r.access : undefined });
      return true;
    } catch (e) {
      toast({ kind: 'error', title: t('action.failed'), details: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (me && me.role !== 'admin') {
    return <Card><p className="muted">{t('identity.adminOnly')}</p></Card>;
  }

  const v = add.trim().toLowerCase();
  const addErr = v && (!EMAIL_RE.test(v) ? t('dom.emailsBad') : emails?.includes(v) ? t('admins.exists') : '');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('nav.users')}</h1>
          <p className="muted">{t('admins.intro')}</p>
        </div>
        <button className="btn" onClick={() => go('domains')}><ShieldCheck size={16} /> {t('admins.loginMethods')}</button>
      </div>

      <Card title={<><span className="title-icon tint--warning"><Crown size={17} /></span>{t('admins.title')}</>}>
        {emails === null ? <RowsSkeleton rows={2} h={44} /> : (
          <div className="admin-list">
            {emails.length === 0 && <p className="muted">{t('admins.empty')}</p>}
            {emails.map((e) => (
              <div className="list-line" key={e}>
                <span className="mono">{e}</span>
                <span className="row-gap">
                  <span className="role-badge role-badge--admin">{t('role.superAdmin')}</span>
                  <button className="icon-btn icon-btn--danger" aria-label={t('fm.delete')} title={t('fm.delete')}
                    disabled={busy || emails.length === 1} onClick={() => setDel(e)}><Trash2 size={16} /></button>
                </span>
              </div>
            ))}
            <form className="admin-add" onSubmit={async (ev) => {
              ev.preventDefault();
              if (!v || addErr || !emails) return;
              if (await save([...emails, v], t('admins.added', { email: v }))) setAdd('');
            }}>
              <input className="input input--plain" type="email" placeholder="yangi.admin@gmail.com" value={add}
                onChange={(e) => setAdd(e.target.value)} aria-invalid={!!addErr} aria-label={t('admins.add')} />
              <button type="submit" className="btn btn--accent" disabled={busy || !v || !!addErr}><Plus size={16} /> {t('admins.add')}</button>
            </form>
            {addErr && <span className="form-error">{addErr}</span>}
          </div>
        )}
        <p className="card__meta admin-note">{t('admins.how')}</p>
        {sessionUser().name === 'mkadmin' && <p className="card__meta">{t('admins.ssoSession')}</p>}
      </Card>

      <ConfirmDialog
        open={!!del}
        title={t('admins.remove')}
        body={del ? t('admins.removeBody', { email: del }) : ''}
        confirmLabel={t('admins.remove')}
        busy={busy}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del || !emails) return;
          const e = del;
          setDel(null);
          await save(emails.filter((x) => x !== e), t('admins.removed', { email: e }));
        }}
      />
    </>
  );
}

import { useState } from 'react';
import { AtSign, Check, Copy, Crown, KeyRound, Lock, Printer, ShieldCheck, Trash2, Unlock, UserPlus, Users as UsersIcon } from 'lucide-react';
import { apps, users, type Invite, type PanelUser, type Role } from '@/api/guardian';
import { usePoll } from '@/hooks/usePoll';
import { useT, type TranslationKey } from '@/i18n';
import { useGuardian } from '@/state/guardian';
import { useToast } from '@/state/toasts';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Card, MotionGrid } from '@/widgets/Card';
import { RowsSkeleton } from '@/widgets/Skeletons';
import type { PageProps } from './registry';

/*
 * Panel users = Linux accounts with one role group. New users get a one-time
 * temporary password (shown once on the invite card, never stored) and must pick
 * their own at first login. The server owner (sudo) is shown but never changed here.
 */

const ROLES: Role[] = ['viewer', 'developer', 'admin'];
const USER_RE = /^[a-z][a-z0-9_-]{1,30}$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,63}$/;

const initials = (u: PanelUser) => (u.name || u.user).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

export default function UsersPage(_props: PageProps) {
  const { t } = useT();
  const toast = useToast();
  const { me } = useGuardian();
  const isAdmin = me?.role === 'admin';
  const [tick, setTick] = useState(0);
  const list = usePoll(() => (isAdmin ? users.list() : Promise.resolve({ users: [] as PanelUser[] })), 30_000, [tick, isAdmin]);
  const groupDefs = usePoll(() => (isAdmin ? users.groups() : Promise.resolve({ groups: [] })), 600_000, [isAdmin]);
  const appList = usePoll(apps.list, 60_000);
  const [inviting, setInviting] = useState(false);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [editApps, setEditApps] = useState<PanelUser | null>(null);
  const [editGroups, setEditGroups] = useState<PanelUser | null>(null);
  const [del, setDel] = useState<PanelUser | null>(null);
  const [editEmail, setEditEmail] = useState<PanelUser | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | null> => {
    setBusy(true);
    try {
      const r = await fn();
      if (ok) toast({ kind: 'success', title: ok });
      setTick((x) => x + 1);
      return r;
    } catch (e) {
      toast({ kind: 'error', title: t('action.failed'), details: e instanceof Error ? e.message : String(e) });
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (!isAdmin) {
    return (
      <>
        <div className="page-head"><h1>{t('nav.users')}</h1></div>
        <Card><p className="muted">{t('identity.adminOnly')}</p></Card>
      </>
    );
  }

  const items = list.data?.users ?? [];
  const appNames = (appList.data?.apps ?? []).map((a) => a.name);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('nav.users')}</h1>
          <p className="muted">{t('users.intro')}</p>
        </div>
        <button className="btn btn--accent" onClick={() => setInviting(true)}><UserPlus size={16} /> {t('users.invite')}</button>
      </div>

      <MotionGrid className="grid grid--bottom users-roles">
        {ROLES.slice().reverse().map((r) => (
          <Card key={r} className="role-card">
            <span className={`role-badge role-badge--${r}`}>{t(`role.${r}` as TranslationKey)}</span>
            <p className="card__meta">{t(`role.${r}.about` as TranslationKey)}</p>
          </Card>
        ))}
      </MotionGrid>

      {!list.data && !list.error ? <RowsSkeleton rows={3} h={84} /> : (
        <div className="user-list">
          {items.map((u) => {
            const self = u.user === me?.user;
            const locked = u.owner || self;
            return (
              <Card key={u.user} className={`user-row${u.locked ? ' user-row--locked' : ''}`}>
                <span className={`user-avatar role-badge--${u.role}`} aria-hidden>{initials(u)}</span>
                <div className="user-row__main">
                  <div className="user-row__name">
                    {u.name || u.user}
                    {u.owner && <span className="pill pill--warning" title={t('users.ownerHint')}><Crown size={12} /> {t('users.owner')}</span>}
                    {self && <span className="pill">{t('users.you')}</span>}
                    {u.locked && <span className="pill pill--danger"><Lock size={12} /> {t('users.locked')}</span>}
                    {u.must_change && <span className="pill pill--warning">{t('users.mustChange')}</span>}
                    {!u.owner && !u.email && <span className="pill pill--warning" title={t('users.noEmailHint')}><AtSign size={12} /> {t('users.noEmail')}</span>}
                  </div>
                  <div className="card__meta mono">{u.user}{u.email ? ` · ${u.email}` : ''}</div>
                  <div className="user-row__tags">
                    {u.role !== 'admin' && (u.apps.length ? u.apps.map((a) => <span key={a} className="tag">{a}</span>)
                      : <span className="card__meta">{t('users.noApps')}</span>)}
                    {u.groups.map((g) => <span key={g} className="tag tag--group">{g}</span>)}
                  </div>
                </div>
                <div className="user-row__actions">
                  <select className="select select--sm" value={u.role === 'none' ? '' : u.role} disabled={locked || busy}
                    aria-label={t('users.role')}
                    onChange={(e) => run(() => users.setRole(u.user, e.target.value as Role), t('users.roleChanged'))}>
                    {u.role === 'none' && <option value="">{t('role.none')}</option>}
                    {ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}` as TranslationKey)}</option>)}
                  </select>
                  {!locked && u.managed && (
                    <>
                      {u.role !== 'admin' && (
                        <button className="btn btn--sm" onClick={() => setEditApps(u)} disabled={busy}>{t('users.apps')}</button>
                      )}
                      <button className="btn btn--sm" onClick={() => setEditGroups(u)} disabled={busy}>{t('users.groups')}</button>
                      <button className="icon-btn" title={t('users.emailEdit')} aria-label={t('users.emailEdit')} disabled={busy}
                        onClick={() => setEditEmail(u)}><AtSign size={16} /></button>
                      <button className="icon-btn" title={t('users.resetPw')} aria-label={t('users.resetPw')} disabled={busy}
                        onClick={async () => { const r = await run(() => users.resetPassword(u.user)); if (r) setInvite({ ...r, role: u.role as Role }); }}>
                        <KeyRound size={16} />
                      </button>
                      <button className="icon-btn" title={u.locked ? t('users.unlock') : t('users.lock')} aria-label={u.locked ? t('users.unlock') : t('users.lock')}
                        disabled={busy} onClick={() => run(() => users.setLocked(u.user, !u.locked), u.locked ? t('users.unlocked') : t('users.lockedDone'))}>
                        {u.locked ? <Unlock size={16} /> : <Lock size={16} />}
                      </button>
                      <button className="icon-btn icon-btn--danger" title={t('users.delete')} aria-label={t('users.delete')} disabled={busy}
                        onClick={() => setDel(u)}><Trash2 size={16} /></button>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
          {items.length === 0 && (
            <Card><div className="empty"><div className="empty__icon"><UsersIcon size={26} /></div><p>{t('users.empty')}</p></div></Card>
          )}
        </div>
      )}

      <InviteForm open={inviting} appNames={appNames} busy={busy} onClose={() => setInviting(false)}
        onSubmit={async (b) => {
          const r = await run(() => users.create(b));
          if (r) {
            setInviting(false);
            setInvite(r);
          }
        }} />

      <InviteCard invite={invite} onClose={() => setInvite(null)} />

      <PickList open={!!editApps} title={t('users.appsFor', { user: editApps?.user ?? '' })} hint={t('users.appsHint')}
        options={appNames.map((a) => ({ value: a, label: a }))} initial={editApps?.apps ?? []} busy={busy}
        onClose={() => setEditApps(null)}
        onSave={async (v) => { if (editApps && await run(() => users.setApps(editApps.user, v), t('users.saved'))) setEditApps(null); }} />

      <PickList open={!!editGroups} title={t('users.groupsFor', { user: editGroups?.user ?? '' })} hint={t('users.groupsHint')}
        options={(groupDefs.data?.groups ?? []).map((g) => ({ value: g.name, label: g.name, about: g.about }))}
        initial={editGroups?.groups ?? []} busy={busy} onClose={() => setEditGroups(null)}
        onSave={async (v) => { if (editGroups && await run(() => users.setGroups(editGroups.user, v), t('users.saved'))) setEditGroups(null); }} />

      <EmailDialog user={editEmail} busy={busy} onClose={() => setEditEmail(null)}
        onSave={async (email) => {
          if (!editEmail) return;
          const r = await run(() => users.setEmail(editEmail.user, email), t('users.saved'));
          if (r) setEditEmail(null);
        }} />

      <ConfirmDialog
        open={!!del}
        title={t('users.delete')}
        body={del ? t('users.deleteBody', { user: del.user }) : ''}
        confirmLabel={t('users.delete')}
        expected={del?.user}
        busy={busy}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          const name = del.user;
          setDel(null);
          await run(() => users.remove(name), t('users.deleted', { user: name }));
        }}
      />
    </>
  );
}

function InviteForm({ open, appNames, busy, onClose, onSubmit }: {
  open: boolean;
  appNames: string[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (b: { user: string; role: Role; name: string; email: string; apps: string[] }) => void;
}) {
  const { t } = useT();
  const [user, setUser] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('developer');
  const [picked, setPicked] = useState<string[]>([]);
  const userOk = USER_RE.test(user);
  const emailOk = !email || EMAIL_RE.test(email);

  return (
    <Modal open={open} onClose={onClose} title={t('users.invite')}>
      <form className="wizard" onSubmit={(e) => {
        e.preventDefault();
        if (userOk && emailOk) onSubmit({ user, role, name: name.trim(), email: email.trim(), apps: role === 'admin' ? [] : picked });
      }}>
        <div className="wizard__row">
          <label className="field">
            <span className="field__label">{t('users.fullName')}</span>
            <input className="input input--plain" value={name} maxLength={60} autoFocus placeholder="Ali Valiyev"
              onChange={(e) => {
                setName(e.target.value);
                if (!user || user === suggest(name)) setUser(suggest(e.target.value));
              }} />
          </label>
          <label className="field">
            <span className="field__label">{t('users.login')}</span>
            <input className="input input--plain mono" value={user} maxLength={31} placeholder="ali" spellCheck={false}
              onChange={(e) => setUser(e.target.value.toLowerCase())} aria-invalid={!!user && !userOk} />
            {user && !userOk && <span className="form-error">{t('users.badLogin')}</span>}
          </label>
        </div>
        <div className="field">
          <span className="field__label">{t('users.role')}</span>
          <div className="role-pick">
            {ROLES.map((r) => (
              <button type="button" key={r} className="role-option" aria-pressed={role === r} onClick={() => setRole(r)}>
                <span className={`role-badge role-badge--${r}`}>{t(`role.${r}` as TranslationKey)}</span>
                <span className="card__meta">{t(`role.${r}.about` as TranslationKey)}</span>
              </button>
            ))}
          </div>
        </div>
        {role !== 'admin' && appNames.length > 0 && (
          <div className="field">
            <span className="field__label">{t('users.apps')}</span>
            <div className="chip-pick">
              {appNames.map((a) => (
                <button type="button" key={a} className="chip-opt" aria-pressed={picked.includes(a)}
                  onClick={() => setPicked(picked.includes(a) ? picked.filter((x) => x !== a) : [...picked, a])}>
                  {picked.includes(a) && <Check size={13} />} {a}
                </button>
              ))}
            </div>
            <span className="card__meta">{t('users.appsHint')}</span>
          </div>
        )}
        <label className="field">
          <span className="field__label">{t('users.email')}</span>
          <input className="input input--plain" type="email" value={email} placeholder="ali@gmail.com" onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!emailOk} />
          <span className={emailOk ? 'card__meta' : 'form-error'}>{emailOk ? t('users.emailHint') : t('dom.emailsBad')}</span>
        </label>
        <div className="modal__actions">
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn--accent" disabled={busy || !userOk || !emailOk}>
            <UserPlus size={16} /> {busy ? t('common.loading') : t('users.create')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** "Ali Valiyev" → "ali" */
function suggest(name: string): string {
  const w = name.trim().toLowerCase().split(/\s+/)[0] ?? '';
  const s = w.normalize('NFKD').replace(/[^a-z0-9_-]/g, '');
  return /^[a-z]/.test(s) ? s.slice(0, 31) : '';
}

/** Shown once: login details for the new user (or after a password reset). */
function InviteCard({ invite, onClose }: { invite: Invite | null; onClose: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  if (!invite) return null;
  const text = [
    t('invite.text.title'),
    `${t('invite.address')}: ${invite.panel_url || '—'}`,
    `${t('users.login')}: ${invite.user}`,
    `${t('invite.tempPw')}: ${invite.password}`,
    t('invite.text.first'),
  ].join('\n');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ kind: 'warning', title: t('invite.copyFail') });
    }
  };
  return (
    <Modal open onClose={onClose} title={t('invite.title')}>
      <div className="invite">
        <div className="invite-card" id="invite-card">
          <div className="invite-card__head">
            <ShieldCheck size={20} /> <span>{t('invite.text.title')}</span>
            <span className={`role-badge role-badge--${invite.role}`}>{t(`role.${invite.role}` as TranslationKey)}</span>
          </div>
          <dl>
            <dt>{t('invite.address')}</dt><dd className="mono">{invite.panel_url || '—'}</dd>
            <dt>{t('users.login')}</dt><dd className="mono">{invite.user}</dd>
            <dt>{t('invite.tempPw')}</dt><dd className="mono invite-card__pw">{invite.password}</dd>
          </dl>
          <p className="card__meta">{t('invite.text.first')}</p>
          {invite.access === 'ok' && invite.email && <p className="card__meta">{t('invite.access', { email: invite.email })}</p>}
        </div>
        <div className="notice notice--warning">{t('invite.once')}</div>
        <div className="modal__actions">
          <button className="btn" onClick={() => window.print()}><Printer size={16} /> {t('invite.print')}</button>
          <button className="btn" onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />} {t('invite.copy')}</button>
          <button className="btn btn--accent" onClick={onClose}>{t('invite.done')}</button>
        </div>
      </div>
    </Modal>
  );
}

function PickList({ open, title, hint, options, initial, busy, onClose, onSave }: {
  open: boolean;
  title: string;
  hint: string;
  options: { value: string; label: string; about?: string }[];
  initial: string[];
  busy: boolean;
  onClose: () => void;
  onSave: (v: string[]) => void;
}) {
  const { t } = useT();
  const [sel, setSel] = useState<string[]>(initial);
  const [key, setKey] = useState('');
  const k = `${open}:${initial.join(',')}`;
  if (k !== key) {
    setKey(k);
    setSel(initial);
  }
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="wizard">
        <p className="card__meta">{hint}</p>
        {options.length === 0 ? <p className="muted">—</p> : options.map((o) => (
          <label key={o.value} className="check-line pick-line">
            <input type="checkbox" checked={sel.includes(o.value)}
              onChange={() => setSel(sel.includes(o.value) ? sel.filter((x) => x !== o.value) : [...sel, o.value])} />
            <span><span className="mono">{o.label}</span>{o.about && <span className="card__meta"> — {o.about}</span>}</span>
          </label>
        ))}
        <div className="modal__actions">
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn--accent" disabled={busy} onClick={() => onSave(sel)}>{t('dom.save')}</button>
        </div>
      </div>
    </Modal>
  );
}

function EmailDialog({ user, busy, onClose, onSave }: { user: PanelUser | null; busy: boolean; onClose: () => void; onSave: (email: string) => void }) {
  const { t } = useT();
  const [email, setEmail] = useState('');
  const [key, setKey] = useState('');
  if ((user?.user ?? '') !== key) {
    setKey(user?.user ?? '');
    setEmail(user?.email ?? '');
  }
  const ok = !email || EMAIL_RE.test(email.trim());
  return (
    <Modal open={!!user} onClose={onClose} title={t('users.emailFor', { user: user?.user ?? '' })}>
      <form className="wizard" onSubmit={(e) => { e.preventDefault(); if (ok) onSave(email.trim().toLowerCase()); }}>
        <label className="field">
          <span className="field__label">{t('users.email')}</span>
          <input className="input input--plain" type="email" value={email} autoFocus placeholder="ali@gmail.com"
            onChange={(e) => setEmail(e.target.value)} aria-invalid={!ok} />
          <span className={ok ? 'card__meta' : 'form-error'}>{ok ? t('users.emailHint') : t('dom.emailsBad')}</span>
        </label>
        <div className="modal__actions">
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn--accent" disabled={busy || !ok}>{t('dom.save')}</button>
        </div>
      </form>
    </Modal>
  );
}

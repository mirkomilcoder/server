import { useState } from 'react';
import { Eye, EyeOff, KeyRound, ShieldCheck, Users } from 'lucide-react';
import { changePassword, PasswordChangeError } from '@/api/account';
import { sessionUser } from '@/api/cockpit';
import { useT, type TranslationKey } from '@/i18n';
import { useGuardian } from '@/state/guardian';
import { useSettings } from '@/state/settings';
import { useToast } from '@/state/toasts';
import { Card } from './Card';

/*
 * "Hisobim": who I am (login, role, groups), changing my own Linux password
 * (the same one used to log in and for admin mode) and the admin-mode preference.
 */
export function AccountCard({ onUsers }: { onUsers: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const { me } = useGuardian();
  const { settings, update } = useSettings();
  const user = sessionUser();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const groups = (me?.groups ?? []).filter((g) => g !== user.name);
  const tooShort = !!next && next.length < 8;
  const mismatch = !!again && again !== next;
  const ok = !!cur && next.length >= 8 && next === again && next !== cur;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setErr('');
    try {
      await changePassword(cur, next);
      setCur('');
      setNext('');
      setAgain('');
      toast({ kind: 'success', title: t('account.pwChanged') });
    } catch (x) {
      const kind = x instanceof PasswordChangeError ? x.kind : 'failed';
      setErr(t(`account.err.${kind}` as TranslationKey) + (x instanceof PasswordChangeError && x.details ? `\n${x.details}` : ''));
    } finally {
      setBusy(false);
    }
  };

  const type = show ? 'text' : 'password';
  return (
    <Card title={t('account.title')} className="account-card">
      <div className="account-head">
        <span className="user-avatar role-badge--admin" aria-hidden>{(user.full_name || user.name).slice(0, 2).toUpperCase()}</span>
        <div>
          <div className="user-row__name">{user.full_name || user.name}</div>
          <div className="card__meta mono">{user.name}</div>
        </div>
        {me && <span className={`role-badge role-badge--${me.role}`}>{t(`role.${me.role}` as TranslationKey)}</span>}
      </div>
      <div className="field">
        <span className="field__label">{t('account.groups')}</span>
        <div className="user-row__tags">
          {groups.length ? groups.map((g) => <span key={g} className="tag tag--group">{g}</span>) : <span className="card__meta">—</span>}
        </div>
      </div>

      {user.name === 'mkadmin' ? (
        <p className="card__meta account-pw">{t('account.ssoNote')}</p>
      ) : (
      <form className="account-pw" onSubmit={submit} autoComplete="off">
        <div className="field__label account-pw__title"><KeyRound size={15} /> {t('account.changePw')}</div>
        <input className="input input--plain" type={type} placeholder={t('account.current')} value={cur}
          onChange={(e) => setCur(e.target.value)} autoComplete="current-password" aria-label={t('account.current')} />
        <input className="input input--plain" type={type} placeholder={t('account.new')} value={next}
          onChange={(e) => setNext(e.target.value)} autoComplete="new-password" aria-label={t('account.new')} aria-invalid={tooShort} />
        <input className="input input--plain" type={type} placeholder={t('account.again')} value={again}
          onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" aria-label={t('account.again')} aria-invalid={mismatch} />
        {(tooShort || mismatch || (next && next === cur)) && (
          <span className="form-error">{tooShort ? t('account.tooShort') : mismatch ? t('account.mismatch') : t('account.same')}</span>
        )}
        {err && <span className="form-error account-pw__err">{err}</span>}
        <div className="account-pw__actions">
          <button type="button" className="icon-btn" onClick={() => setShow(!show)} aria-label={t('account.show')} aria-pressed={show}>
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <button type="submit" className="btn btn--accent" disabled={!ok || busy}>{busy ? t('common.loading') : t('account.save')}</button>
        </div>
        <span className="card__meta">{t('account.pwHint')}</span>
      </form>
      )}

      {me?.role === 'admin' && (
        <>
          <label className="check-line account-remember">
            <input type="checkbox" checked={settings.rememberAdmin} onChange={(e) => update({ rememberAdmin: e.target.checked })} />
            <span><ShieldCheck size={15} /> {t('account.rememberAdmin')}</span>
          </label>
          <span className="card__meta">{settings.rememberAdmin ? t('account.rememberOn') : t('account.rememberOff')}</span>
          <button className="btn account-users" onClick={onUsers}><Users size={16} /> {t('account.manageUsers')}</button>
        </>
      )}
    </Card>
  );
}

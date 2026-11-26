import { useEffect, useRef, useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { useT } from '@/i18n';
import { useToast } from '@/state/toasts';
import { answer, cancelStart, startAdmin, stopAdmin, type Prompt } from '@/api/superuser';
import { Modal } from './Modal';

/*
 * Turn Cockpit's administrative access on/off from inside the panel
 * (replaces the shell's "Administrative access" button, which is hidden).
 */
export function AdminDialog({ open, onClose, isAdmin }: { open: boolean; onClose: () => void; isAdmin: boolean }) {
  const { t } = useT();
  const toast = useToast();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  // Opening the dialog (when not admin yet) starts the sudo bridge; it then asks for the password.
  useEffect(() => {
    if (!open || isAdmin || started.current) return;
    started.current = true;
    setError(null);
    setBusy(true);
    startAdmin((p) => {
      setPrompt(p);
      setBusy(false);
      if (p.error) setError(p.error);
      requestAnimationFrame(() => input.current?.focus());
    })
      .then(() => {
        toast({ kind: 'success', title: t('admin.enabled') });
        finish();
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === 'cancelled') return finish();
        setPrompt(null);
        setBusy(false);
        setError(msg === 'no-bridge' ? t('admin.noBridge') : `${t('admin.failed')}: ${msg}`);
        started.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isAdmin]);

  function finish() {
    started.current = false;
    setPrompt(null);
    setValue('');
    setBusy(false);
    onClose();
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt) return;
    answer(value);
    setValue(''); // never keep the password in state longer than needed
    setBusy(true);
    setError(null);
  };

  const cancel = () => {
    if (started.current) cancelStart();
    finish();
  };

  const disable = async () => {
    setBusy(true);
    try {
      await stopAdmin();
      toast({ kind: 'info', title: t('admin.disabled') });
    } finally {
      finish();
    }
  };

  return (
    <Modal open={open} onClose={cancel} title={t(isAdmin ? 'admin.disable' : 'admin.enable')}>
      {isAdmin ? (
        <>
          <p>{t('admin.on')}</p>
          <div className="modal__actions">
            <button className="btn" onClick={cancel}>{t('common.cancel')}</button>
            <button className="btn btn--warning" onClick={disable} disabled={busy}>{t('admin.disable')}</button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} className="admin-form">
          <p style={{ display: 'flex', gap: 10 }}>
            <ShieldCheck size={20} style={{ flex: 'none', color: 'var(--warning)' }} aria-hidden />
            <span>{t('admin.intro')}</span>
          </p>
          <label className="field" style={{ marginTop: 16 }}>
            <span className="field__label">{prompt?.prompt?.replace(/^\[sudo\]\s*/, '').replace(/:\s*$/, '') || t('admin.password')}</span>
            <span className="input-wrap">
              <KeyRound size={17} aria-hidden />
              <input
                ref={input}
                className="input"
                type={prompt?.echo ? 'text' : 'password'}
                autoComplete="current-password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={!prompt || busy}
                required
              />
            </span>
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="modal__actions">
            <button type="button" className="btn" onClick={cancel}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn--accent" disabled={!prompt || busy || !value}>
              {busy ? t('admin.wait') : t('admin.submit')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useT } from '@/i18n';
import { Modal } from './Modal';

/*
 * Confirmation for dangerous actions.
 *  - danger "confirm": a clear question + red/amber button
 *  - expected text set: the user must type it (e.g. the hostname) first
 */
interface Props {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'warning';
  /** If set, the confirm button unlocks only after typing exactly this. */
  expected?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ open, title, body, confirmLabel, tone = 'danger', expected, busy, onConfirm, onClose }: Props) {
  const { t } = useT();
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);
  const unlocked = !expected || typed.trim() === expected;

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="confirm">
        <span className={`confirm__icon tint--${tone}`}><AlertTriangle size={22} aria-hidden /></span>
        <div className="confirm__body">{body}</div>
      </div>
      {expected && (
        <label className="field" style={{ marginTop: 16 }}>
          <span className="field__label">{t('confirm.type', { name: expected })}</span>
          <input
            className="input input--plain mono"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
        </label>
      )}
      <div className="modal__actions">
        <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className={`btn btn--${tone}`} disabled={!unlocked || busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

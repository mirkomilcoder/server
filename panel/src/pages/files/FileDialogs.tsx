import { useEffect, useState } from 'react';
import { runAction } from '@/api/run';
import { humanSize, IMAGE_MIME, ext, modeString, readBytes, type Entry } from '@/api/files';
import { FILE_NAME_RE } from '@/api/validate';
import { useT } from '@/i18n';
import { Modal } from '@/components/Modal';

/** Ask for one file/folder name (new folder, new file, rename, archive name). */
export function NameDialog({ open, title, initial, taken, confirmLabel, onSubmit, onClose }: {
  open: boolean;
  title: string;
  initial: string;
  taken: Set<string>;
  confirmLabel: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [name, setName] = useState(initial);
  useEffect(() => {
    if (open) setName(initial);
  }, [open, initial]);
  const v = name.trim();
  const err = !v ? '' : !FILE_NAME_RE.test(v) ? t('fm.badName') : v !== initial && taken.has(v) ? t('fm.exists') : '';
  const ok = !!v && !err && v !== initial;

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form className="wizard" onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit(v); }}>
        <label className="field">
          <span className="field__label">{t('fm.name')}</span>
          <input
            className="input input--plain mono" value={name} autoFocus spellCheck={false} maxLength={255}
            onChange={(e) => setName(e.target.value)} aria-invalid={!!err}
            onFocus={(e) => {
              // select the name without its extension, like desktop file managers
              const dot = initial.lastIndexOf('.');
              e.currentTarget.setSelectionRange(0, dot > 0 ? dot : initial.length);
            }}
          />
          {err && <span className="form-error">{err}</span>}
        </label>
        <div className="modal__actions">
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn--accent" disabled={!ok}>{confirmLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

const WHO = ['owner', 'group', 'other'] as const;
const BITS = [['r', 4], ['w', 2], ['x', 1]] as const;

/** Properties + permission editor (chmod) for one or more items. */
export function PropsDialog({ items, dir, asAdmin, onClose, onChmod }: {
  items: { path: string; e: Entry }[] | null;
  dir: string;
  asAdmin: boolean;
  onClose: () => void;
  onChmod: (paths: string[], mode: string) => void;
}) {
  const { t } = useT();
  const first = items?.[0];
  const [mode, setMode] = useState('644');
  const [du, setDu] = useState<number | null>(null);

  useEffect(() => {
    if (!first) return;
    setMode(first.e.mode.slice(-3));
    setDu(null);
    if (items!.length === 1 && first.e.type === 'dir') {
      runAction('files.du', { path: first.path }, { asAdmin }).then(
        (out) => setDu(Number(out.split(/\s/)[0]) || 0),
        () => setDu(-1),
      );
    }
  }, [items, first, asAdmin]);

  if (!items || !first) return null;
  const digits = mode.split('').map(Number);
  const toggle = (w: number, bit: number) => {
    const next = [...digits];
    next[w] ^= bit;
    setMode(next.join(''));
  };
  const single = items.length === 1;
  const total = items.reduce((s, x) => s + (x.e.type === 'file' ? x.e.size : 0), 0);

  return (
    <Modal open onClose={onClose} title={single ? first.e.name : t('fm.nItems', { n: items.length })}>
      <div className="fm-props">
        <dl className="fm-props__list">
          <dt>{t('fm.location')}</dt><dd className="mono">{single ? first.path : dir}</dd>
          <dt>{t('fm.type')}</dt><dd>{single ? t(`fm.kind.${first.e.type}`) + (first.e.linkTo ? ` → ${first.e.linkTo}` : '') : '—'}</dd>
          <dt>{t('fm.size')}</dt>
          <dd>{single && first.e.type === 'dir' ? (du === null ? t('common.loading') : du < 0 ? '—' : humanSize(du)) : humanSize(total)}</dd>
          {single && <><dt>{t('fm.modified')}</dt><dd>{new Date(first.e.mtime * 1000).toLocaleString()}</dd></>}
          {single && <><dt>{t('fm.owner')}</dt><dd className="mono">{first.e.owner}:{first.e.group}</dd></>}
        </dl>
        <div className="fm-perm" role="group" aria-label={t('fm.perms')}>
          <div className="fm-perm__head"><span>{t('fm.perms')}</span><span className="mono">{mode} · {modeString(mode)}</span></div>
          {WHO.map((w, i) => (
            <div className="fm-perm__row" key={w}>
              <span>{t(`fm.who.${w}`)}</span>
              {BITS.map(([label, bit]) => (
                <label key={label} className="check-line">
                  <input type="checkbox" checked={(digits[i] & bit) !== 0} onChange={() => toggle(i, bit)} />
                  <span>{t(`fm.bit.${label}`)}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
        <div className="modal__actions">
          <button className="btn" onClick={onClose}>{t('common.close')}</button>
          <button className="btn btn--accent" disabled={single && mode === first.e.mode.slice(-3)}
            onClick={() => onChmod(items.map((x) => x.path), mode)}>{t('fm.applyPerms')}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Image preview: bytes → data: URL (allowed by Cockpit's CSP), never HTML. */
export function ImagePreview({ path, asAdmin, onClose }: { path: string | null; asAdmin: boolean; onClose: () => void }) {
  const { t } = useT();
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setSrc(null);
    setErr('');
    if (!path) return;
    let alive = true;
    readBytes(path, asAdmin).then(
      (bytes) => {
        if (!alive) return;
        const blob = new Blob([bytes as BlobPart], { type: IMAGE_MIME[ext(path)] ?? 'application/octet-stream' });
        const r = new FileReader();
        r.onload = () => alive && setSrc(String(r.result));
        r.readAsDataURL(blob);
      },
      (e) => alive && setErr(e?.message ?? String(e)),
    );
    return () => {
      alive = false;
    };
  }, [path, asAdmin]);

  return (
    <Modal open={!!path} onClose={onClose} title={path ? path.slice(path.lastIndexOf('/') + 1) : ''}>
      <div className="fm-preview">
        {err ? <p className="form-error">{err}</p> : src ? <img src={src} alt={path ?? ''} /> : <p className="muted">{t('common.loading')}</p>}
      </div>
    </Modal>
  );
}

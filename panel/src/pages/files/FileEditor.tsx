import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Save, WrapText } from 'lucide-react';
import { BinaryFileError, readText, writeText } from '@/api/files';
import { useT } from '@/i18n';
import { useToast } from '@/state/toasts';
import { Modal } from '@/components/Modal';

/*
 * Plain-text editor: textarea (content is never interpreted), Tab indents,
 * Ctrl+S saves. Saving passes Cockpit's change tag, so a file modified on the
 * server meanwhile is not silently overwritten.
 */
export function FileEditor({ path, asAdmin, onClose, onSaved, onDownload }: {
  path: string | null;
  asAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
  onDownload: (path: string) => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [text, setText] = useState('');
  const [orig, setOrig] = useState('');
  const [tag, setTag] = useState<string | undefined>();
  const [state, setState] = useState<'loading' | 'ready' | 'binary' | 'error'>('loading');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [askClose, setAskClose] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const dirty = text !== orig;

  useEffect(() => {
    if (!path) return;
    setState('loading');
    setText('');
    setOrig('');
    readText(path, asAdmin).then(
      (f) => {
        setText(f.text);
        setOrig(f.text);
        setTag(f.tag);
        setState('ready');
      },
      (e) => {
        if (e instanceof BinaryFileError) return setState('binary');
        setError(e?.message ?? String(e));
        setState('error');
      },
    );
  }, [path, asAdmin]);

  const save = useCallback(async () => {
    if (!path || !dirty || saving) return;
    setSaving(true);
    try {
      const newTag = await writeText(path, text, tag, asAdmin);
      setTag(newTag);
      setOrig(text);
      toast({ kind: 'success', title: t('fm.saved') });
      onSaved();
    } catch (e) {
      const msg = (e as { problem?: string; message?: string })?.problem === 'change-conflict' ? t('fm.conflict') : (e as Error)?.message ?? String(e);
      toast({ kind: 'error', title: t('action.failed'), details: msg });
    } finally {
      setSaving(false);
    }
  }, [path, dirty, saving, text, tag, asAdmin, toast, t, onSaved]);

  const close = () => {
    if (dirty && !askClose) return setAskClose(true);
    setAskClose(false);
    onClose();
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: a, selectionEnd: b } = el;
      const next = text.slice(0, a) + '  ' + text.slice(b);
      setText(next);
      requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
    }
  };

  const lines = text ? text.split('\n').length : 0;

  return (
    <Modal open={!!path} onClose={close} title={path ? path.slice(path.lastIndexOf('/') + 1) + (dirty ? ' •' : '') : ''}>
      <div className="fm-editor">
        <div className="fm-editor__bar">
          <span className="mono card__meta fm-editor__path">{path}</span>
          {asAdmin && <span className="pill pill--danger">root</span>}
          <button className={`icon-btn${wrap ? ' icon-btn--on' : ''}`} title={t('fm.wrap')} aria-pressed={wrap} onClick={() => setWrap(!wrap)}><WrapText size={16} /></button>
        </div>
        {state === 'loading' && <div className="fm-editor__msg">{t('common.loading')}</div>}
        {state === 'error' && <div className="fm-editor__msg form-error">{error}</div>}
        {state === 'binary' && (
          <div className="fm-editor__msg">
            <p>{t('fm.binary')}</p>
            <button className="btn" onClick={() => path && onDownload(path)}><Download size={16} /> {t('fm.download')}</button>
          </div>
        )}
        {state === 'ready' && (
          <textarea
            ref={area}
            className={`fm-editor__text mono${wrap ? ' fm-editor__text--wrap' : ''}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoFocus
            aria-label={path ?? ''}
          />
        )}
        {askClose && (
          <div className="notice notice--warning fm-editor__ask" role="alert">
            <span>{t('fm.discard')}</span>
            <button className="btn btn--sm" onClick={() => setAskClose(false)}>{t('common.cancel')}</button>
            <button className="btn btn--sm btn--danger" onClick={close}>{t('fm.discardYes')}</button>
          </div>
        )}
        <div className="modal__actions fm-editor__foot">
          <span className="card__meta">{state === 'ready' ? t('fm.lines', { n: lines }) : ''} {state === 'ready' && <kbd>Ctrl+S</kbd>}</span>
          <button className="btn" onClick={close}>{t('common.close')}</button>
          <button className="btn btn--accent" disabled={!dirty || saving || state !== 'ready'} onClick={save}>
            <Save size={16} /> {saving ? t('common.loading') : t('fm.save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

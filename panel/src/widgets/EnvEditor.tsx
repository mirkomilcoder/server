import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Eye, EyeOff, FileText, List, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { apps, type AppDetail } from '@/api/guardian';
import { useT } from '@/i18n';
import { useToast } from '@/state/toasts';
import { Card } from './Card';

/*
 * Env editor: every key with its value (masked until shown), edit / delete per
 * key, add new keys, or edit everything as .env text. Values come from the
 * server only when this tab is opened (one activity-log entry per opening);
 * each change is saved at once and applied by restarting the current version.
 */

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const keyError = (k: string) => (!KEY_RE.test(k) ? 'bad' : k === 'PORT' ? 'port' : '');

interface Row { key: string; value: string }

export function EnvEditor({ a, onSaved }: { a: AppDetail; onSaved: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [edit, setEdit] = useState<{ key: string; value: string } | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const [add, setAdd] = useState<Row>({ key: '', value: '' });
  const [bulk, setBulk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    apps.revealEnv(a.name).then((r) => setRows(r.env), (e) => setLoadErr(e instanceof Error ? e.message : String(e)));
  }, [a.name]);

  const keys = useMemo(() => new Set((rows ?? []).map((r) => r.key)), [rows]);

  /** Save `next` as the complete env (values of untouched keys are re-sent unchanged). */
  const save = async (next: Row[], ok: string) => {
    setBusy(true);
    try {
      await apps.setEnv(a.name, Object.fromEntries(next.map((r) => [r.key, r.value])), []);
      setRows(next);
      setDirty(true);
      toast({ kind: 'success', title: ok });
      onSaved();
      return true;
    } catch (e) {
      toast({ kind: 'error', title: t('action.failed'), details: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      if (a.current?.deploy_id) await apps.rollback(a.name, a.current.deploy_id); // same image, new env
      else await apps.deploy(a.name);
      setDirty(false);
      toast({ kind: 'success', title: t('env.applying') });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: t('action.failed'), details: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast({ kind: 'success', title: t('env.copied') });
    } catch {
      toast({ kind: 'warning', title: t('invite.copyFail') });
    }
  };

  const toggleShown = (k: string) => {
    const n = new Set(shown);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setShown(n);
  };

  const addErr = add.key ? keyError(add.key) || (keys.has(add.key) ? 'exists' : '') : '';
  const addOk = !!add.key && !addErr && !/[\r\n]/.test(add.value);

  // ---------------------------------------------------------------- bulk (.env text)

  const bulkParse = (text: string): { rows: Row[]; errors: string[] } => {
    const out: Row[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();
    text.split(/\r?\n/).forEach((line, i) => {
      const l = line.trim();
      if (!l || l.startsWith('#')) return;
      const eq = l.indexOf('=');
      const k = (eq < 0 ? l : l.slice(0, eq)).trim().replace(/^export\s+/, '');
      let v = eq < 0 ? '' : l.slice(eq + 1).trim();
      if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) v = v.slice(1, -1);
      if (eq < 0 || keyError(k)) errors.push(t('env.bulkLine', { n: i + 1 }));
      else if (seen.has(k)) errors.push(t('env.bulkDup', { key: k }));
      else {
        seen.add(k);
        out.push({ key: k, value: v });
      }
    });
    return { rows: out, errors };
  };
  const parsed = bulk === null ? null : bulkParse(bulk);

  const tools = (
    <div className="row-gap">
      {rows && rows.length > 0 && bulk === null && (
        <button className="btn btn--sm btn--ghost" onClick={() => setShowAll(!showAll)}>
          {showAll ? <EyeOff size={14} /> : <Eye size={14} />} {showAll ? t('env.hideAll') : t('env.showAll')}
        </button>
      )}
      {rows && (
        <button className="btn btn--sm btn--ghost" onClick={() => setBulk(bulk === null ? rows.map((r) => `${r.key}=${r.value}`).join('\n') : null)}>
          {bulk === null ? <><FileText size={14} /> {t('env.asText')}</> : <><List size={14} /> {t('env.asList')}</>}
        </button>
      )}
    </div>
  );

  return (
    <Card title={t('app.tab.env')} tools={tools} className="env-card">
      <p className="card__meta">{t('env.intro')}</p>

      {dirty && (
        <div className="notice notice--warning env-apply" role="status">
          <span>{t('env.pending')}</span>
          <button className="btn btn--sm btn--accent" onClick={apply} disabled={busy}><RotateCcw size={14} /> {t('env.applyNow')}</button>
        </div>
      )}

      {loadErr ? <p className="form-error">{loadErr}</p> : rows === null ? <p className="muted">{t('common.loading')}</p> : bulk !== null ? (
        <div className="env-bulk">
          <textarea className="fm-editor__text mono env-bulk__text" value={bulk} spellCheck={false} autoComplete="off"
            onChange={(e) => setBulk(e.target.value)} aria-label={t('env.asText')} placeholder={'DATABASE_URL=postgres://…\nSECRET_KEY=…'} />
          {parsed && parsed.errors.length > 0 && <p className="form-error">{parsed.errors.slice(0, 5).join(' · ')}</p>}
          <div className="modal__actions">
            <span className="card__meta env-bulk__count">{t('env.count', { n: parsed?.rows.length ?? 0 })}</span>
            <button className="btn" onClick={() => setBulk(null)}>{t('common.cancel')}</button>
            <button className="btn btn--accent" disabled={busy || !parsed || parsed.errors.length > 0}
              onClick={async () => { if (parsed && await save(parsed.rows, t('app.env.saved'))) setBulk(null); }}>
              <Check size={16} /> {t('app.env.save')}
            </button>
          </div>
        </div>
      ) : (
        <div className="env-list">
          {rows.length === 0 && <p className="muted">{t('app.env.empty')}</p>}
          {rows.map((r) => {
            const visible = showAll || shown.has(r.key);
            if (edit?.key === r.key) {
              return (
                <form key={r.key} className="env-item env-item--edit" onSubmit={async (e) => {
                  e.preventDefault();
                  if (/[\r\n]/.test(edit.value)) return;
                  if (await save(rows.map((x) => (x.key === r.key ? { ...x, value: edit.value } : x)), t('env.savedKey', { key: r.key }))) setEdit(null);
                }}>
                  <span className="env-item__key mono">{r.key}</span>
                  <input className="input input--plain mono env-item__input" value={edit.value} autoFocus spellCheck={false} autoComplete="off"
                    onChange={(e) => setEdit({ ...edit, value: e.target.value })} onKeyDown={(e) => e.key === 'Escape' && setEdit(null)}
                    aria-label={r.key} />
                  <span className="env-item__btns">
                    <button type="submit" className="icon-btn icon-btn--ok" disabled={busy || edit.value === r.value} aria-label={t('app.env.save')}><Check size={16} /></button>
                    <button type="button" className="icon-btn" onClick={() => setEdit(null)} aria-label={t('common.cancel')}><X size={16} /></button>
                  </span>
                </form>
              );
            }
            return (
              <div key={r.key} className="env-item">
                <span className="env-item__key mono">{r.key}</span>
                <span className={`env-item__value mono${visible ? '' : ' env-item__value--masked'}`} title={visible ? r.value : undefined}>
                  {r.value === '' ? <em className="muted">{t('env.emptyValue')}</em> : visible ? r.value : '•'.repeat(Math.min(16, Math.max(8, r.value.length)))}
                </span>
                {del === r.key ? (
                  <span className="env-item__btns env-item__confirm">
                    <span className="c-danger">{t('env.deleteAsk')}</span>
                    <button className="btn btn--sm btn--danger" disabled={busy}
                      onClick={async () => { if (await save(rows.filter((x) => x.key !== r.key), t('env.deleted', { key: r.key }))) setDel(null); }}>
                      {t('fm.delete')}
                    </button>
                    <button className="btn btn--sm" onClick={() => setDel(null)}>{t('common.cancel')}</button>
                  </span>
                ) : (
                  <span className="env-item__btns">
                    <button className="icon-btn" onClick={() => toggleShown(r.key)} aria-label={visible ? t('env.hide') : t('env.show')} title={visible ? t('env.hide') : t('env.show')}>
                      {visible ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                    <button className="icon-btn" onClick={() => copy(r.value)} aria-label={t('env.copy')} title={t('env.copy')}><Copy size={16} /></button>
                    <button className="icon-btn" onClick={() => { setDel(null); setEdit({ key: r.key, value: r.value }); }} aria-label={t('env.edit')} title={t('env.edit')}><Pencil size={16} /></button>
                    <button className="icon-btn icon-btn--danger" onClick={() => { setEdit(null); setDel(r.key); }} aria-label={t('fm.delete')} title={t('fm.delete')}><Trash2 size={16} /></button>
                  </span>
                )}
              </div>
            );
          })}

          <form className="env-item env-item--add" onSubmit={async (e) => {
            e.preventDefault();
            if (addOk && await save([...rows, { key: add.key, value: add.value }], t('env.added', { key: add.key }))) setAdd({ key: '', value: '' });
          }}>
            <input className="input input--plain mono env-item__key-input" placeholder="YANGI_KALIT" value={add.key} spellCheck={false}
              onChange={(e) => setAdd({ ...add, key: e.target.value.toUpperCase().replace(/\s/g, '_') })} aria-invalid={!!addErr} aria-label={t('env.newKey')} />
            <input className="input input--plain mono env-item__input" placeholder={t('env.value')} value={add.value} spellCheck={false} autoComplete="off"
              onChange={(e) => setAdd({ ...add, value: e.target.value })} aria-label={t('env.value')} />
            <span className="env-item__btns">
              <button type="submit" className="btn btn--sm btn--accent" disabled={busy || !addOk}><Plus size={15} /> {t('env.add')}</button>
            </span>
            {addErr && <span className="form-error env-item__err">{t(`env.err.${addErr}` as 'env.err.bad')}</span>}
          </form>
        </div>
      )}
    </Card>
  );
}

import { useState } from 'react';
import { Database, Link2, Plus, Trash2, Zap } from 'lucide-react';
import { apps, databases, type DatabaseInfo } from '@/api/guardian';
import { usePoll } from '@/hooks/usePoll';
import { useT } from '@/i18n';
import { useGuardian } from '@/state/guardian';
import { useToast } from '@/state/toasts';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Card, MotionGrid } from '@/widgets/Card';
import { RowsSkeleton } from '@/widgets/Skeletons';
import type { PageProps } from './registry';

/*
 * Managed PostgreSQL / Redis. Passwords are generated on the server and only
 * ever written into the attached app's root-only env file — never shown here.
 */

const NAME_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;

export default function DatabasesPage(_props: PageProps) {
  const { t } = useT();
  const toast = useToast();
  const { me } = useGuardian();
  const isAdmin = me?.role === 'admin';
  const [tick, setTick] = useState(0);
  const list = usePoll(databases.list, 10_000, [tick]);
  const appList = usePoll(apps.list, 30_000);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', kind: 'postgres' as DatabaseInfo['kind'], mem: 256 });
  const [attach, setAttach] = useState<{ db: string; app: string } | null>(null);
  const [del, setDel] = useState<{ name: string; drop: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast({ kind: 'success', title: ok });
      setTick((x) => x + 1);
      return true;
    } catch (e) {
      toast({ kind: 'error', title: t('action.failed'), details: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const items = list.data?.databases ?? [];
  const appNames = (appList.data?.apps ?? []).map((a) => a.name);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('db.title')}</h1>
          <p className="muted">{t('db.intro')}</p>
        </div>
        <button className="btn btn--accent" onClick={() => setCreating(true)}><Plus size={16} /> {t('db.new')}</button>
      </div>

      {!list.data && !list.error ? <RowsSkeleton rows={2} h={110} /> : items.length === 0 ? (
        <Card>
          <div className="empty">
            <div className="empty__icon"><Database size={28} /></div>
            <h2>{t('db.empty.title')}</h2>
            <p>{t('db.empty.body')}</p>
            <button className="btn btn--accent" onClick={() => setCreating(true)}><Plus size={16} /> {t('db.new')}</button>
          </div>
        </Card>
      ) : (
        <MotionGrid className="project-grid">
          {items.map((d) => (
            <Card key={d.name} className="project-card">
              <div className="project-card__head">
                <span className={`project-card__icon tint--${d.kind === 'postgres' ? 'info' : 'danger'}`}>
                  {d.kind === 'postgres' ? <Database size={22} /> : <Zap size={22} />}
                </span>
                <div className="project-card__title">
                  <span className="project-card__name mono">{d.name}</span>
                  <span className="card__meta mono">{d.image} · {d.mem_mb} MB</span>
                </div>
                <span className={`pill ${d.state === 'running' ? 'pill--success' : 'pill--danger'}`}>{d.state}</span>
              </div>
              <div className="project-card__meta">
                <span className="mono">{t('db.internal')}: {d.host}:{d.port}</span>
                <span>{d.attached.length ? t('db.attachedTo', { list: d.attached.join(', ') }) : t('db.notAttached')}</span>
              </div>
              <div className="project-card__actions">
                <button className="btn btn--sm" disabled={busy || appNames.length === 0} onClick={() => setAttach({ db: d.name, app: appNames[0] ?? '' })}>
                  <Link2 size={14} /> {t('db.attach')}
                </button>
                <button className="btn btn--sm btn--ghost" disabled={!isAdmin} title={isAdmin ? undefined : t('identity.adminOnly')}
                  onClick={() => setDel({ name: d.name, drop: false })}><Trash2 size={14} /></button>
              </div>
            </Card>
          ))}
        </MotionGrid>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title={t('db.new')}>
        <form className="wizard" onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => databases.create(form.name, form.kind, form.mem), t('db.created'))) {
            setCreating(false);
            setForm({ name: '', kind: 'postgres', mem: 256 });
          }
        }}>
          <div className="choices">
            {(['postgres', 'redis'] as const).map((k) => (
              <button type="button" key={k} className="choice" aria-pressed={form.kind === k} onClick={() => setForm({ ...form, kind: k })}>
                {k === 'postgres' ? 'PostgreSQL 17' : 'Redis 7'}
              </button>
            ))}
          </div>
          <label className="field">
            <span className="field__label">{t('db.name')}</span>
            <input className="input input--plain mono" value={form.name} autoFocus maxLength={32} placeholder={form.kind === 'postgres' ? 'shop-db' : 'cache'}
              onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase() })} aria-invalid={!!form.name && !NAME_RE.test(form.name)} />
            {form.name && !NAME_RE.test(form.name) && <span className="form-error">{t('wizard.invalidName')}</span>}
          </label>
          <label className="field">
            <span className="field__label">{t('db.mem')}</span>
            <select className="select" value={form.mem} onChange={(e) => setForm({ ...form, mem: Number(e.target.value) })}>
              {[128, 256, 512, 1024, 2048].map((m) => <option key={m} value={m}>{m >= 1024 ? `${m / 1024} GB` : `${m} MB`}</option>)}
            </select>
          </label>
          <div className="modal__actions">
            <button type="button" className="btn" onClick={() => setCreating(false)}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn--accent" disabled={busy || !NAME_RE.test(form.name)}>{busy ? t('common.loading') : t('db.create')}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!attach} onClose={() => setAttach(null)} title={t('db.attach')}>
        {attach && (
          <div className="wizard">
            <label className="field">
              <span className="field__label">{t('db.attachTo')}</span>
              <select className="select" value={attach.app} onChange={(e) => setAttach({ ...attach, app: e.target.value })}>
                {appNames.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <div className="modal__actions">
              <button className="btn" onClick={() => setAttach(null)}>{t('common.cancel')}</button>
              <button className="btn btn--accent" disabled={busy || !attach.app} onClick={async () => {
                setBusy(true);
                try {
                  const r = await databases.attach(attach.db, attach.app);
                  toast({ kind: 'success', title: t('db.attached', { app: r.app, var: r.var }) });
                  setAttach(null);
                  setTick((x) => x + 1);
                } catch (e) {
                  toast({ kind: 'error', title: t('action.failed'), details: e instanceof Error ? e.message : String(e) });
                } finally {
                  setBusy(false);
                }
              }}><Link2 size={15} /> {t('db.attach')}</button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!del}
        title={t('db.delete')}
        body={del ? (
          <>
            <p>{t('db.delete.body', { name: del.name })}</p>
            <label className="check-line">
              <input type="checkbox" checked={del.drop} onChange={(e) => setDel({ ...del, drop: e.target.checked })} />
              <span className="c-danger">{t('db.dropData')}</span>
            </label>
          </>
        ) : ''}
        confirmLabel={t('db.delete')}
        expected={del?.name}
        busy={busy}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          const d = del;
          setDel(null);
          await run(() => databases.remove(d.name, d.name, d.drop), t('db.delete'));
        }}
      />
    </>
  );
}

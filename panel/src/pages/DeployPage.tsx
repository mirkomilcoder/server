import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Bot, Box, Code2, ExternalLink, FileCode2, Globe, Hexagon, Play, Plus, RefreshCw, Rocket, RotateCcw, Square, Trash2, Zap,
} from 'lucide-react';
import { apps, type AppDetail, type AppInfo, type AppType, type DeployStatus } from '@/api/guardian';
import { usePoll } from '@/hooks/usePoll';
import { useT, type TranslationKey } from '@/i18n';
import { routeOption } from '@/router';
import { cockpit } from '@/api/cockpit';
import { useBrand, useGuardian } from '@/state/guardian';
import { useToast } from '@/state/toasts';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Card, MotionGrid } from '@/widgets/Card';
import { DeployLog } from '@/widgets/DeployLog';
import { NewAppWizard } from '@/widgets/NewAppWizard';
import { RowsSkeleton } from '@/widgets/Skeletons';
import { timeAgo } from '@/widgets/home';
import type { PageProps } from './registry';

/*
 * Render-like projects: list → details (overview + deploy history with
 * rollback, runtime logs, env editor, settings/delete). All actions go
 * through Guardian (role checks) → root helper (Docker).
 */

export const TYPE_ICON: Record<AppType, typeof Box> = {
  dockerfile: Box, django: Code2, fastapi: Zap, flask: FileCode2, bot: Bot, node: Hexagon, static: Globe,
};

export function appState(a: Pick<AppInfo, 'current' | 'last_deploy'>): 'running' | 'deploying' | 'failed' | 'never' {
  if (a.last_deploy?.state === 'running') return 'deploying';
  if (a.current?.container) return 'running';
  if (a.last_deploy?.state === 'failed') return 'failed';
  return 'never';
}

const STATE_PILL = { running: 'pill--success', deploying: 'pill--info', failed: 'pill--danger', never: 'pill--muted' } as const;
const STATE_LABEL: Record<ReturnType<typeof appState>, TranslationKey> = {
  running: 'deploy.running', deploying: 'deploy.deploying', failed: 'deploy.failed', never: 'deploy.never',
};

function ProjectCard({ a, open, redeploy }: { a: AppInfo; open: () => void; redeploy: () => void }) {
  const { t } = useT();
  const st = appState(a);
  const Icon = TYPE_ICON[(a.current?.type ?? a.last_deploy?.type ?? a.type ?? 'dockerfile') as AppType] ?? Box;
  const d = a.last_deploy;
  return (
    <Card className="project-card">
      <div className="project-card__head">
        <span className="project-card__icon tint--accent"><Icon size={22} /></span>
        <div className="project-card__title">
          <button className="link-btn project-card__name mono" onClick={open}>{a.name}</button>
          <span className="card__meta mono">{a.repo.replace('https://', '')} · {a.branch}</span>
        </div>
        <span className={`pill ${STATE_PILL[st]}`}>{t(STATE_LABEL[st])}</span>
      </div>
      <div className="project-card__meta">
        {a.url ? (
          <span title={t('deploy.domainNote')} className="mono"><Globe size={14} /> {a.url.replace('http://', '')}</span>
        ) : a.current?.container ? (
          <span><Bot size={14} /> {t('deploy.worker')}</span>
        ) : null}
        {d && <span>{t('deploy.lastDeploy')}: {timeAgo(t, d.started)} · {t('deploy.by', { u: d.by })}</span>}
        {d?.commit && <span className="mono subtle project-card__commit">{d.commit}</span>}
        {a.stats && <span className="mono">CPU {a.stats.cpu} · RAM {a.stats.mem.split('/')[0].trim()}</span>}
      </div>
      <div className="project-card__actions">
        <button className="btn btn--sm" onClick={redeploy} disabled={st === 'deploying'}><RefreshCw size={14} /> {t('deploy.redeploy')}</button>
        <button className="btn btn--sm btn--ghost" onClick={open}>{t('deploy.details')} →</button>
      </div>
    </Card>
  );
}

function AppView({ name, back, initialDeploy }: { name: string; back: () => void; initialDeploy: string | null }) {
  const { t, locale } = useT();
  const toast = useToast();
  const { me } = useGuardian();
  const [tab, setTab] = useState<'overview' | 'logs' | 'env' | 'settings'>('overview');
  const [tick, setTick] = useState(0);
  const detail = usePoll(() => apps.detail(name), 8000, [tick]);
  const [watch, setWatch] = useState<string | null>(initialDeploy);
  const [confirm, setConfirm] = useState<{ kind: 'rollback' | 'delete'; id?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const a = detail.data;
  const isAdmin = me?.role === 'admin';
  const fmt = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
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

  const running = a?.deploys.find((d) => d.state === 'running');
  useEffect(() => {
    if (running && !watch) setWatch(running.id);
  }, [running, watch]);

  return (
    <>
      <div className="page-head">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="icon-btn" onClick={back} aria-label={t('common.back')}><ArrowLeft size={18} /></button>
          <div>
            <h1 className="mono">{name}</h1>
            {a && <p className="muted mono">{a.repo.replace('https://', '')} · {a.branch}</p>}
          </div>
        </div>
        <div className="page-head__actions">
          {a?.url && <span className="pill pill--muted mono" title={t('deploy.domainNote')}><Globe size={13} /> {a.url.replace('http://', '')}</span>}
          <button className="btn btn--accent" disabled={busy || !!running} onClick={async () => {
            const r = (await act(() => apps.deploy(name))) as { deploy_id: string } | null;
            if (r) setWatch(r.deploy_id);
          }}><Rocket size={16} /> {t('deploy.redeploy')}</button>
        </div>
      </div>

      <div className="chips" role="tablist">
        {(['overview', 'logs', 'env', 'settings'] as const).map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} className={`chip${tab === x ? ' chip--on' : ''}`} onClick={() => setTab(x)}>
            {t(`app.tab.${x}` as TranslationKey)}
          </button>
        ))}
      </div>

      {!a ? <RowsSkeleton rows={4} h={60} /> : (
        <MotionGrid className="grid">
          {tab === 'overview' && (
            <>
              {watch && (
                <Card title={t('app.deployLog')}>
                  <DeployLog app={name} id={watch} onDone={(s: DeployStatus) => {
                    setTick((x) => x + 1);
                    toast({ kind: s.state === 'success' ? 'success' : 'error', title: `${name}: ${s.state === 'success' ? '✓' : s.error ?? 'xato'}` });
                  }} />
                </Card>
              )}
              <Card title={t('app.deploys')}>
                <div className="deploy-list">
                  {a.deploys.length === 0 && <p className="muted">{t('app.notDeployed')}</p>}
                  {a.deploys.map((d) => (
                    <div className="deploy-row" key={d.id}>
                      <span className={`dot dot--${d.state === 'success' ? 'success' : d.state === 'failed' ? 'danger' : 'warning'}${d.state === 'running' ? ' dot--live' : ''}`} />
                      <span className="mono subtle">{fmt.format(new Date(d.started * 1000))}</span>
                      <span className="deploy-row__commit mono">{d.commit || d.error || d.step}</span>
                      <span className="subtle">{d.by}</span>
                      <span className="deploy-row__actions">
                        {a.current?.deploy_id === d.id && <span className="pill pill--success">{t('app.current')}</span>}
                        <button className="btn btn--sm btn--ghost" onClick={() => setWatch(d.id)}>{t('app.tab.logs')}</button>
                        {d.state === 'success' && a.current?.deploy_id !== d.id && (
                          <button className="btn btn--sm" disabled={busy || !!running} onClick={() => setConfirm({ kind: 'rollback', id: d.id })}>
                            <RotateCcw size={14} /> {t('app.rollback')}
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}
          {tab === 'logs' && <RuntimeLogs name={name} deployed={!!a.current?.container} onControl={(op) => act(() => apps.control(name, op), t(`app.${op}` as TranslationKey))} busy={busy} />}
          {tab === 'env' && <EnvEditor a={a} onSaved={() => setTick((x) => x + 1)} />}
          {tab === 'settings' && <SettingsTab a={a} isAdmin={isAdmin} onSaved={() => setTick((x) => x + 1)} onDelete={() => setConfirm({ kind: 'delete' })} />}
        </MotionGrid>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === 'delete' ? t('app.delete') : t('app.rollback')}
        body={confirm?.kind === 'delete' ? t('app.delete.body', { name }) : t('app.rollback.confirm', { id: confirm?.id ?? '' })}
        confirmLabel={confirm?.kind === 'delete' ? t('app.delete') : t('app.rollback')}
        tone={confirm?.kind === 'delete' ? 'danger' : 'warning'}
        expected={confirm?.kind === 'delete' ? name : undefined}
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          const c = confirm;
          setConfirm(null);
          if (c?.kind === 'delete') {
            if (await act(() => apps.remove(name, name), t('app.delete'))) back();
          } else if (c?.id) {
            const r = (await act(() => apps.rollback(name, c.id!))) as { deploy_id: string } | null;
            if (r) setWatch(r.deploy_id);
          }
        }}
      />
    </>
  );
}

function RuntimeLogs({ name, deployed, onControl, busy }: { name: string; deployed: boolean; onControl: (op: 'start' | 'stop' | 'restart') => void; busy: boolean }) {
  const { t } = useT();
  const logs = usePoll(() => (deployed ? apps.logs(name, 400) : Promise.resolve({ text: '' })), 4000, [deployed]);
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [logs.data]);
  if (!deployed) return <Card><p className="muted">{t('app.notDeployed')}</p></Card>;
  return (
    <Card title={t('app.tab.logs')} tools={
      <span className="page-head__actions">
        <button className="btn btn--sm" disabled={busy} onClick={() => onControl('restart')}><RefreshCw size={14} /> {t('app.restart')}</button>
        <button className="btn btn--sm" disabled={busy} onClick={() => onControl('stop')}><Square size={13} /> {t('app.stop')}</button>
        <button className="btn btn--sm" disabled={busy} onClick={() => onControl('start')}><Play size={14} /> {t('app.start')}</button>
      </span>
    }>
      <pre className="console console--logs" ref={box}>{logs.data?.text || '…'}</pre>
    </Card>
  );
}

function EnvEditor({ a, onSaved }: { a: AppDetail; onSaved: () => void }) {
  const { t } = useT();
  const toast = useToast();
  // existing keys: kept unless removed; a typed value replaces it
  const [rows, setRows] = useState(() => a.env.map((e) => ({ key: e.key, length: e.length, value: '', existing: true, removed: false })));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const env: Record<string, string> = {};
      const keep: string[] = [];
      for (const r of rows) {
        if (r.removed || !r.key) continue;
        if (r.value) env[r.key] = r.value;
        else if (r.existing) keep.push(r.key);
      }
      await apps.setEnv(a.name, env, keep);
      toast({ kind: 'success', title: t('app.env.saved') });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: t('action.failed'), details: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('app.tab.env')} tools={<button className="btn btn--accent btn--sm" onClick={save} disabled={busy}>{t('app.env.save')}</button>}>
      <p className="card__meta" style={{ marginBottom: 12 }}>{t('wizard.envHint')}</p>
      {rows.filter((r) => !r.removed).length === 0 && <p className="muted">{t('app.env.empty')}</p>}
      {rows.map((r, i) => r.removed ? null : (
        <div className="env-row" key={i}>
          <input className="input input--plain mono" value={r.key} disabled={r.existing} placeholder="KEY"
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, key: e.target.value.toUpperCase() } : x)))} />
          <input className="input input--plain mono" type="password" autoComplete="off" value={r.value}
            placeholder={r.existing ? t('app.env.hidden', { n: r.length }) : 'value'}
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
          <button className="icon-btn" aria-label="remove" onClick={() => setRows(rows.map((x, j) => (j === i ? { ...x, removed: true } : x)))}><Trash2 size={16} /></button>
        </div>
      ))}
      <button className="btn btn--ghost btn--sm" onClick={() => setRows([...rows, { key: '', length: 0, value: '', existing: false, removed: false }])}>
        <Plus size={15} /> {t('wizard.addEnv')}
      </button>
    </Card>
  );
}

function SettingsTab({ a, isAdmin, onSaved, onDelete }: { a: AppDetail; isAdmin: boolean; onSaved: () => void; onDelete: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const [branch, setBranch] = useState(a.branch);
  const [type, setType] = useState<AppType | ''>(a.type ?? '');
  const [mem, setMem] = useState(a.mem_mb);
  const [cpus, setCpus] = useState(a.cpus);
  const [port, setPort] = useState(a.port);
  const save = async () => {
    try {
      await apps.settings(a.name, { branch, type: type || null, mem_mb: mem, cpus, port });
      toast({ kind: 'success', title: t('app.settings.saved') });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: t('action.failed'), details: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <>
      <Card title={t('app.tab.settings')} tools={<button className="btn btn--accent btn--sm" onClick={save}>{t('app.env.save')}</button>}>
        <div className="wizard__row">
          <label className="field"><span className="field__label">{t('wizard.branch')}</span>
            <input className="input input--plain mono" value={branch} onChange={(e) => setBranch(e.target.value)} /></label>
          <label className="field"><span className="field__label">{t('wizard.type')}</span>
            <select className="select" value={type} onChange={(e) => setType(e.target.value as AppType | '')}>
              <option value="">{t('wizard.typeAuto')}</option>
              {(['dockerfile', 'django', 'fastapi', 'flask', 'bot', 'node', 'static'] as AppType[]).map((x) => <option key={x} value={x}>{t(`type.${x}` as TranslationKey)}</option>)}
            </select></label>
        </div>
        <div className="wizard__row">
          <label className="field"><span className="field__label">{t('wizard.mem')}</span>
            <select className="select" value={mem} onChange={(e) => setMem(Number(e.target.value))}>
              {[128, 256, 512, 1024, 2048, 4096].map((m) => <option key={m} value={m}>{m >= 1024 ? `${m / 1024} GB` : `${m} MB`}</option>)}
            </select></label>
          <label className="field"><span className="field__label">{t('wizard.cpu')}</span>
            <select className="select" value={cpus} onChange={(e) => setCpus(Number(e.target.value))}>
              {[0.25, 0.5, 1, 2, 4].map((c) => <option key={c} value={c}>{c} CPU</option>)}
            </select></label>
          <label className="field"><span className="field__label">{t('wizard.port')}</span>
            <input className="input input--plain" type="number" min={0} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value) || 0)} /></label>
        </div>
      </Card>
      <AutoDeployCard a={a} onSaved={onSaved} />
      <DeployKeyCard name={a.name} />
      <Card className="danger-zone" title={t('app.delete')}>
        <p className="muted" style={{ marginBottom: 12 }}>{t('app.delete.body', { name: a.name })}</p>
        <button className="btn btn--danger" disabled={!isAdmin} onClick={onDelete} title={isAdmin ? undefined : t('identity.adminOnly')}>
          <Trash2 size={16} /> {t('app.delete')} <span className="badge badge--warning">{t('admin.badge')}</span>
        </button>
      </Card>
    </>
  );
}

function AutoDeployCard({ a, onSaved }: { a: AppDetail; onSaved: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const [on, setOn] = useState(!!a.autodeploy);
  const toggle = async (v: boolean) => {
    setOn(v);
    try {
      await apps.setAutodeploy(a.name, v);
      onSaved();
    } catch (e) {
      setOn(!v);
      toast({ kind: 'error', title: t('action.failed'), details: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <Card title={t('auto.title')} tools={
      <label className="switch">
        <input type="checkbox" role="switch" checked={on} onChange={(e) => toggle(e.target.checked)} aria-label={t('auto.title')} />
        <span className="switch__track" aria-hidden />
      </label>
    }>
      <p className="muted">{t('auto.help')}</p>
    </Card>
  );
}

function DeployKeyCard({ name }: { name: string }) {
  const { t } = useT();
  const toast = useToast();
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const show = async () => {
    setBusy(true);
    try {
      setKey((await apps.deployKey(name)).public_key);
    } catch (e) {
      toast({ kind: 'error', title: t('action.failed'), details: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={t('key.title')}>
      <p className="muted" style={{ marginBottom: 12 }}>{t('key.help')}</p>
      {key ? (
        <div className="key-box">
          <code className="mono">{key}</code>
          <button className="btn btn--sm" onClick={async () => {
            try { await navigator.clipboard.writeText(key); toast({ kind: 'success', title: t('key.copied') }); } catch { /* ignore */ }
          }}>{t('key.copy')}</button>
        </div>
      ) : (
        <button className="btn btn--sm" disabled={busy} onClick={show}>{t('key.create')}</button>
      )}
    </Card>
  );
}

export default function DeployPage({ go }: PageProps) {
  const { t } = useT();
  const toast = useToast();
  const { domain } = useBrand();
  const [wizard, setWizard] = useState(false);
  const [view, setView] = useState<{ name: string; deploy: string | null } | null>(() => {
    const n = routeOption('app');
    return n ? { name: n, deploy: null } : null;
  });
  const [tick, setTick] = useState(0);
  const list = usePoll(apps.list, 6000, [tick, view?.name]);

  // follow the URL (#/deploy?app=…): dashboard links, browser back/forward
  useEffect(() => {
    const sync = () => {
      const n = routeOption('app');
      setView((v) => (n ? (v?.name === n ? v : { name: n, deploy: null }) : null));
    };
    cockpit().addEventListener('locationchanged', sync);
    return () => cockpit().removeEventListener('locationchanged', sync);
  }, []);

  const open = (name: string, deploy: string | null = null) => {
    setView({ name, deploy });
    go('deploy', { app: name });
  };

  if (view) return <AppView key={view.name} name={view.name} initialDeploy={view.deploy} back={() => { setView(null); go('deploy'); setTick((x) => x + 1); }} />;

  const items = list.data?.apps ?? [];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('deploy.title')}</h1>
          <p className="muted">{t('deploy.intro')}</p>
        </div>
        <button className="btn btn--accent" onClick={() => setWizard(true)}><Plus size={16} /> {t('deploy.new')}</button>
      </div>

      {!list.data && !list.error ? (
        <RowsSkeleton rows={3} h={120} />
      ) : items.length === 0 ? (
        <Card>
          <div className="empty">
            <div className="empty__icon"><Rocket size={28} /></div>
            <h2>{t('deploy.empty.title')}</h2>
            <p>{t('deploy.empty.body')}</p>
            <button className="btn btn--accent" onClick={() => setWizard(true)}><Plus size={16} /> {t('deploy.new')}</button>
          </div>
        </Card>
      ) : (
        <MotionGrid className="project-grid">
          {items.map((a) => (
            <ProjectCard key={a.name} a={a} open={() => open(a.name)}
              redeploy={async () => {
                try {
                  const r = await apps.deploy(a.name);
                  open(a.name, r.deploy_id);
                } catch (e) {
                  toast({ kind: 'error', title: t('action.failed'), details: e instanceof Error ? e.message : String(e) });
                }
              }} />
          ))}
        </MotionGrid>
      )}
      <p className="card__meta" style={{ marginTop: 14 }}><ExternalLink size={13} /> {t('deploy.domainNote')} · *.{domain}</p>

      <NewAppWizard open={wizard} onClose={() => setWizard(false)} onCreated={(name, id) => { setWizard(false); open(name, id); }} />
    </>
  );
}

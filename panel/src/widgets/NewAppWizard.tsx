import { useMemo, useState } from 'react';
import { GitBranch, Github, Plus, Rocket, Trash2 } from 'lucide-react';
import { apps, type AppType } from '@/api/guardian';
import { useT, type TranslationKey } from '@/i18n';
import { useBrand } from '@/state/guardian';
import { useToast } from '@/state/toasts';
import { Modal } from '@/components/Modal';

/*
 * New project: GitHub URL → name (auto) → branch → type (auto) → limits → env.
 * Same validation rules as the server (agent/mirkomil/paas/engine.py);
 * the server re-checks everything anyway.
 */

// public https://… or private git@host:owner/repo.git (deploy key) — same rule as the server
const REPO_RE = /^(https:\/\/(github\.com|gitlab\.com|codeberg\.org)\/|git@(github\.com|gitlab\.com|codeberg\.org):)[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}?(\.git)?$/;
const APP_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const TYPES: AppType[] = ['dockerfile', 'django', 'fastapi', 'flask', 'bot', 'node', 'static'];
const MEMS = [128, 256, 512, 1024, 2048];
const CPUS = [0.25, 0.5, 1, 2];

/** "https://github.com/acme/My_Shop.git" → "my-shop" */
export function nameFromRepo(repo: string): string {
  const last = repo.replace(/\.git$/, '').split('/').pop() ?? '';
  let n = last.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[0-9-]+/, '');
  if (n.length > 32) n = n.slice(0, 32).replace(/-+$/, '');
  return n.length >= 3 ? n : '';
}

export function NewAppWizard({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (name: string, deployId: string) => void }) {
  const { t } = useT();
  const toast = useToast();
  const { domain } = useBrand();
  const [repo, setRepo] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [branch, setBranch] = useState('main');
  const [type, setType] = useState<AppType | ''>('');
  const [port, setPort] = useState(0);
  const [mem, setMem] = useState(512);
  const [cpus, setCpus] = useState(1);
  const [site, setSite] = useState<'auto' | 'yes' | 'no'>('auto');
  const siteRequired = type === 'django' || type === 'fastapi' || type === 'flask' || type === 'static';
  const [env, setEnv] = useState<{ k: string; v: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const effName = nameTouched ? name : nameFromRepo(repo);
  const repoOk = REPO_RE.test(repo.trim());
  const nameOk = APP_RE.test(effName);
  const envOk = useMemo(() => env.every((e) => !e.k || (ENV_KEY_RE.test(e.k) && e.k !== 'PORT' && !/[\r\n]/.test(e.v))), [env]);

  const reset = () => {
    setRepo(''); setName(''); setNameTouched(false); setBranch('main'); setType(''); setPort(0); setMem(512); setCpus(1); setEnv([]); setSite('auto');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoOk || !nameOk || !envOk) return;
    setBusy(true);
    try {
      const envObj = Object.fromEntries(env.filter((x) => x.k).map((x) => [x.k, x.v]));
      const r = await apps.create({ name: effName, repo: repo.trim(), branch: branch.trim() || 'main', type: type || null, port, mem_mb: mem, cpus, env: envObj,
        public: siteRequired || site === 'auto' ? null : site === 'yes' });
      reset();
      onCreated(effName, r.deploy_id);
    } catch (err) {
      toast({ kind: 'error', title: t('action.failed'), details: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('wizard.title')}>
      <form className="wizard" onSubmit={submit}>
        <label className="field">
          <span className="field__label">{t('wizard.repo')}</span>
          <span className="input-wrap">
            <Github size={17} aria-hidden />
            <input className="input mono" placeholder="https://github.com/user/project" value={repo} autoFocus
              onChange={(e) => setRepo(e.target.value)} aria-invalid={!!repo && !repoOk} />
          </span>
          <span className={repo && !repoOk ? 'form-error' : 'card__meta'}>{repo && !repoOk ? t('wizard.invalidRepo') : repo.startsWith('git@') ? t('wizard.repoHintPrivate') : t('wizard.repoHint')}</span>
        </label>

        <div className="wizard__row">
          <label className="field">
            <span className="field__label">{t('wizard.name')}</span>
            <input className="input input--plain mono" value={effName} maxLength={32}
              onChange={(e) => { setNameTouched(true); setName(e.target.value.toLowerCase()); }} aria-invalid={!!effName && !nameOk} />
            <span className={effName && !nameOk ? 'form-error' : 'card__meta mono'}>
              {effName && !nameOk ? t('wizard.invalidName') : t('wizard.nameHint', { name: effName || '…', domain })}
            </span>
          </label>
          <label className="field">
            <span className="field__label">{t('wizard.branch')}</span>
            <span className="input-wrap">
              <GitBranch size={17} aria-hidden />
              <input className="input mono" value={branch} onChange={(e) => setBranch(e.target.value)} maxLength={100} />
            </span>
          </label>
        </div>

        <label className="field">
          <span className="field__label">{t('wizard.type')}</span>
          <select className="select" value={type} onChange={(e) => setType(e.target.value as AppType | '')}>
            <option value="">{t('wizard.typeAuto')}</option>
            {TYPES.map((x) => <option key={x} value={x}>{t(`type.${x}` as TranslationKey)}</option>)}
          </select>
        </label>

        <div className="field">
          <span className="field__label">{t('site.title')}</span>
          <div className="choices">
            {(['auto', 'yes', 'no'] as const).map((v) => (
              <button type="button" key={v} className="choice" disabled={siteRequired && v !== 'yes'}
                aria-pressed={siteRequired ? v === 'yes' : site === v} onClick={() => setSite(v)}>
                {t(`site.choice.${v}`)}
              </button>
            ))}
          </div>
          <span className="card__meta">
            {siteRequired ? t('site.requiredShort') : type === 'bot' ? t('site.bot') : t('site.autoHint')}
          </span>
        </div>

        <details className="wizard__more">
          <summary>{t('wizard.advanced')}</summary>
          <div className="wizard__row">
            <label className="field">
              <span className="field__label">{t('wizard.mem')}</span>
              <select className="select" value={mem} onChange={(e) => setMem(Number(e.target.value))}>
                {MEMS.map((m) => <option key={m} value={m}>{m >= 1024 ? `${m / 1024} GB` : `${m} MB`}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field__label">{t('wizard.cpu')}</span>
              <select className="select" value={cpus} onChange={(e) => setCpus(Number(e.target.value))}>
                {CPUS.map((c) => <option key={c} value={c}>{c} CPU</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field__label">{t('wizard.port')}</span>
              <input className="input input--plain" type="number" min={0} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value) || 0)} />
            </label>
          </div>
        </details>

        <div className="field">
          <span className="field__label">{t('wizard.env')}</span>
          <span className="card__meta">{t('wizard.envHint')}</span>
          {env.map((row, i) => (
            <div className="env-row" key={i}>
              <input className="input input--plain mono" placeholder="KEY" value={row.k} aria-invalid={!!row.k && !ENV_KEY_RE.test(row.k)}
                onChange={(e) => setEnv(env.map((x, j) => (j === i ? { ...x, k: e.target.value.toUpperCase() } : x)))} />
              <input className="input input--plain mono" placeholder="value" type="password" autoComplete="off" value={row.v}
                onChange={(e) => setEnv(env.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
              <button type="button" className="icon-btn" aria-label="remove" onClick={() => setEnv(env.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
            </div>
          ))}
          <button type="button" className="btn btn--ghost btn--sm" style={{ justifySelf: 'start' }} onClick={() => setEnv([...env, { k: '', v: '' }])}>
            <Plus size={15} /> {t('wizard.addEnv')}
          </button>
        </div>

        <div className="modal__actions">
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn--accent" disabled={busy || !repoOk || !nameOk || !envOk}>
            <Rocket size={16} /> {busy ? t('common.loading') : t('wizard.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

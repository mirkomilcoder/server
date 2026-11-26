import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, RefreshCw, RotateCcw, ShieldAlert } from 'lucide-react';
import { cockpit } from '@/api/cockpit';
import { runAction } from '@/api/run';
import { usePoll } from '@/hooks/usePoll';
import { useAction } from '@/hooks/useAction';
import { useT } from '@/i18n';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Card, MotionGrid } from '@/widgets/Card';
import { RowsSkeleton } from '@/widgets/Skeletons';
import type { PageProps } from './registry';

/*
 * apt updates: list (no root), refresh + full upgrade (admin, streamed live),
 * and the "reboot required" flag (/run/reboot-required).
 */

export interface Upgradable {
  name: string;
  from: string;
  to: string;
  security: boolean;
}

/** `apt list --upgradable` (LC_ALL=C):  name/suite version arch [upgradable from: old] */
export function parseUpgradable(out: string): Upgradable[] {
  const rx = /^([^/\s]+)\/(\S+)\s+(\S+)\s+\S+\s+\[upgradable from: ([^\]]+)\]/;
  return out
    .split('\n')
    .map((l) => rx.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ name: m[1], to: m[3], from: m[4], security: m[2].split(',').some((s) => s.endsWith('-security')) }))
    .sort((a, b) => Number(b.security) - Number(a.security) || a.name.localeCompare(b.name));
}

function useRebootRequired(tick: number) {
  const [required, setRequired] = useState(false);
  useEffect(() => {
    const f = cockpit().file('/run/reboot-required');
    const h = f.watch((content) => setRequired(content !== null), { read: true });
    return () => { h.remove(); f.close(); };
  }, [tick]);
  return required;
}

export default function UpdatesPage({ go }: PageProps) {
  const { t } = useT();
  const { run, busy, isAdmin } = useAction();
  const [tick, setTick] = useState(0);
  const list = usePoll(async () => parseUpgradable(await runAction('updates.list', {})), 60_000, [tick]);
  const reboot = useRebootRequired(tick);
  const [confirm, setConfirm] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const logBox = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight;
  }, [log]);

  const pkgs = list.data ?? [];
  const security = pkgs.filter((p) => p.security).length;

  const refresh = async () => {
    if ((await run('updates.refresh', {})) !== null) setTick((x) => x + 1);
  };

  const upgrade = async () => {
    setConfirm(false);
    setUpgrading(true);
    setLog('');
    const out = await run('updates.upgrade', {}, {
      success: t('updates.done'),
      onOutput: (chunk) => setLog((l) => ((l ?? '') + chunk).slice(-200_000)),
    });
    setUpgrading(false);
    if (out !== null) setTick((x) => x + 1);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('updates.title')}</h1>
          <p className="muted">{t('updates.auto')}</p>
        </div>
        <div className="page-head__actions">
          <button className="btn" onClick={refresh} disabled={!!busy}>
            <RefreshCw size={16} className={busy === 'updates.refresh' ? 'spin' : undefined} /> {t('updates.check')}
            <span className="badge badge--warning">{t('admin.badge')}</span>
          </button>
          <button className="btn btn--accent" disabled={!pkgs.length || upgrading || !!busy}
            onClick={() => (isAdmin ? setConfirm(true) : run('updates.upgrade', {}))}>
            <Download size={16} /> {t('updates.upgradeAll')}
          </button>
        </div>
      </div>

      {reboot && (
        <div className="notice notice--warning" role="status">
          <RotateCcw size={18} />
          <span><b>{t('updates.reboot')}.</b> {t('updates.reboot.body')}</span>
          <button className="btn btn--warning btn--sm" onClick={() => go('power')}>{t('power.reboot')}</button>
        </div>
      )}

      <MotionGrid className="grid">
        {log !== null && (
          <Card title={upgrading ? t('updates.running') : t('updates.output')}>
            <pre className="console console--tall" ref={logBox}>{log || '…'}</pre>
          </Card>
        )}
        <Card
          title={!list.data ? t('updates.title') : pkgs.length ? t('updates.count', { n: pkgs.length }) : t('updates.none')}
          tools={security > 0 && <span className="pill pill--warning"><ShieldAlert size={13} /> {t('updates.securityCount', { n: security })}</span>}
        >
          {!list.data ? (
            <RowsSkeleton rows={5} h={36} />
          ) : pkgs.length === 0 ? (
            <div className="empty empty--compact">
              <div className="empty__icon tint--success"><CheckCircle2 size={26} /></div>
              <h2>{t('updates.none')}</h2>
            </div>
          ) : (
            <div className="pkg-table" role="table">
              <div className="pkg-row pkg-row--head" role="row">
                <span>{t('updates.col.pkg')}</span><span>{t('updates.col.from')}</span><span>{t('updates.col.to')}</span>
              </div>
              {pkgs.map((p) => (
                <div className="pkg-row" role="row" key={p.name}>
                  <span className="mono">{p.name} {p.security && <span className="pill pill--warning">{t('updates.security')}</span>}</span>
                  <span className="mono subtle">{p.from}</span>
                  <span className="mono">{p.to}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </MotionGrid>

      <ConfirmDialog
        open={confirm}
        title={t('updates.upgradeAll')}
        body={t('updates.confirm', { n: pkgs.length })}
        confirmLabel={t('updates.upgradeAll')}
        tone="warning"
        onClose={() => setConfirm(false)}
        onConfirm={upgrade}
      />
    </>
  );
}

import { useState } from 'react';
import { FileText, Play, RefreshCw, Sparkles, Square } from 'lucide-react';
import { docker, GuardianUnavailable, type DockerContainer } from '@/api/guardian';
import { usePoll } from '@/hooks/usePoll';
import { useT } from '@/i18n';
import { useGuardian } from '@/state/guardian';
import { useToast } from '@/state/toasts';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Modal } from '@/components/Modal';
import { Card, MotionGrid } from '@/widgets/Card';
import { RowsSkeleton } from '@/widgets/Skeletons';
import type { PageProps } from './registry';

/* All Docker containers (admin only — enforced by Guardian): status, usage, start/stop/restart, logs, prune. */
export default function DockerPage(_props: PageProps) {
  const { t } = useT();
  const toast = useToast();
  const { me } = useGuardian();
  const isAdmin = me?.role === 'admin';
  const [tick, setTick] = useState(0);
  const data = usePoll(() => (isAdmin ? docker.containers() : Promise.resolve(null)), 8000, [isAdmin, tick]);
  const [logs, setLogs] = useState<{ name: string; text: string } | null>(null);
  const [prune, setPrune] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast({ kind: 'success', title: ok });
      setTick((x) => x + 1);
    } catch (e) {
      toast({ kind: 'error', title: t('action.failed'), details: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  if (me && !isAdmin) return <Card><p className="muted">{t('docker.adminOnly')}</p></Card>;
  if (data.error instanceof GuardianUnavailable) return <Card><p className="muted">{t('guardian.unavailable')}</p></Card>;

  const list: DockerContainer[] = data.data?.containers ?? [];
  const stats = data.data?.stats ?? {};

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('docker.title')}</h1>
          <p className="muted">{t('docker.intro')}</p>
        </div>
        <button className="btn" disabled={busy} onClick={() => setPrune(true)}><Sparkles size={16} /> {t('docker.prune')}</button>
      </div>
      <MotionGrid className="grid">
        <Card>
          {!data.data ? <RowsSkeleton rows={4} h={44} /> : list.length === 0 ? <p className="muted">{t('docker.empty')}</p> : (
            <div className="svc-table">
              {list.map((c) => {
                const up = c.State === 'running';
                const s = stats[c.Names];
                return (
                  <div className="svc-row" key={c.ID}>
                    <div className="svc-row__name">
                      <span className="mono">{c.Names}</span>
                      <span className="svc-row__desc mono">{c.Image}</span>
                    </div>
                    <div><span className={`pill ${up ? 'pill--success' : 'pill--muted'}`}>{c.State}</span></div>
                    <div className="svc-row__boot mono">{s ? `${s.cpu} · ${s.mem.split('/')[0].trim()}` : c.Status}</div>
                    <div className="svc-row__actions">
                      {up ? (
                        <>
                          <button className="icon-btn" title={t('app.restart')} disabled={busy} onClick={() => run(() => docker.op(c.Names, 'restart'), c.Names)}><RefreshCw size={16} /></button>
                          <button className="icon-btn" title={t('app.stop')} disabled={busy} onClick={() => run(() => docker.op(c.Names, 'stop'), c.Names)}><Square size={15} /></button>
                        </>
                      ) : (
                        <button className="icon-btn" title={t('app.start')} disabled={busy} onClick={() => run(() => docker.op(c.Names, 'start'), c.Names)}><Play size={16} /></button>
                      )}
                      <button className="icon-btn" title={t('app.tab.logs')} onClick={async () => {
                        try { setLogs({ name: c.Names, text: (await docker.logs(c.Names, 300)).text }); } catch (e) { toast({ kind: 'error', title: String(e) }); }
                      }}><FileText size={16} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </MotionGrid>

      <Modal open={!!logs} onClose={() => setLogs(null)} title={logs?.name ?? ''}>
        <pre className="console console--tall">{logs?.text || '…'}</pre>
      </Modal>
      <ConfirmDialog open={prune} title={t('docker.prune')} body={t('docker.prune.body')} confirmLabel={t('docker.prune')} tone="warning"
        onClose={() => setPrune(false)} onConfirm={() => { setPrune(false); void run(() => docker.prune(), t('docker.prune')); }} />
    </>
  );
}

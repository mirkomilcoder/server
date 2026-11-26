import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useT } from '@/i18n';
import { useMetrics } from '@/state/metrics';
import { useSettings } from '@/state/settings';
import { GB, keyUnitStates, type UnitState } from '@/api/metrics';
import { followJournal, type LogEntry } from '@/api/journal';
import { Card } from './Card';
import { KpiCard, Progress } from './KpiCard';
import { Sparkline } from './Sparkline';
import { ScoreRing } from './ScoreRing';
import { RowsSkeleton, Skel } from './Skeletons';
import type { PageId } from '@/pages/registry';

/* Dashboard widgets. Modes compose these; they never fetch on their own twice. */

const fmtGB = (b: number) => (b / GB >= 100 ? (b / GB).toFixed(0) : (b / GB).toFixed(1));

export function KpiRow() {
  const { t } = useT();
  const { latest, disk, history } = useMetrics();
  const cpuSeries = history.slice(-40).map((p) => p.cpu);
  const netSeries = history.slice(-40).map((p) => p.net);
  const memPct = latest && latest.memTotal ? (latest.memUsed / latest.memTotal) * 100 : 0;
  const diskPct = disk ? (disk.used / disk.size) * 100 : 0;
  const mbit = (b: number | null) => ((b ?? 0) / 1e6).toFixed(1);

  return (
    <>
      <KpiCard
        label={t('kpi.cpu')}
        value={latest?.cpuPct ?? null}
        unit="%"
        viz={<Sparkline data={cpuSeries} color="var(--accent)" max={100} />}
        sub={latest && t('kpi.cores', { n: latest.cores, l: latest.load1.toFixed(2) })}
      />
      <KpiCard
        label={t('kpi.ram')}
        value={latest ? latest.memUsed / GB : null}
        decimals={1}
        unit={latest ? `/ ${fmtGB(latest.memTotal)} GB` : undefined}
        viz={<Progress pct={memPct} color="var(--violet)" />}
        sub={latest && `${t('kpi.used', { p: memPct.toFixed(0) })} · swap ${fmtGB(latest.swapUsed)} GB`}
      />
      <KpiCard
        label={t('kpi.disk')}
        value={disk ? disk.used / GB : null}
        decimals={disk && disk.used / GB >= 100 ? 0 : 1}
        unit={disk ? `/ ${fmtGB(disk.size)} GB` : undefined}
        viz={<Progress pct={diskPct} color={diskPct > 85 ? 'var(--danger)' : diskPct > 70 ? 'var(--warning)' : 'var(--success)'} />}
        sub={disk && `${t('kpi.used', { p: diskPct.toFixed(0) })} · ${t('kpi.free', { n: fmtGB(disk.avail) })}`}
      />
      <KpiCard
        label={t('kpi.net')}
        value={latest && latest.rxBps !== null ? ((latest.rxBps ?? 0) + (latest.txBps ?? 0)) / 1e6 : null}
        decimals={1}
        unit="Mbit/s"
        viz={<Sparkline data={netSeries} color="var(--warning)" />}
        sub={latest && `↓ ${mbit(latest.rxBps)} · ↑ ${mbit(latest.txBps)} Mbit/s`}
      />
    </>
  );
}

export const KEY_UNITS = ['ssh.service', 'cockpit.socket', 'tailscaled.service', 'docker.service', 'fail2ban.service', 'ufw.service'];

export function useKeyServices() {
  const { settings } = useSettings();
  const [units, setUnits] = useState<UnitState[] | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => keyUnitStates(KEY_UNITS).then((u) => alive && setUnits(u)).catch(() => alive && setUnits([]));
    tick();
    const id = window.setInterval(tick, Math.max(settings.refreshMs, 10_000));
    return () => { alive = false; window.clearInterval(id); };
  }, [settings.refreshMs]);
  return units;
}

function unitPill(u: UnitState, t: ReturnType<typeof useT>['t']) {
  if (u.load === 'not-found') return <span className="pill pill--muted">{t('svc.missing')}</span>;
  if (u.active === 'active') return <span className="pill pill--success">{t('svc.active')}</span>;
  if (u.active === 'failed') return <span className="pill pill--danger">{t('svc.failed')}</span>;
  return <span className="pill pill--muted">{u.active}</span>;
}

export function ServicesCard() {
  const { t } = useT();
  const units = useKeyServices();
  return (
    <Card title={t('card.services')}>
      {!units ? (
        <RowsSkeleton rows={6} h={28} />
      ) : (
        units.map((u) => (
          <div className="list-line" key={u.id}>
            <span className="list-line__name">{u.id.replace(/\.(service|socket)$/, '')}</span>
            {unitPill(u, t)}
          </div>
        ))
      )}
    </Card>
  );
}

export function LiveLogsCard({ lines = 12 }: { lines?: number }) {
  const { t, locale } = useT();
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const merge = (old: LogEntry[] | null, add: LogEntry[]) => {
      const seen = new Set((old ?? []).map((x) => x.id));
      return [...(old ?? []), ...add.filter((x) => !seen.has(x.id))].slice(-200);
    };
    const stop = followJournal(lines, (e) => setEntries((old) => merge(old, e)), () => setFailed(true));
    // show the empty console (not a skeleton forever) if the journal is quiet
    const t0 = window.setTimeout(() => setEntries((old) => old ?? []), 2500);
    return () => { stop(); window.clearTimeout(t0); };
  }, [lines]);

  // keep scrolled to the bottom while following
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const fmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const tools = !failed && (
    <span className="legend" style={{ color: 'var(--success-text)' }}>
      <span className="dot dot--success dot--live" style={{ marginRight: 8 }} />
      {t('logs.following')}
    </span>
  );

  return (
    <Card title={t('card.logs')} tools={tools}>
      <div className="console" ref={box} role="log" aria-live="off">
        {entries === null && !failed && <Skel h={16} w="70%" />}
        {entries?.map((e) => (
          <div className="console__line" key={e.id}>
            <span className="console__time">{fmt.format(e.time)}</span>
            <span className={`lvl lvl--${e.level}`}>{e.level.toUpperCase().padEnd(4)}</span>
            <span className="console__src">{e.source}</span>
            {e.message}
          </div>
        ))}
        {failed && <div className="console__line lvl--warn">{t('logs.readFailed')}</div>}
        <div className="console__line console__prompt">
          $ <span className="cursor" />
        </div>
      </div>
    </Card>
  );
}

/* Bots and security get their data sources in M3 / M4; until then they say so. */

export function BotsCard({ go }: { go: (id: PageId) => void }) {
  const { t } = useT();
  return (
    <Card
      title={t('card.bots')}
      tools={
        <button className="btn btn--accent btn--sm" onClick={() => go('bots')}>
          <Plus size={16} /> {t('bots.new')}
        </button>
      }
    >
      <p className="muted" style={{ padding: '8px 0' }}>{t('page.soon.body', { m: 'M3' })}</p>
    </Card>
  );
}

export function SecurityCard() {
  const { t } = useT();
  return (
    <Card title={t('card.security')}>
      <div className="score">
        <ScoreRing score={null} />
        <div>
          <div className="score__title" style={{ color: 'var(--text-muted)' }}>{t('common.soon')}</div>
          <div className="card__meta">{t('page.soon.body', { m: 'M4' })}</div>
        </div>
      </div>
    </Card>
  );
}

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle, ArrowRight, ArrowUpRight, CheckCircle2, Clock, Container, Cpu, DatabaseBackup, HardDrive,
  Info, MapPin, MemoryStick, Network, Rocket, ShieldCheck, SquareTerminal, Wifi, Wrench, XCircle, Zap,
} from 'lucide-react';
import { formatDuration, useT, type TranslationKey } from '@/i18n';
import { useMetrics } from '@/state/metrics';
import { useGuardian } from '@/state/guardian';
import { useSystem } from '@/state/system';
import { useMotion } from '@/theme/motion';
import { GB } from '@/api/metrics';
import type { GuardianEvent } from '@/api/guardian';
import type { PageId } from '@/pages/registry';
import { Card } from './Card';
import { CountUp } from './CountUp';
import { Sparkline } from './Sparkline';
import { ServerArt } from './ServerArt';
import { Skel } from './Skeletons';

/* Home dashboard widgets (Advanced mode). Data: /proc via MetricsProvider + Guardian. */

export function timeAgo(t: (k: TranslationKey, v?: Record<string, string | number>) => string, ts: number): string {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return t('time.now');
  if (s < 3600) return t('time.ago.m', { n: Math.floor(s / 60) });
  if (s < 86400) return t('time.ago.h', { n: Math.floor(s / 3600) });
  return t('time.ago.d', { n: Math.floor(s / 86400) });
}

// ---------------------------------------------------------------- hero

export function HeroCard() {
  const { t } = useT();
  const sys = useSystem();
  const { status, available } = useGuardian();
  const m = useMotion();
  const health = status?.status === 'crit' ? 'problem' : status?.status === 'warn' ? 'attention' : 'allGood';
  const tone = health === 'problem' ? 'danger' : health === 'attention' ? 'warning' : 'success';
  const uptime = status?.uptime ?? sys.uptimeSec;

  const facts: { icon: typeof Clock; label: TranslationKey; value: ReactNode; mono?: boolean }[] = [
    { icon: Clock, label: 'hero.uptime', value: uptime == null ? '…' : formatDuration(t, uptime) },
    { icon: MapPin, label: 'hero.ip', value: status?.ip ?? '—', mono: true },
    status?.tailscale_ip
      ? { icon: Wifi, label: 'banner.tailscale', value: status.tailscale_ip, mono: true }
      : { icon: Network, label: 'hero.host', value: sys.hostname, mono: true },
  ];

  return (
    <motion.section className="hero-card" variants={m.item} initial="hidden" animate="show" aria-label={t('hero.status')}>
      <div className="hero-card__status">
        <div className={`status-orb status-orb--${tone}`} aria-hidden>
          <ShieldCheck size={34} strokeWidth={1.8} />
        </div>
        <div>
          <div className="hero-card__eyebrow">
            <span className={`dot dot--${tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : 'success'} dot--live`} />
            {t('hero.status')}
          </div>
          <div className="hero-card__title">
            {t('hero.online')}
            <CheckCircle2 size={26} className="hero-card__check" aria-hidden />
          </div>
          <div className="hero-card__os">{status?.os ?? sys.os}</div>
        </div>
      </div>

      <div className="hero-card__facts">
        {facts.map((f) => (
          <div className="fact" key={f.label}>
            <f.icon size={20} strokeWidth={1.8} className="fact__icon" aria-hidden />
            <div className="fact__label">{t(f.label)}</div>
            <div className={`fact__value${f.mono ? ' mono' : ''}`}>{f.value}</div>
          </div>
        ))}
      </div>

      <div className="hero-card__art">
        <ServerArt />
        {available && (
          <span className={`health-pill health-pill--${tone}`}>
            {tone === 'success' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            {t(`hero.${health}` as TranslationKey)}
          </span>
        )}
      </div>
    </motion.section>
  );
}

// ---------------------------------------------------------------- KPI tiles

interface KpiProps {
  icon: typeof Cpu;
  color: string; // CSS var of the metric color
  label: string;
  value: number | null;
  decimals?: number;
  unit: string;
  delta: number | null;
  deltaUnit: string;
  series: number[];
  sub?: string;
  max?: number;
}

function KpiTile({ icon: Icon, color, label, value, decimals = 1, unit, delta, deltaUnit, series, sub, max }: KpiProps) {
  const m = useMotion();
  return (
    <motion.section className="kpi-tile" variants={m.item} whileHover={m.cardHover} style={{ ['--kpi' as string]: color }} aria-label={label}>
      <div className="kpi-tile__icon"><Icon size={26} strokeWidth={1.8} aria-hidden /></div>
      <div className="kpi-tile__body">
        <div className="kpi-tile__label">{label}</div>
        {value === null ? (
          <Skel w={90} h={30} r={8} />
        ) : (
          <div className="kpi-tile__value">
            <CountUp value={value} decimals={decimals} />
            <span className="kpi-tile__unit">{unit}</span>
          </div>
        )}
        <div className="kpi-tile__meta">
          {delta !== null && Math.abs(delta) >= 0.05 && (
            <span className="kpi-tile__delta">
              {delta > 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}{deltaUnit}
            </span>
          )}
          {sub && <span className="kpi-tile__sub">{sub}</span>}
        </div>
      </div>
      <div className="kpi-tile__spark">
        <Sparkline data={series} color={color} max={max} height={52} area />
      </div>
    </motion.section>
  );
}

export function KpiTiles() {
  const { t } = useT();
  const { latest, disk, history } = useMetrics();
  const recent = history.slice(-40);
  // change vs ~5 minutes ago (or the oldest sample we have)
  const ref = history.length > 1 ? history.find((p) => p.t >= Date.now() - 5 * 60e3) ?? history[0] : null;
  const now = history[history.length - 1];
  const d = (k: 'cpu' | 'ram' | 'disk' | 'net') => (ref && now && ref !== now ? now[k] - ref[k] : null);
  const memPct = latest && latest.memTotal ? (latest.memUsed / latest.memTotal) * 100 : null;
  const diskPct = disk ? (disk.used / disk.size) * 100 : null;
  const mbit = latest && latest.rxBps !== null ? ((latest.rxBps ?? 0) + (latest.txBps ?? 0)) / 1e6 : null;

  return (
    <>
      <KpiTile icon={Cpu} color="var(--c-cpu)" label="CPU" value={latest?.cpuPct ?? null} unit="%" delta={d('cpu')} deltaUnit="%"
        series={recent.map((p) => p.cpu)} max={100} sub={latest ? t('kpi.cores', { n: latest.cores, l: latest.load1.toFixed(2) }) : undefined} />
      <KpiTile icon={MemoryStick} color="var(--c-ram)" label="RAM" value={memPct} unit="%" delta={d('ram')} deltaUnit="%"
        series={recent.map((p) => p.ram)} max={100} sub={latest ? `${(latest.memUsed / GB).toFixed(1)} / ${(latest.memTotal / GB).toFixed(1)} GB` : undefined} />
      <KpiTile icon={HardDrive} color="var(--c-disk)" label="Disk" value={diskPct} unit="%" delta={d('disk')} deltaUnit="%"
        series={recent.map((p) => p.disk)} max={100} sub={disk ? t('kpi.free', { n: (disk.avail / GB).toFixed(0) }) : undefined} />
      <KpiTile icon={Network} color="var(--c-net)" label={t('kpi.net')} value={mbit} unit="Mbit/s" delta={d('net')} deltaUnit=""
        series={recent.map((p) => p.net)} sub={latest ? `↓ ${((latest.rxBps ?? 0) / 1e6).toFixed(1)} · ↑ ${((latest.txBps ?? 0) / 1e6).toFixed(1)}` : undefined} />
    </>
  );
}

// ---------------------------------------------------------------- quick actions

export function QuickActions({ go }: { go: (id: PageId) => void }) {
  const { t } = useT();
  const m = useMotion();
  const actions: { id: PageId; icon: typeof Rocket; title: TranslationKey; sub: TranslationKey; tone: string }[] = [
    { id: 'deploy', icon: Rocket, title: 'quick.deploy', sub: 'quick.deploy.sub', tone: 'accent' },
    { id: 'terminal', icon: SquareTerminal, title: 'quick.terminal', sub: 'quick.terminal.sub', tone: 'slate' },
    { id: 'backup', icon: DatabaseBackup, title: 'quick.backup', sub: 'quick.backup.sub', tone: 'emerald' },
    { id: 'docker', icon: Container, title: 'quick.docker', sub: 'quick.docker.sub', tone: 'violet' },
  ];
  return (
    <Card className="quick-card" title={<><span className="title-icon tint--warning"><Zap size={17} /></span>{t('quick.title')}</>}>
      <div className="quick-grid">
        {actions.map((a) => (
          <motion.button key={a.id} className={`quick quick--${a.tone}`} onClick={() => go(a.id)} whileHover={m.tileHover} whileTap={m.tileTap}>
            <a.icon size={28} strokeWidth={1.8} className="quick__icon" aria-hidden />
            <span className="quick__title">{t(a.title)}</span>
            <span className="quick__sub">{t(a.sub)}</span>
            <ArrowRight size={16} className="quick__arrow" aria-hidden />
          </motion.button>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- projects

export function ProjectsCard({ go }: { go: (id: PageId) => void }) {
  const { t } = useT();
  return (
    <Card
      title={t('projects.title')}
      tools={<button className="link-btn" onClick={() => go('deploy')}>{t('projects.all')} <ArrowRight size={15} /></button>}
    >
      <div className="table-head" aria-hidden>
        <span>{t('projects.col.name')}</span>
        <span>{t('projects.col.status')}</span>
        <span>{t('projects.col.domain')}</span>
        <span>{t('projects.col.resources')}</span>
        <span>{t('projects.col.deployed')}</span>
      </div>
      <div className="empty empty--compact">
        <div className="empty__icon"><Rocket size={24} /></div>
        <h2>{t('projects.empty.title')}</h2>
        <p>{t('projects.empty.body')}</p>
        <button className="btn btn--accent btn--sm" onClick={() => go('deploy')}>
          <ArrowUpRight size={15} /> {t('quick.deploy')}
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- activity

const EVENT_LOOK: Record<GuardianEvent['kind'], { icon: typeof Info; tone: string }> = {
  problem: { icon: AlertTriangle, tone: 'warning' },
  recovered: { icon: CheckCircle2, tone: 'success' },
  action: { icon: Wrench, tone: 'accent' },
  info: { icon: Info, tone: 'violet' },
};

export function ActivityCard({ go }: { go: (id: PageId) => void }) {
  const { t } = useT();
  const { events, available } = useGuardian();
  const list = (events ?? []).slice(0, 5);
  return (
    <Card title={t('activity.title')} tools={<button className="link-btn" onClick={() => go('monitoring')}>{t('projects.all')} <ArrowRight size={15} /></button>}>
      {available === false ? (
        <p className="muted">{t('alerts.noAgent')}</p>
      ) : events === null ? (
        <Skel h={180} r={12} />
      ) : list.length === 0 ? (
        <p className="muted">{t('activity.empty')}</p>
      ) : (
        <ol className="timeline">
          {list.map((e) => {
            const look = e.kind === 'problem' && e.severity === 'crit' ? { icon: XCircle, tone: 'danger' } : EVENT_LOOK[e.kind];
            return (
              <li key={e.id} className="timeline__item">
                <span className={`timeline__dot tint--${look.tone}`}><look.icon size={15} aria-hidden /></span>
                <div className="timeline__body">
                  <div className="timeline__title">{e.title}</div>
                  <div className="timeline__meta">
                    {e.actor !== 'guardian' && <span className="mono">{e.actor} · </span>}
                    {timeAgo(t, e.ts)}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- alerts

export function AlertsCard({ go }: { go: (id: PageId) => void }) {
  const { t } = useT();
  const { status, available } = useGuardian();
  const problems = (status?.checks ?? []).filter((c) => c.severity === 'warn' || c.severity === 'crit');
  return (
    <Card title={t('alerts.title')} tools={<button className="link-btn" onClick={() => go('monitoring')}>{t('projects.all')} <ArrowRight size={15} /></button>}>
      {available === false ? (
        <p className="muted">{t('alerts.noAgent')}</p>
      ) : !status ? (
        <Skel h={160} r={12} />
      ) : problems.length === 0 ? (
        <div className="alert-row">
          <span className="alert-row__icon tint--success"><CheckCircle2 size={18} /></span>
          <div><div className="alert-row__title">{t('alerts.empty')}</div></div>
        </div>
      ) : (
        problems.map((c) => (
          <div className="alert-row" key={c.id}>
            <span className={`alert-row__icon tint--${c.severity === 'crit' ? 'danger' : 'warning'}`}>
              {c.severity === 'crit' ? <XCircle size={18} /> : <AlertTriangle size={18} />}
            </span>
            <div>
              <div className={`alert-row__title c-${c.severity === 'crit' ? 'danger' : 'warning'}`}>{c.title}</div>
              {c.detail && <div className="alert-row__meta">{c.detail}</div>}
            </div>
          </div>
        ))
      )}
    </Card>
  );
}

import { motion } from 'framer-motion';
import { ArrowLeft, Bot, Box, Download, FileText, Globe, Power, Server, ShieldCheck, Terminal, type LucideIcon } from 'lucide-react';
import { formatDuration, useT, type TranslationKey } from '@/i18n';
import { useSystem } from '@/state/system';
import { useSettings } from '@/state/settings';
import { useMetrics } from '@/state/metrics';
import { useMotion } from '@/theme/motion';
import { ModeSwitch } from '@/components/ModeSwitch';
import { PageView } from '@/components/PageView';
import { CountUp } from '@/widgets/CountUp';
import type { PageId } from '@/pages/registry';
import type { ModeProps } from './index';

/* Oddiy: big greeting, one status card, large tiles. No sidebar. */

interface TileDef {
  page: PageId;
  icon: LucideIcon;
  title: TranslationKey;
  sub: TranslationKey;
  tint: string;
  danger?: boolean;
}

const TILES: TileDef[] = [
  { page: 'dashboard', icon: Server, title: 'tile.status', sub: 'tile.status.sub', tint: 'accent' },
  { page: 'bots', icon: Bot, title: 'tile.bots', sub: 'common.soon', tint: 'success' },
  { page: 'updates', icon: Download, title: 'tile.updates', sub: 'common.soon', tint: 'warning' },
  { page: 'logs', icon: FileText, title: 'tile.logs', sub: 'tile.logs.sub', tint: 'info' },
  { page: 'docker', icon: Box, title: 'tile.docker', sub: 'common.soon', tint: 'violet' },
  { page: 'network', icon: Globe, title: 'tile.network', sub: 'common.soon', tint: 'teal' },
  { page: 'security', icon: ShieldCheck, title: 'tile.security', sub: 'common.soon', tint: 'success' },
  { page: 'terminal', icon: Terminal, title: 'tile.terminal', sub: 'tile.terminal.sub', tint: 'muted' },
  { page: 'power', icon: Power, title: 'tile.power', sub: 'tile.power.sub', tint: 'danger', danger: true },
];

function Hero() {
  const { t } = useT();
  const sys = useSystem();
  const { latest, disk } = useMetrics();
  const stats = [
    { label: 'CPU', value: latest?.cpuPct ?? null, color: 'var(--accent)' },
    { label: 'RAM', value: latest && latest.memTotal ? (latest.memUsed / latest.memTotal) * 100 : null, color: 'var(--violet)' },
    { label: 'Disk', value: disk ? (disk.used / disk.size) * 100 : null, color: 'var(--success)' },
  ];
  return (
    <section className="hero">
      <span className="dot dot--success dot--live hero__dot" aria-hidden />
      <div className="hero__text">
        <div className="hero__title">{t('simple.ok.title')}</div>
        <div className="hero__sub">
          {t('banner.uptime')}: {sys.uptimeSec === null ? '…' : formatDuration(t, sys.uptimeSec)}
        </div>
      </div>
      <div className="hero__stats">
        {stats.map((s) => (
          <div className="hero__stat" key={s.label}>
            <div className="hero__num" style={{ color: s.color }}>
              {s.value === null ? '…' : <><CountUp value={s.value} />%</>}
            </div>
            <div className="hero__lbl">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function SimpleMode({ page, go }: ModeProps) {
  const { t } = useT();
  const sys = useSystem();
  const m = useMotion();
  const { update } = useSettings();
  const home = page === 'dashboard';

  return (
    <div className="simple">
      <header className="simple__head">
        <div>
          <div className="simple__eyebrow">
            {t('app.name')} · {sys.hostname}
          </div>
          <h1 className="simple__title">{t('top.greeting', { name: sys.displayName })}</h1>
        </div>
        <ModeSwitch large />
      </header>

      {home ? (
        <>
          <Hero />
          <motion.div className="tiles" variants={m.stagger} initial="hidden" animate="show">
            {TILES.map((tile) => (
              <motion.button
                key={tile.title}
                className={`tile${tile.danger ? ' tile--danger' : ''}`}
                variants={m.item}
                whileHover={m.tileHover}
                whileTap={m.tileTap}
                // "Server holati" opens the detailed (Advanced) dashboard
                onClick={() => (tile.page === 'dashboard' ? update({ mode: 'advanced' }) : go(tile.page))}
              >
                <span className={`tile__icon tint--${tile.tint}`}>
                  <tile.icon size={26} strokeWidth={1.9} aria-hidden />
                </span>
                <span className="tile__title">{t(tile.title)}</span>
                <span className="tile__sub">{t(tile.sub)}</span>
              </motion.button>
            ))}
          </motion.div>
          <footer className="simple__footer">
            <ShieldCheck size={20} aria-hidden />
            <span>{t('simple.footer')}</span>
            <button className="link" onClick={() => go('settings')}>
              {t('simple.footer.link')}
            </button>
          </footer>
        </>
      ) : (
        <>
          <button className="btn btn--ghost" style={{ marginBottom: 16 }} onClick={() => go('dashboard')}>
            <ArrowLeft size={18} /> {t('common.back')}
          </button>
          <PageView page={page} go={go} />
        </>
      )}
    </div>
  );
}

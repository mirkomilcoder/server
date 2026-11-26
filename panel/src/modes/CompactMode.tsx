import { Sidebar } from '@/components/Sidebar';
import { TabBar } from '@/components/TabBar';
import { TopBar } from '@/components/TopBar';
import { PageView } from '@/components/PageView';
import { useT } from '@/i18n';
import { useMetrics } from '@/state/metrics';
import { GB } from '@/api/metrics';
import { MotionGrid } from '@/widgets/Card';
import { LiveLogsCard, ServicesCard } from '@/widgets/dashboard';
import { ResourceChart } from '@/widgets/ResourceChart';
import type { ModeProps } from './index';

/* Ixcham: dense one-screen monitor (second monitor / phone landscape). */

function Strip() {
  const { t } = useT();
  const { latest, disk } = useMetrics();
  const items = [
    { k: t('kpi.cpu'), v: latest?.cpuPct != null ? `${latest.cpuPct.toFixed(0)}%` : '…', c: 'var(--accent)' },
    { k: t('kpi.ram'), v: latest ? `${(latest.memUsed / GB).toFixed(1)} / ${(latest.memTotal / GB).toFixed(0)} GB` : '…', c: 'var(--violet)' },
    { k: t('kpi.disk'), v: disk ? `${((disk.used / disk.size) * 100).toFixed(0)}%` : '…', c: 'var(--success)' },
    { k: t('kpi.net'), v: latest?.rxBps != null ? `${(((latest.rxBps ?? 0) + (latest.txBps ?? 0)) / 1e6).toFixed(1)} Mbit/s` : '…', c: 'var(--warning)' },
    { k: 'Load', v: latest ? latest.load1.toFixed(2) : '…', c: 'var(--text)' },
  ];
  return (
    <div className="compact-strip">
      {items.map((i) => (
        <div className="compact-kpi" key={i.k}>
          <div className="compact-kpi__lbl">{i.k}</div>
          <div className="compact-kpi__num" style={{ color: i.c }}>{i.v}</div>
        </div>
      ))}
    </div>
  );
}

export default function CompactMode({ page, go, openPalette }: ModeProps) {
  return (
    <div className="shell shell--collapsed">
      <Sidebar page={page} go={go} />
      <main className="main">
        <div className="main__inner">
          {page === 'dashboard' ? (
            <>
              <Strip />
              <MotionGrid className="compact-grid">
                <ResourceChart compact />
                <ServicesCard />
                <LiveLogsCard lines={10} />
              </MotionGrid>
            </>
          ) : (
            <>
              <TopBar onSearch={openPalette} />
              <PageView page={page} go={go} />
            </>
          )}
        </div>
      </main>
      <TabBar page={page} go={go} />
    </div>
  );
}

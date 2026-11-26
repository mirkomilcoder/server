import { MotionGrid } from '@/widgets/Card';
import { BotsCard, KpiRow, LiveLogsCard, SecurityCard, ServicesCard } from '@/widgets/dashboard';
import { ResourceChart } from '@/widgets/ResourceChart';
import { useSettings } from '@/state/settings';
import type { PageProps } from './registry';

/* Advanced-mode dashboard. Widget visibility comes from settings.widgets. */
export default function Dashboard({ go }: PageProps) {
  const { settings } = useSettings();
  const on = (id: string) => settings.widgets.find((w) => w.id === id)?.visible !== false;

  return (
    <>
      {on('kpis') && (
        <MotionGrid className="grid grid--kpi">
          <KpiRow />
        </MotionGrid>
      )}
      <MotionGrid className="grid grid--main">
        {on('chart') && <ResourceChart />}
        {on('bots') && <BotsCard go={go} />}
      </MotionGrid>
      <MotionGrid className="grid grid--bottom">
        {on('services') && <ServicesCard />}
        {on('logs') && <LiveLogsCard />}
      </MotionGrid>
      {on('security') && (
        <MotionGrid className="grid">
          <SecurityCard />
        </MotionGrid>
      )}
    </>
  );
}

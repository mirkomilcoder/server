import { MotionGrid } from '@/widgets/Card';
import { ResourceChart } from '@/widgets/ResourceChart';
import { ActivityCard, AlertsCard, HeroCard, KpiTiles, ProjectsCard, QuickActions } from '@/widgets/home';
import { useSettings } from '@/state/settings';
import type { PageProps } from './registry';

/*
 * Advanced-mode home: status hero → 4 KPI tiles → chart + quick actions →
 * projects / recent activity / alerts. Widget visibility comes from settings.
 */
export default function Dashboard({ go }: PageProps) {
  const { settings } = useSettings();
  const on = (id: string) => settings.widgets.find((w) => w.id === id)?.visible !== false;

  return (
    <>
      {on('hero') && <HeroCard />}
      {on('kpis') && (
        <MotionGrid className="grid grid--kpi">
          <KpiTiles />
        </MotionGrid>
      )}
      <MotionGrid className="grid grid--chart">
        {on('chart') && <ResourceChart />}
        {on('quick') && <QuickActions go={go} />}
      </MotionGrid>
      <MotionGrid className="grid grid--triple">
        {on('projects') && <ProjectsCard go={go} />}
        {on('activity') && <ActivityCard go={go} />}
        {on('alerts') && <AlertsCard go={go} />}
      </MotionGrid>
    </>
  );
}

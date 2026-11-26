import { Sidebar } from '@/components/Sidebar';
import { TabBar } from '@/components/TabBar';
import { TopBar } from '@/components/TopBar';
import { PageView } from '@/components/PageView';
import { useSettings } from '@/state/settings';
import type { ModeProps } from './index';

/* Kengaytirilgan: sidebar + top bar + banner + page. */
export default function AdvancedMode({ page, go, openPalette }: ModeProps) {
  const { settings } = useSettings();
  return (
    <div className={`shell${settings.sidebarCollapsed ? ' shell--collapsed' : ''}`}>
      <Sidebar page={page} go={go} />
      <main className="main">
        <div className="main__inner">
          <TopBar onSearch={openPalette} go={go} />
          <PageView page={page} go={go} />
        </div>
      </main>
      <TabBar page={page} go={go} />
    </div>
  );
}

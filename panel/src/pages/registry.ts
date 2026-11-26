import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import {
  Activity,
  Bot,
  Container,
  Database,
  DatabaseBackup,
  Download,
  FileText,
  Folder,
  Globe,
  House,
  LayoutGrid,
  LineChart,
  Network,
  Power,
  Rocket,
  Server,
  Settings,
  Shield,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';
import type { TranslationKey } from '@/i18n';

/*
 * Every page in one place: sidebar, phone tab bar, command palette, Simple-mode
 * tiles and the router all read this list. Pages are lazy-loaded (one chunk each).
 *
 * To add a page: create src/pages/MyPage.tsx (default export), add an entry
 * here and a "nav.<id>" key in src/i18n/*.json.
 */

export const PAGE_IDS = [
  'dashboard', 'services', 'bots', 'updates', 'activity', 'power',
  'deploy', 'apps', 'files',
  'monitoring', 'docker', 'domains', 'backup', 'databases', 'security', 'network',
  'terminal', 'logs', 'settings',
] as const;
export type PageId = (typeof PAGE_IDS)[number];

export interface PageProps {
  go: (id: PageId, options?: Record<string, string>) => void;
}

/** Sidebar placement: top group, "Server" submenu, management, developer, bottom. */
export type NavGroup = 'main' | 'server' | 'manage' | 'dev' | 'bottom';

export interface PageDef {
  id: PageId;
  icon: LucideIcon;
  label: TranslationKey;
  group: NavGroup;
  component: LazyExoticComponent<ComponentType<PageProps>>;
  danger?: boolean;
  /** Shows the pulsing "Live" pill in the sidebar. */
  live?: boolean;
  /** Milestone that delivers the page (placeholder until then). */
  milestone?: string;
}

// Pages not built yet render a placeholder naming the milestone that delivers them.
const soon = (milestone: string) =>
  lazy(() => import('./Placeholder').then((m) => ({ default: m.placeholderFor(milestone) })));

export const PAGES: PageDef[] = [
  { id: 'dashboard', icon: House, label: 'nav.home', group: 'main', component: lazy(() => import('./Dashboard')) },
  { id: 'deploy', icon: Rocket, label: 'nav.deploy', group: 'main', component: lazy(() => import('./DeployPage')) },
  { id: 'apps', icon: LayoutGrid, label: 'nav.apps', group: 'main', component: soon('M5b'), milestone: 'M5b' },
  { id: 'files', icon: Folder, label: 'nav.files', group: 'main', component: lazy(() => import('./FilesPage')) },

  { id: 'services', icon: Server, label: 'nav.services', group: 'server', component: lazy(() => import('./ServicesPage')) },
  { id: 'bots', icon: Bot, label: 'nav.bots', group: 'server', component: lazy(() => import('./BotsPage')) },
  { id: 'updates', icon: Download, label: 'nav.updates', group: 'server', component: lazy(() => import('./UpdatesPage')) },
  { id: 'activity', icon: Activity, label: 'nav.activity', group: 'server', component: lazy(() => import('./ActivityPage')) },
  { id: 'power', icon: Power, label: 'nav.power', group: 'server', danger: true, component: lazy(() => import('./PowerPage')) },

  { id: 'monitoring', icon: LineChart, label: 'nav.monitoring', group: 'manage', live: true, component: lazy(() => import('./GuardianPage')) },
  { id: 'docker', icon: Container, label: 'nav.docker', group: 'manage', component: lazy(() => import('./DockerPage')) },
  { id: 'domains', icon: Globe, label: 'nav.domains', group: 'manage', component: lazy(() => import('./DomainsPage')) },
  { id: 'backup', icon: DatabaseBackup, label: 'nav.backup', group: 'manage', component: soon('M8'), milestone: 'M8' },
  { id: 'databases', icon: Database, label: 'nav.databases', group: 'manage', component: lazy(() => import('./DatabasesPage')) },
  { id: 'security', icon: Shield, label: 'nav.security', group: 'manage', component: lazy(() => import('./SecurityPage')) },
  { id: 'network', icon: Network, label: 'nav.network', group: 'manage', component: lazy(() => import('./NetworkPage')) },

  { id: 'terminal', icon: SquareTerminal, label: 'nav.terminal', group: 'dev', component: lazy(() => import('./TerminalPage')) },
  { id: 'logs', icon: FileText, label: 'nav.logs', group: 'dev', component: lazy(() => import('./LogsPage')) },

  { id: 'settings', icon: Settings, label: 'nav.settings', group: 'bottom', component: lazy(() => import('./SettingsPage')) },
];

export const pageById = (id: PageId): PageDef => PAGES.find((p) => p.id === id) ?? PAGES[0];

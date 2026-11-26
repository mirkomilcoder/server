import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import {
  Activity,
  Bot,
  Box,
  Download,
  FileText,
  Globe,
  LayoutGrid,
  Power,
  Server,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import type { TranslationKey } from '@/i18n';

/*
 * Every page in one place: sidebar, phone tab bar, command palette and the
 * router all read this list. Pages are lazy-loaded (one JS chunk each).
 *
 * To add a page: create src/pages/MyPage.tsx (default export), add an entry
 * here and a "nav.<id>" key in src/i18n/*.json.
 */

export const PAGE_IDS = [
  'dashboard', 'guardian', 'bots', 'services', 'docker', 'logs', 'updates',
  'network', 'security', 'activity', 'terminal', 'settings', 'power',
] as const;
export type PageId = (typeof PAGE_IDS)[number];

export interface PageProps {
  go: (id: PageId) => void;
}

export interface PageDef {
  id: PageId;
  icon: LucideIcon;
  label: TranslationKey;
  component: LazyExoticComponent<ComponentType<PageProps>>;
  /** Where it shows in the sidebar. */
  section: 'main' | 'bottom';
  danger?: boolean;
  /** Milestone that delivers the page (shown on the placeholder until then). */
  milestone?: string;
}

// Pages not built yet render a placeholder with the milestone that delivers them.
const soon = (milestone: string) =>
  lazy(() => import('./Placeholder').then((m) => ({ default: m.placeholderFor(milestone) })));

export const PAGES: PageDef[] = [
  { id: 'dashboard', icon: LayoutGrid, label: 'nav.dashboard', section: 'main', component: lazy(() => import('./Dashboard')) },
  { id: 'guardian', icon: ShieldCheck, label: 'nav.guardian', section: 'main', component: lazy(() => import('./GuardianPage')) },
  { id: 'bots', icon: Bot, label: 'nav.bots', section: 'main', component: soon('M3'), milestone: 'M3' },
  { id: 'services', icon: Server, label: 'nav.services', section: 'main', component: soon('M3'), milestone: 'M3' },
  { id: 'docker', icon: Box, label: 'nav.docker', section: 'main', component: soon('M5'), milestone: 'M5' },
  { id: 'logs', icon: FileText, label: 'nav.logs', section: 'main', component: soon('M3'), milestone: 'M3' },
  { id: 'updates', icon: Download, label: 'nav.updates', section: 'main', component: soon('M3'), milestone: 'M3' },
  { id: 'network', icon: Globe, label: 'nav.network', section: 'main', component: soon('M6'), milestone: 'M6' },
  { id: 'security', icon: Shield, label: 'nav.security', section: 'main', component: soon('M4'), milestone: 'M4' },
  { id: 'activity', icon: Activity, label: 'nav.activity', section: 'main', component: soon('M3'), milestone: 'M3' },
  { id: 'terminal', icon: Terminal, label: 'nav.terminal', section: 'main', component: lazy(() => import('./TerminalPage')) },
  { id: 'settings', icon: SlidersHorizontal, label: 'nav.settings', section: 'bottom', component: lazy(() => import('./SettingsPage')) },
  { id: 'power', icon: Power, label: 'nav.power', section: 'bottom', danger: true, component: soon('M3'), milestone: 'M3' },
];

export const pageById = (id: PageId): PageDef => PAGES.find((p) => p.id === id) ?? PAGES[0];

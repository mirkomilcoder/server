import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { TranslationKey } from '@/i18n';
import type { PageId } from '@/pages/registry';

/*
 * Mode registry. A mode is a layout built from the same shared widgets.
 * To add one: create src/modes/MyMode.tsx (default export, ModeProps) and add
 * an entry here + a "mode.<id>" translation; settings.ts lists allowed ids.
 */

export interface ModeProps {
  page: PageId;
  go: (id: PageId) => void;
  openPalette: () => void;
}

export interface ModeDef {
  id: 'simple' | 'advanced' | 'compact';
  label: TranslationKey;
  component: LazyExoticComponent<ComponentType<ModeProps>>;
}

export const MODES: ModeDef[] = [
  { id: 'simple', label: 'mode.simple', component: lazy(() => import('./SimpleMode')) },
  { id: 'advanced', label: 'mode.advanced', component: lazy(() => import('./AdvancedMode')) },
  { id: 'compact', label: 'mode.compact', component: lazy(() => import('./CompactMode')) },
];

export const modeById = (id: string) => MODES.find((m) => m.id === id) ?? MODES[1];

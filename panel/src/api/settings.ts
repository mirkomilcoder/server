import { z } from 'zod';
import { cockpit, sessionUser } from './cockpit';
import type { CockpitFile } from './cockpit-types';
import { runAction } from './run';

/*
 * Settings live in ~/.config/mirkomil-panel/settings.json (per Linux user).
 * Each field has .catch(default): one bad/unknown value falls back to its
 * default instead of throwing away the whole file.
 */

export const WIDGET_IDS = ['hero', 'kpis', 'chart', 'quick', 'projects', 'activity', 'alerts'] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

export const ACCENT_PRESETS = ['#3B82F6', '#22D3EE', '#A78BFA', '#34D399', '#FB923C'] as const;

const widgetList = z
  .array(z.object({ id: z.enum(WIDGET_IDS), visible: z.boolean() }))
  .transform((list) => {
    // Keep user order, drop duplicates, append any widget added in a newer version.
    const seen = new Set<WidgetId>();
    const out = list.filter((w) => !seen.has(w.id) && seen.add(w.id));
    for (const id of WIDGET_IDS) if (!seen.has(id)) out.push({ id, visible: true });
    return out;
  });

export const settingsSchema = z.object({
  mode: z.enum(['simple', 'advanced', 'compact']).catch('advanced'),
  theme: z.enum(['dark', 'light', 'auto']).catch('dark'),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).catch('#3B82F6'),
  animations: z.enum(['on', 'reduced', 'off']).catch('on'),
  animationSpeed: z.number().min(0.5).max(2).catch(1),
  language: z.enum(['uz', 'ru', 'en']).catch('uz'),
  refreshMs: z.union([z.literal(2000), z.literal(5000), z.literal(10000), z.literal(30000)]).catch(5000),
  fontSize: z.enum(['s', 'm', 'l']).catch('m'),
  startPage: z.string().regex(/^[a-z-]{2,20}$/).catch('dashboard'),
  sidebarCollapsed: z.boolean().catch(false),
  /** Turn admin mode back on automatically at the next login (Cockpit reuses the login password). */
  rememberAdmin: z.boolean().catch(false),
  widgets: widgetList.catch(WIDGET_IDS.map((id) => ({ id, visible: true }))),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

/** Unknown / invalid input → defaults (field by field). */
export function parseSettings(raw: unknown): Settings {
  const obj = raw && typeof raw === 'object' ? raw : {};
  return settingsSchema.parse(obj);
}

const LOCAL_KEY = 'mirkomil-panel:ui-cache';

/*
 * localStorage holds only a copy of these UI prefs (no secrets) so the first
 * paint already has the right theme/mode. The file on the server is the source of truth.
 */
export function readLocalCache(): Settings {
  try {
    return parseSettings(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}'));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeLocalCache(s: Settings) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(s));
  } catch {
    /* private mode etc. — not important */
  }
}

let fileHandle: CockpitFile<unknown> | null = null;

export function settingsFile(): CockpitFile<unknown> {
  if (!fileHandle) {
    const path = `${sessionUser().home}/.config/mirkomil-panel/settings.json`;
    fileHandle = cockpit().file<unknown>(path, {
      syntax: { parse: JSON.parse, stringify: (v) => JSON.stringify(v, null, 2) + '\n' },
    });
  }
  return fileHandle;
}

export async function saveSettings(s: Settings): Promise<void> {
  writeLocalCache(s);
  try {
    await settingsFile().replace(s);
  } catch {
    // Most likely the directory doesn't exist yet: create it and retry once.
    await runAction('settings.mkdir', {});
    await settingsFile().replace(s);
  }
}

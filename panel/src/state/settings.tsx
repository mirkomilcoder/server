import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  parseSettings,
  readLocalCache,
  saveSettings,
  settingsFile,
  writeLocalCache,
  type Settings,
} from '@/api/settings';

/*
 * Settings store. First paint uses the localStorage cache (no theme flash);
 * then the file in ~/.config/mirkomil-panel is watched and wins. Saves are
 * debounced so dragging a slider doesn't write the file 60 times a second.
 */

interface SettingsCtx {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  /** Last save error (shown as a toast by the shell). */
  saveError: string | null;
}

const Ctx = createContext<SettingsCtx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(readLocalCache);
  const [saveError, setSaveError] = useState<string | null>(null);
  const timer = useRef<number>();
  const lastWritten = useRef<string>('');

  useEffect(() => {
    const handle = settingsFile().watch((content) => {
      if (content === null) return; // no file yet → keep defaults/cache
      const next = parseSettings(content);
      const json = JSON.stringify(next);
      if (json === lastWritten.current) return; // our own write echoing back
      writeLocalCache(next);
      setSettings(next);
    });
    return () => handle.remove();
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = parseSettings({ ...prev, ...patch });
      writeLocalCache(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        lastWritten.current = JSON.stringify(next);
        saveSettings(next)
          .then(() => setSaveError(null))
          .catch((e: unknown) => setSaveError(e instanceof Error ? e.message : String(e)));
      }, 400);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ settings, update, saveError }), [settings, update, saveError]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSettings outside SettingsProvider');
  return ctx;
}

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { sessionUser } from '@/api/cockpit';
import { osLabel, readUptimeSeconds, watchAdmin, watchHostname } from '@/api/system';
import { useSettings } from './settings';

/* Host facts shared by the shell: hostname, OS, user, uptime, admin access. */

export interface SystemInfo {
  hostname: string;
  os: string;
  userName: string;
  /** First name for the greeting ("Mirkomil"), falls back to the login. */
  displayName: string;
  uptimeSec: number | null;
  /** Cockpit administrative access: null = still unknown. */
  admin: boolean | null;
}

const Ctx = createContext<SystemInfo | null>(null);

export function SystemProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const user = sessionUser();
  const [hostname, setHostname] = useState('…');
  const [uptimeSec, setUptime] = useState<number | null>(null);
  const [admin, setAdmin] = useState<boolean | null>(null);

  useEffect(() => watchHostname(setHostname), []);
  useEffect(() => watchAdmin(setAdmin), []);

  useEffect(() => {
    let alive = true;
    const tick = () => readUptimeSeconds().then((s) => alive && setUptime(s)).catch(() => {});
    tick();
    // Uptime only needs minute precision; poll slowly regardless of the refresh setting.
    const id = window.setInterval(tick, Math.max(settings.refreshMs, 30_000));
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [settings.refreshMs]);

  const value = useMemo<SystemInfo>(() => {
    const full = user.full_name?.split(',')[0].trim();
    return {
      hostname,
      os: osLabel(),
      userName: user.name,
      displayName: full ? full.split(/\s+/)[0] : user.name,
      uptimeSec,
      admin,
    };
  }, [hostname, uptimeSec, admin, user]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSystem() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSystem outside SystemProvider');
  return ctx;
}

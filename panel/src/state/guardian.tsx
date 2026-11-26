import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { guardian, GuardianUnavailable, type GuardianEvent, type GuardianStatus, type Me } from '@/api/guardian';
import { usePoll } from '@/hooks/usePoll';
import { useSettings } from './settings';

/*
 * One shared poller for Guardian data (status, recent events, who am I), so
 * the hero card, alerts, activity feed and the bell don't each hit the socket.
 * `available === false` means the agent isn't installed/running — widgets
 * then show a calm fallback instead of errors.
 */

interface GuardianCtx {
  status: GuardianStatus | null;
  events: GuardianEvent[] | null;
  me: Me | null;
  available: boolean | null;
}

const Ctx = createContext<GuardianCtx | null>(null);

export function GuardianProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const status = usePoll(guardian.status, Math.max(settings.refreshMs, 10_000));
  const events = usePoll(() => guardian.events(30), 20_000);
  const me = usePoll(guardian.me, 60_000);

  const value = useMemo<GuardianCtx>(() => {
    const down = status.error instanceof GuardianUnavailable;
    return {
      status: status.data,
      events: events.data?.events ?? null,
      me: me.data,
      available: status.data ? true : down ? false : null,
    };
  }, [status.data, status.error, events.data, me.data]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGuardian() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useGuardian outside GuardianProvider');
  return ctx;
}

/** Problems worth a badge: current warn/crit checks. */
export function useAlerts() {
  const { status } = useGuardian();
  return (status?.checks ?? []).filter((c) => c.severity === 'warn' || c.severity === 'crit');
}

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cockpit } from '@/api/cockpit';
import { ProcSampler, sampleDisk, type DiskSample, type ProcSample } from '@/api/metrics';
import { useSettings } from './settings';

/*
 * One sampler for the whole app (dashboard, Simple and Compact modes share it).
 * Keeps up to 1 hour of history in memory. Pauses while the page is hidden
 * (cockpit.hidden), so a background tab doesn't keep spawning processes.
 */

export interface Point {
  t: number; // ms epoch
  cpu: number;
  ram: number; // %
  disk: number; // %
  net: number; // Mbit/s (rx + tx)
}

interface MetricsCtx {
  latest: ProcSample | null;
  disk: DiskSample | null;
  history: Point[];
  error: string | null;
}

const Ctx = createContext<MetricsCtx | null>(null);
const HISTORY_MS = 60 * 60 * 1000;

export function MetricsProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const [latest, setLatest] = useState<ProcSample | null>(null);
  const [disk, setDisk] = useState<DiskSample | null>(null);
  const [history, setHistory] = useState<Point[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sampler = useRef(new ProcSampler());
  const diskPct = useRef(0);
  const [hidden, setHidden] = useState(() => cockpit().hidden);

  useEffect(() => {
    const onVis = () => setHidden(cockpit().hidden);
    cockpit().addEventListener('visibilitychange', onVis);
    return () => cockpit().removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    if (hidden) return;
    let alive = true;
    const tick = async () => {
      try {
        const s = await sampler.current.sample();
        if (!alive) return;
        setLatest(s);
        setError(null);
        if (s.cpuPct !== null) {
          const p: Point = {
            t: Date.now(),
            cpu: s.cpuPct,
            ram: s.memTotal ? (s.memUsed / s.memTotal) * 100 : 0,
            disk: diskPct.current,
            net: ((s.rxBps ?? 0) + (s.txBps ?? 0)) / 1e6,
          };
          setHistory((h) => [...h.filter((x) => x.t > p.t - HISTORY_MS), p]);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    const diskTick = () =>
      sampleDisk()
        .then((d) => {
          diskPct.current = (d.used / d.size) * 100;
          if (alive) setDisk(d);
        })
        .catch(() => {});
    tick();
    // second sample quickly so CPU % appears without waiting a full interval
    const first = window.setTimeout(tick, 1000);
    diskTick();
    const id = window.setInterval(tick, settings.refreshMs);
    const diskId = window.setInterval(diskTick, 60_000);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(id);
      window.clearInterval(diskId);
    };
  }, [settings.refreshMs, hidden]);

  const value = useMemo(() => ({ latest, disk, history, error }), [latest, disk, history, error]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMetrics() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useMetrics outside MetricsProvider');
  return ctx;
}

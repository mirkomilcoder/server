import { useEffect, useRef, useState } from 'react';
import { cockpit } from '@/api/cockpit';

/*
 * Poll an async loader every `ms` while the Cockpit page is visible.
 * Returns { data, error, loading }; keeps the last good data on errors.
 */
export function usePoll<T>(load: () => Promise<T>, ms: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const tick = async () => {
      if (!cockpit().hidden) {
        try {
          const d = await loader.current();
          if (alive) { setData(d); setError(null); }
        } catch (e) {
          if (alive) setError(e);
        } finally {
          if (alive) setLoading(false);
        }
      }
      if (alive) timer = window.setTimeout(tick, ms);
    };
    tick();
    return () => { alive = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps]);

  return { data, error, loading };
}

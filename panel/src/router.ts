import { useCallback, useEffect, useState } from 'react';
import { cockpit } from '@/api/cockpit';
import { PAGE_IDS, type PageId } from '@/pages/registry';

/*
 * Routing via cockpit.location (the part after "#" in Cockpit's URL), so
 * Cockpit keeps its own address bar, history and back button in sync.
 * URL shape: /mirkomil#/<page>
 */

function currentPage(fallback: PageId): PageId {
  const first = cockpit().location.path[0];
  return (PAGE_IDS as readonly string[]).includes(first) ? (first as PageId) : fallback;
}

/** Current page's URL options, e.g. { unit: 'ssh.service' } (strings only). */
export function routeOption(name: string): string | undefined {
  const v = cockpit().location.options[name];
  return typeof v === 'string' ? v : undefined;
}

export function useRoute(startPage: string) {
  const fallback: PageId = (PAGE_IDS as readonly string[]).includes(startPage) ? (startPage as PageId) : 'dashboard';
  const [page, setPage] = useState<PageId>(() => currentPage(fallback));

  useEffect(() => {
    const onChange = () => setPage(currentPage(fallback));
    cockpit().addEventListener('locationchanged', onChange);
    return () => cockpit().removeEventListener('locationchanged', onChange);
  }, [fallback]);

  /** Navigate; optional query options end up in the URL (#/logs?unit=ssh.service). */
  const go = useCallback((id: PageId, options?: Record<string, string>) => {
    cockpit().location.go([id], options);
    setPage(id); // locationchanged fires asynchronously; update right away
  }, []);

  return { page, go };
}

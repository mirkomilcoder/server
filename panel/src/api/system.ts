import { cockpit } from './cockpit';
import { runAction } from './run';

/* Basic host facts used by the shell (sidebar, greeting, status banner). */

/** "Ubuntu 26.04.1" from os-release (VERSION carries the point release). */
export function osLabel(): string {
  const os = cockpit().info?.os_release ?? {};
  const version = (os.VERSION ?? os.VERSION_ID ?? '').split(' ')[0];
  return [os.NAME ?? 'Linux', version].filter(Boolean).join(' ');
}

export function watchHostname(cb: (name: string) => void): () => void {
  const f = cockpit().file('/etc/hostname');
  const h = f.watch((content) => cb((content ?? '').trim() || 'localhost'));
  return () => {
    h.remove();
    f.close();
  };
}

export async function readUptimeSeconds(): Promise<number> {
  const out = await runAction('system.uptime', {});
  const secs = parseFloat(out.split(' ')[0]);
  if (!Number.isFinite(secs)) throw new Error('bad /proc/uptime');
  return secs;
}

/** Calls cb with true/false/null whenever Cockpit's administrative access changes. */
export function watchAdmin(cb: (allowed: boolean | null) => void): () => void {
  const perm = cockpit().permission({ admin: true });
  const onChange = () => cb(perm.allowed);
  perm.addEventListener('changed', onChange);
  onChange();
  return () => {
    perm.removeEventListener('changed', onChange);
    perm.close();
  };
}

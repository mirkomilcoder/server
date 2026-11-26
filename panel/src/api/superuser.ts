import { cockpit } from './cockpit';
import type { CockpitDBusProxy } from './cockpit-types';

/*
 * Administrative access ("superuser") without Cockpit's shell.
 *
 * Same mechanism the Cockpit shell uses: the internal D-Bus object
 * /superuser (interface cockpit.Superuser) starts a privileged bridge
 * (normally sudo). sudo's password prompt arrives as a "Prompt" signal and
 * the answer goes back with Answer(). The password is handed straight to
 * Cockpit's bridge — we never store or log it.
 */

let proxy: CockpitDBusProxy | null = null;
function su(): CockpitDBusProxy {
  proxy ??= cockpit().dbus(null, { bus: 'internal' }).proxy('cockpit.Superuser', '/superuser');
  return proxy;
}

export interface Prompt {
  message: string;
  prompt: string;
  echo: boolean;
  error: string;
}

/** Remember the choice for the next login, exactly like the Cockpit shell does. */
function rememberChoice(value: 'any' | 'none') {
  try {
    const key = window.localStorage.getItem('superuser-key');
    if (key) window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked: only the convenience is lost */
  }
}

/**
 * Starts administrative access. `onPrompt` is called for each sudo prompt;
 * reply with answer(). Resolves when access is granted; rejects on failure
 * or with message "cancelled" after cancel().
 */
export async function startAdmin(onPrompt: (p: Prompt) => void): Promise<void> {
  const p = su();
  await p.wait();
  const bridges = (p.Bridges as string[] | undefined) ?? [];
  if (bridges.length === 0) throw new Error('no-bridge');
  const handler = (_ev: never, message: string, prompt: string, _def: string, echo: boolean, error: string) =>
    onPrompt({ message, prompt, echo, error });
  p.addEventListener('Prompt', handler as (...a: never[]) => void);
  try {
    await p.call('Start', [bridges[0]]);
    rememberChoice('any');
  } finally {
    p.removeEventListener('Prompt', handler as (...a: never[]) => void);
  }
}

export function answer(value: string): void {
  void su().call('Answer', [value]);
}

/** Drops administrative access (and remembers "off" for the next login). */
export async function stopAdmin(): Promise<void> {
  await su().call('Stop', []);
  rememberChoice('none');
}

/** Aborts a start that is waiting for the password (preference unchanged). */
export function cancelStart(): void {
  void su().call('Stop', []).catch(() => {});
}

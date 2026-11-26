import type { Cockpit, CockpitUser } from './cockpit-types';

/*
 * Single access point to cockpit.js.
 *
 * In production, Cockpit's own cockpit.js (loaded by index.html) defines
 * window.cockpit. During `npm run dev` there is no Cockpit, so we load a mock
 * — the dynamic import is behind import.meta.env.DEV, so Vite drops the mock
 * from production builds entirely.
 */

let instance: Cockpit | null = null;
let currentUser: CockpitUser | null = null;

export async function loadCockpit(): Promise<Cockpit> {
  if (window.cockpit) {
    instance = window.cockpit;
  } else if (import.meta.env.DEV) {
    const { createMockCockpit } = await import('./dev-mock');
    instance = createMockCockpit();
  } else {
    throw new Error('cockpit.js topilmadi — panelni Cockpit ichida oching (https://<server>:9090).');
  }

  // cockpit.init() (Cockpit ≥ 3xx) fills cockpit.info; older versions only have user().
  if (instance.init) await instance.init();
  currentUser = instance.info?.user ?? (await instance.user());
  return instance;
}

export function cockpit(): Cockpit {
  if (!instance) throw new Error('loadCockpit() has not run yet');
  return instance;
}

export function sessionUser(): CockpitUser {
  if (!currentUser) throw new Error('loadCockpit() has not run yet');
  return currentUser;
}

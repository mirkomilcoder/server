import { z } from 'zod';
import type { CockpitUser } from './cockpit-types';

/*
 * THE WHITELIST. Every process the panel can start on the server is defined
 * here — nowhere else. The UI only calls runAction('<id>', params); it can
 * never pass a command line.
 *
 * Rules for adding an action:
 *  - `argv` returns an array: [executable, ...args]. Never `sh -c`, never a
 *    shell string, never cockpit.script().
 *  - Every user-controlled value is validated by `schema` first (see validate.ts).
 *  - Put "--" before positional user values when the tool supports it, so a
 *    value can never be parsed as an option.
 *  - `privileged: true` → runs with superuser "require" (needs Cockpit admin
 *    access) and is written to the activity log automatically.
 */

export interface ActionContext {
  user: CockpitUser;
}

export type Danger = 'none' | 'confirm' | 'type-name';

export interface ActionDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  schema: S;
  argv: (params: z.output<S>, ctx: ActionContext) => string[];
  /** Run as root via Cockpit's superuser channel. */
  privileged?: boolean;
  /** Write "<user> <action> <target> <result>" to the journal. Default: = privileged. */
  audit?: boolean;
  /** How the UI must confirm before running. */
  danger?: Danger;
  /** Human-readable target for the activity log. */
  target?: (params: z.output<S>) => string;
}

// Helper that keeps each action's param type precise.
const define = <S extends z.ZodTypeAny>(def: ActionDef<S>) => def;
const none = z.object({}).strict();

export const actions = {
  /** Seconds since boot (first field of /proc/uptime). */
  'system.uptime': define({
    schema: none,
    argv: () => ['cat', '/proc/uptime'],
  }),

  /** CPU, memory, load and network counters in one process per tick. */
  'metrics.proc': define({
    schema: none,
    argv: () => ['cat', '/proc/stat', '/proc/meminfo', '/proc/loadavg', '/proc/net/dev'],
  }),

  /** Root filesystem size/used/available in bytes. */
  'metrics.disk': define({
    schema: none,
    argv: () => ['df', '-B1', '--output=size,used,avail', '/'],
  }),

  /** State of a fixed list of key units (missing units report LoadState=not-found). */
  'services.keyStatus': define({
    schema: z.object({ units: z.array(z.string().regex(/^[a-zA-Z0-9@._-]+\.(service|socket)$/)).max(20) }).strict(),
    argv: (p) => ['systemctl', 'show', '--property=Id,LoadState,ActiveState,SubState', '--', ...p.units],
  }),

  /** Live journal: last N entries, then follow (JSON lines). Users in "adm" see the system journal. */
  'journal.follow': define({
    schema: z.object({ lines: z.number().int().min(1).max(200) }).strict(),
    argv: (p) => ['journalctl', '--follow', '--output=json', `--lines=${p.lines}`, '--no-pager'],
  }),

  /** Create ~/.config/mirkomil-panel so settings.json can be saved. */
  'settings.mkdir': define({
    schema: none,
    argv: (_p, ctx) => ['mkdir', '-p', '--', `${ctx.user.home}/.config/mirkomil-panel`],
  }),
} satisfies Record<string, { schema: z.ZodTypeAny }>;

export type ActionId = keyof typeof actions;
export type ActionParams<K extends ActionId> = z.input<(typeof actions)[K]['schema']>;

export function actionMeta(id: ActionId): { privileged: boolean; danger: Danger } {
  const def = actions[id] as unknown as ActionDef;
  return { privileged: !!def.privileged, danger: def.danger ?? 'none' };
}

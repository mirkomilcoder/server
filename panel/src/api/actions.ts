import { z } from 'zod';
import type { CockpitUser } from './cockpit-types';
import { absPath, FILE_NAME_RE, mutablePath, unitName } from './validate';

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
  /** Extra environment ("NAME=value"), fixed per action. */
  environ?: string[];
  /** Run in a pseudo-terminal (interactive prompts, answered through RunOptions.onOutput). */
  pty?: boolean;
  /**
   * Output contains NUL bytes (e.g. `find -printf …\0`): Cockpit's text channels drop such
   * output, so it travels as bytes and is decoded as UTF-8 by runAction.
   */
  binary?: boolean;
  /**
   * May run as root when the caller asks (file manager "admin mode"); needs
   * Cockpit administrative access and is then written to the activity log.
   */
  elevatable?: boolean;
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

  // ---------------------------------------------------------------- services

  /** All service units with state (systemd ≥ 248 JSON output). */
  'services.list': define({
    schema: none,
    argv: () => ['systemctl', 'list-units', '--type=service', '--all', '--output=json', '--no-pager'],
  }),
  /** Enablement state of every service unit file. */
  'services.files': define({
    schema: none,
    argv: () => ['systemctl', 'list-unit-files', '--type=service', '--output=json', '--no-pager'],
  }),
  'service.start': define({
    schema: z.object({ unit: unitName }).strict(), privileged: true, target: (p) => p.unit,
    argv: (p) => ['systemctl', 'start', '--', p.unit],
  }),
  'service.restart': define({
    schema: z.object({ unit: unitName }).strict(), privileged: true, danger: 'confirm', target: (p) => p.unit,
    argv: (p) => ['systemctl', 'restart', '--', p.unit],
  }),
  'service.stop': define({
    schema: z.object({ unit: unitName }).strict(), privileged: true, danger: 'confirm', target: (p) => p.unit,
    argv: (p) => ['systemctl', 'stop', '--', p.unit],
  }),
  'service.enable': define({
    schema: z.object({ unit: unitName }).strict(), privileged: true, target: (p) => p.unit,
    argv: (p) => ['systemctl', 'enable', '--', p.unit],
  }),
  'service.disable': define({
    schema: z.object({ unit: unitName }).strict(), privileged: true, danger: 'confirm', target: (p) => p.unit,
    argv: (p) => ['systemctl', 'disable', '--', p.unit],
  }),

  // ---------------------------------------------------------------- journal

  /** Journal query with filters (JSON lines). --grep is a regex for journalctl, never a shell. */
  'journal.query': define({
    schema: z.object({
      lines: z.number().int().min(1).max(2000),
      priority: z.number().int().min(0).max(7),
      since: z.enum(['15m', '1h', '6h', '24h', '7d']),
      unit: unitName.optional(),
      identifier: z.string().regex(/^[a-zA-Z0-9@._-]{1,64}$/).optional(),
      // printable, single line (no control characters)
      grep: z.string().max(100).regex(/^[^\x00-\x1f\x7f]*$/).optional(),
      follow: z.boolean(),
    }).strict(),
    argv: (p) => {
      const since = { '15m': '-15min', '1h': '-1h', '6h': '-6h', '24h': '-24h', '7d': '-7d' }[p.since];
      const a = ['journalctl', '--output=json', '--no-pager', `--lines=${p.lines}`, `--priority=0..${p.priority}`, `--since=${since}`];
      if (p.unit) a.push(`--unit=${p.unit}`);
      if (p.identifier) a.push(`--identifier=${p.identifier}`);
      if (p.grep) a.push('--case-sensitive=false', `--grep=${p.grep}`);
      if (p.follow) a.push('--follow');
      return a;
    },
  }),

  // ---------------------------------------------------------------- updates

  /** Upgradable packages from the cached lists (no root, no network). */
  'updates.list': define({
    schema: none,
    argv: () => ['apt', 'list', '--upgradable'],
    environ: ['LC_ALL=C'],
  }),
  'updates.refresh': define({
    schema: none, privileged: true, target: () => 'apt-update',
    argv: () => ['apt-get', 'update', '-q', '-o', 'Acquire::Retries=3'],
  }),
  /** Full upgrade; keeps existing config files; output streamed to the UI. */
  'updates.upgrade': define({
    schema: none, privileged: true, danger: 'confirm', target: () => 'apt-full-upgrade',
    argv: () => ['apt-get', 'full-upgrade', '-y', '-q', '-o', 'Acquire::Retries=3',
      '-o', 'Dpkg::Options::=--force-confdef', '-o', 'Dpkg::Options::=--force-confold'],
    environ: ['DEBIAN_FRONTEND=noninteractive', 'LC_ALL=C'],
  }),

  // ---------------------------------------------------------------- power

  'power.reboot': define({
    schema: none, privileged: true, danger: 'type-name', target: () => 'reboot',
    argv: () => ['systemctl', 'reboot'],
  }),
  'power.poweroff': define({
    schema: none, privileged: true, danger: 'type-name', target: () => 'poweroff',
    argv: () => ['systemctl', 'poweroff'],
  }),

  // ---------------------------------------------------------------- security (read-only, root)

  'security.ufw': define({ schema: none, privileged: true, audit: false, argv: () => ['ufw', 'status', 'verbose'] }),
  'security.fail2ban': define({ schema: none, privileged: true, audit: false, argv: () => ['fail2ban-client', 'status', 'sshd'] }),
  'security.sshd': define({ schema: none, privileged: true, audit: false, argv: () => ['sshd', '-T'] }),
  'security.unban': define({
    schema: z.object({ ip: z.string().ip() }).strict(), privileged: true, danger: 'confirm', target: (p) => p.ip,
    argv: (p) => ['fail2ban-client', 'set', 'sshd', 'unbanip', p.ip],
  }),

  // ---------------------------------------------------------------- file manager
  // Permissions are the kernel's: as the logged-in user by default, as root only in
  // admin mode (elevatable). Paths are single argv elements, after "--" or -t/-T/-C.

  /** One directory level, NUL-separated: type, target type, size, mtime, mode, owner, group, link, name. */
  'files.list': define({
    schema: z.object({ path: absPath }).strict(), elevatable: true, binary: true,
    argv: (p) => ['find', p.path, '-mindepth', '1', '-maxdepth', '1', '-printf', '%y\\0%Y\\0%s\\0%T@\\0%m\\0%u\\0%g\\0%l\\0%f\\0'],
  }),
  /** Recursive name search (case-insensitive, same filesystem, depth ≤ 8); names relative to path. */
  'files.search': define({
    schema: z.object({ path: absPath, q: z.string().min(1).max(100).regex(/^[^\u0000-\u001f/]+$/) }).strict(), elevatable: true, binary: true,
    argv: (p) => ['find', p.path, '-xdev', '-mindepth', '1', '-maxdepth', '8', '-iname', `*${p.q.replace(/[*?[\]\\]/g, '\\$&')}*`,
      '-printf', '%y\\0%Y\\0%s\\0%T@\\0%m\\0%u\\0%g\\0%l\\0%P\\0'],
  }),
  'files.mkdir': define({
    schema: z.object({ path: absPath }).strict(), elevatable: true, target: (p) => p.path,
    argv: (p) => ['mkdir', '--', p.path],
  }),
  'files.touch': define({
    schema: z.object({ path: absPath }).strict(), elevatable: true, target: (p) => p.path,
    argv: (p) => ['touch', '--', p.path],
  }),
  /** Rename / move one item; never overwrites (--update=none-fail reports a clash), destination is the exact new path (-T). */
  'files.rename': define({
    schema: z.object({ from: mutablePath, to: mutablePath }).strict(), elevatable: true, target: (p) => `${p.from} -> ${p.to}`,
    argv: (p) => ['mv', '--update=none-fail', '-T', '--', p.from, p.to],
  }),
  'files.move': define({
    schema: z.object({ paths: z.array(mutablePath).min(1).max(500), dir: absPath }).strict(), elevatable: true,
    target: (p) => `${p.paths.length} -> ${p.dir}`,
    argv: (p) => ['mv', '--update=none-fail', '-t', p.dir, '--', ...p.paths],
  }),
  /** Copy into a directory, keeping attributes; never overwrites. */
  'files.copy': define({
    schema: z.object({ paths: z.array(absPath).min(1).max(500), dir: absPath }).strict(), elevatable: true,
    target: (p) => `${p.paths.length} -> ${p.dir}`,
    argv: (p) => ['cp', '-a', '--update=none-fail', '-t', p.dir, '--', ...p.paths],
  }),
  /** Copy one item to an exact new path ("nusxa" in the same folder). */
  'files.duplicate': define({
    schema: z.object({ from: absPath, to: absPath }).strict(), elevatable: true, target: (p) => `${p.from} -> ${p.to}`,
    argv: (p) => ['cp', '-a', '--update=none-fail', '-T', '--', p.from, p.to],
  }),
  'files.delete': define({
    schema: z.object({ paths: z.array(mutablePath).min(1).max(500) }).strict(), elevatable: true, danger: 'confirm', audit: true,
    target: (p) => p.paths.join(' '),
    argv: (p) => ['rm', '-rf', '--one-file-system', '--preserve-root=all', '--', ...p.paths],
  }),
  'files.chmod': define({
    schema: z.object({ paths: z.array(mutablePath).min(1).max(500), mode: z.string().regex(/^[0-7]{3,4}$/) }).strict(), elevatable: true,
    target: (p) => `${p.mode} ${p.paths.join(' ')}`,
    argv: (p) => ['chmod', p.mode, '--', ...p.paths],
  }),
  /** Total size of a folder in bytes. */
  'files.du': define({
    schema: z.object({ path: absPath }).strict(), elevatable: true,
    argv: (p) => ['du', '-sb', '-x', '--', p.path],
  }),
  /** .tar.gz of some entries of one folder (names relative to it). */
  'files.compress': define({
    schema: z.object({ dir: absPath, names: z.array(z.string().regex(FILE_NAME_RE)).min(1).max(500), out: absPath }).strict(),
    elevatable: true, target: (p) => p.out,
    argv: (p) => ['tar', '-czf', p.out, '-C', p.dir, '--', ...p.names],
  }),
  /** Unpack .tar(.gz/.xz/.bz2/.zst): GNU tar strips "/" and refuses "../" members; never overwrites. */
  'files.untar': define({
    schema: z.object({ archive: absPath, dir: absPath }).strict(), elevatable: true, target: (p) => p.archive,
    argv: (p) => ['tar', '-xf', p.archive, '-C', p.dir, '--no-same-owner', '--keep-old-files'],
  }),
  /** Unpack .zip with Python's zipfile (sanitises absolute and ".." member paths). */
  'files.unzip': define({
    schema: z.object({ archive: absPath, dir: absPath }).strict(), elevatable: true, target: (p) => p.archive,
    argv: (p) => ['python3', '-I', '-m', 'zipfile', '-e', p.archive, p.dir],
  }),

  // ---------------------------------------------------------------- my account

  /**
   * Change the logged-in user's own password: plain `passwd` in a pty, so PAM checks the
   * current password and the password policy. The passwords are typed into the pty by
   * account.ts and never appear in argv, logs or storage.
   */
  'account.passwd': define({
    schema: none, pty: true, environ: ['LC_ALL=C'], audit: true, target: () => 'own password',
    argv: () => ['passwd'],
  }),

  /** Create ~/.config/mirkomil-panel so settings.json can be saved. */
  'settings.mkdir': define({
    schema: none,
    argv: (_p, ctx) => ['mkdir', '-p', '--', `${ctx.user.home}/.config/mirkomil-panel`],
  }),
} satisfies Record<string, { schema: z.ZodTypeAny }>;

export type ActionId = keyof typeof actions;
export type ActionParams<K extends ActionId> = z.input<(typeof actions)[K]['schema']>;

export function actionMeta(id: ActionId): { privileged: boolean; danger: Danger; elevatable: boolean } {
  const def = actions[id] as unknown as ActionDef;
  return { privileged: !!def.privileged, danger: def.danger ?? 'none', elevatable: !!def.elevatable };
}

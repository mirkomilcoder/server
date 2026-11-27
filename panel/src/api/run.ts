import { cockpit, sessionUser } from './cockpit';
import type { CockpitProcessError, CockpitSpawnOptions } from './cockpit-types';
import { actions, type ActionDef, type ActionId, type ActionParams } from './actions';
import { oneLine } from './validate';

/*
 * The ONLY module that calls cockpit.spawn(). Everything else goes through
 * runAction(), which validates params against the whitelist in actions.ts.
 */

export class ActionError extends Error {
  constructor(
    readonly action: string,
    message: string,
    readonly details?: string,
    readonly problem?: string | null,
    readonly exitStatus?: number | null,
  ) {
    super(message);
    this.name = 'ActionError';
  }
}

export interface RunOptions {
  /**
   * Receive stdout chunks as they arrive (apt upgrade, journalctl -f, …). For `pty`
   * actions `send` answers interactive prompts.
   */
  onOutput?: (chunk: string, send: (input: string) => void) => void;
  /** Lets the caller stop a long-running process. */
  signal?: AbortSignal;
  /** Run an `elevatable` action as root (file manager admin mode). Ignored for other actions. */
  asAdmin?: boolean;
}

export async function runAction<K extends ActionId>(
  id: K,
  params: ActionParams<K>,
  opts: RunOptions = {},
): Promise<string> {
  const def = actions[id] as unknown as ActionDef;
  const parsed = def.schema.safeParse(params);
  if (!parsed.success) {
    throw new ActionError(id, 'invalid-params', parsed.error.issues.map((i) => i.message).join('; '));
  }

  const user = sessionUser();
  const argv = def.argv(parsed.data, { user });
  const spawnOpts: CockpitSpawnOptions = { err: 'message' };
  const elevated = !!def.privileged || (!!def.elevatable && !!opts.asAdmin);
  if (elevated) spawnOpts.superuser = 'require';
  if (def.environ) spawnOpts.environ = def.environ;
  if (def.binary) spawnOpts.binary = true;
  if (def.pty) {
    spawnOpts.pty = true;
    spawnOpts.err = 'out';
  }

  const audit = def.audit ?? elevated;
  const target = def.target ? def.target(parsed.data) : '-';

  const proc = cockpit().spawn(argv, spawnOpts);
  if (opts.onOutput) {
    const cb = opts.onOutput;
    const dec = new TextDecoder();
    proc.stream((chunk) => {
      const text = typeof chunk === 'string' ? chunk : dec.decode(chunk as unknown as Uint8Array, { stream: true });
      cb(text, (input) => proc.input(input, true));
    });
  }
  opts.signal?.addEventListener('abort', () => proc.close('terminated'), { once: true });

  try {
    const raw: unknown = await proc;
    const out = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as Uint8Array);
    if (audit) void writeAudit(user.name, id, target, 'ok');
    return out;
  } catch (e) {
    const err = e as CockpitProcessError;
    if (audit) void writeAudit(user.name, id, target, `fail(${err.exit_status ?? err.problem ?? '?'})`);
    throw new ActionError(id, err.problem ?? 'failed', err.message, err.problem, err.exit_status);
  }
}

/**
 * Activity log entry: `logger -t mirkomil-panel "<user> <action> <target> <result>"`.
 * The message is ONE argv element, so nothing in it can be interpreted by a shell.
 * Note: any local user can write lines with this tag — see SECURITY.md.
 */
async function writeAudit(user: string, action: string, target: string, result: string) {
  const msg = oneLine(`${user} ${action} ${target} ${result}`);
  try {
    await cockpit().spawn(['logger', '-t', 'mirkomil-panel', '--', msg], { err: 'ignore' });
  } catch {
    /* auditing must never break the action itself */
  }
}

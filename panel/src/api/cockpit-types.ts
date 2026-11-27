/*
 * Minimal hand-written types for the parts of cockpit.js we use.
 * Reference: https://docs.cockpit-project.org/cockpit-guide/latest/guide/
 * (We deliberately don't copy upstream's GPL cockpit.d.ts; this covers our subset.)
 */

export interface CockpitUser {
  id: number;
  gid?: number;
  name: string;
  full_name: string;
  home: string;
  shell?: string;
  groups?: string[];
}

export interface CockpitInfo {
  user?: CockpitUser;
  os_release?: Record<string, string>;
  ws?: { version: string };
  channels?: Record<string, string[]>;
}

export interface CockpitSpawnOptions {
  /** "require" = run as root (needs admin access); "try" = root if possible. */
  superuser?: 'try' | 'require';
  /** "message" puts stderr into the error message; "out" merges it into stdout. */
  err?: 'out' | 'ignore' | 'message';
  environ?: string[];
  directory?: string;
  pty?: boolean;
  /** Output as bytes (Uint8Array). Text channels drop output that contains NUL bytes. */
  binary?: boolean;
}

/** A spawned process: a Promise of stdout plus streaming helpers. */
export interface CockpitProcess extends Promise<string> {
  stream(cb: (data: string) => void): CockpitProcess;
  input(data?: string | null, stream?: boolean): CockpitProcess;
  close(problem?: string): void;
}

/** Shape of the error a failed spawn rejects with. */
export interface CockpitProcessError {
  message: string;
  problem: string | null;
  exit_status: number | null;
  exit_signal: string | null;
}

export interface CockpitSyntax<T> {
  parse(text: string): T;
  stringify(value: T): string;
}

export interface CockpitFileOptions<T> {
  syntax?: CockpitSyntax<T>;
  /** Content is a Uint8Array instead of text. */
  binary?: boolean;
  superuser?: 'try' | 'require';
  max_read_size?: number;
}

export interface CockpitFile<T> {
  path: string;
  /** Resolves with null when the file does not exist (not an error). */
  read(): Promise<T | null>;
  /** Atomic replace (rename). Passing null deletes the file. */
  replace(content: T | null, expectedTag?: string): Promise<string>;
  watch(
    cb: (content: T | null, tag: string, error?: CockpitProcessError) => void,
    opts?: { read?: boolean },
  ): { remove(): void };
  close(): void;
}

export interface CockpitPermission {
  /** null while unknown / still loading. */
  allowed: boolean | null;
  addEventListener(ev: 'changed', cb: () => void): void;
  removeEventListener(ev: 'changed', cb: () => void): void;
  close(): void;
}

export interface CockpitLocation {
  path: string[];
  options: Record<string, string | string[]>;
  href: string;
  go(path: string | string[], options?: Record<string, string>): void;
  replace(path: string | string[], options?: Record<string, string>): void;
}

/** cockpit.http(): HTTP client to a local port or Unix socket, via the bridge. */
export interface CockpitHttpClient {
  get(path: string, params?: Record<string, string>, headers?: Record<string, string>): Promise<string>;
  post(path: string, body?: string | object, headers?: Record<string, string>): Promise<string>;
  close(): void;
}

export interface CockpitHttpError {
  status?: number;
  reason?: string;
  message: string;
  problem?: string | null;
}

/** Minimal D-Bus proxy surface we use (cockpit.dbus(...).proxy(iface, path)). */
export interface CockpitDBusProxy {
  valid: boolean;
  wait(): Promise<void>;
  call(method: string, args: unknown[]): Promise<unknown[]>;
  addEventListener(ev: string, cb: (...args: never[]) => void): void;
  removeEventListener(ev: string, cb: (...args: never[]) => void): void;
  [prop: string]: unknown;
}

export interface CockpitDBusClient {
  proxy(iface: string, path: string): CockpitDBusProxy;
  close(): void;
}

/** Raw channel (we use fsreplace1 for chunked uploads). */
export interface CockpitChannelControl {
  command: string;
  problem?: string;
  message?: string;
  bytes?: number;
  [key: string]: unknown;
}

export interface CockpitChannel {
  send(data: string | Uint8Array): void;
  control(options: CockpitChannelControl): void;
  close(problem?: string): void;
  addEventListener(ev: 'control' | 'close', cb: (ev: unknown, msg: CockpitChannelControl) => void): void;
  addEventListener(ev: 'message', cb: (ev: unknown, data: string | Uint8Array) => void): void;
}

export interface CockpitTransport {
  csrf_token?: string;
  /** Absolute URL of a cockpit-ws path for this session, e.g. uri("channel/<token>"). */
  uri(suffix?: string): string;
}

export interface Cockpit {
  channel(options: Record<string, unknown>): CockpitChannel;
  transport?: CockpitTransport;
  dbus(name: string | null, options?: { bus?: 'system' | 'session' | 'internal'; superuser?: 'try' | 'require' }): CockpitDBusClient;
  http(endpoint: string | number, options?: { superuser?: 'try' | 'require' }): CockpitHttpClient;
  init?: () => Promise<void>;
  info?: CockpitInfo;
  user(): Promise<CockpitUser>;
  spawn(argv: string[], options?: CockpitSpawnOptions): CockpitProcess;
  file<T = string>(path: string, options?: CockpitFileOptions<T>): CockpitFile<T>;
  permission(options?: { admin?: boolean; group?: string }): CockpitPermission;
  readonly location: CockpitLocation;
  jump(path: string | string[], host?: string | null): void;
  logout(reload?: boolean): void;
  hidden: boolean;
  addEventListener(ev: 'locationchanged' | 'visibilitychange', cb: () => void): void;
  removeEventListener(ev: 'locationchanged' | 'visibilitychange', cb: () => void): void;
  /** Marker set only by our dev mock. */
  __mock?: boolean;
}

declare global {
  interface Window {
    cockpit?: Cockpit;
  }
}

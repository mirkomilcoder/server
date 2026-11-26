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

export interface Cockpit {
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

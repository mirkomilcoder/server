import { cockpit } from './cockpit';
import type { CockpitChannel } from './cockpit-types';
import { runAction } from './run';
import { absPath } from './validate';

/*
 * File manager data layer. Directory operations go through the whitelist
 * (runAction); file contents use Cockpit's file channels directly — reads and
 * writes happen as the logged-in user, or as root in admin mode. Nothing here
 * ever renders file content as HTML.
 */

export type EntryType = 'dir' | 'file' | 'link' | 'other';

export interface Entry {
  name: string;
  /** For search results: path relative to the searched folder. */
  rel?: string;
  type: EntryType;
  /** Symlink: type of what it points to ("dir" makes it browsable). */
  target?: EntryType | 'broken';
  linkTo?: string;
  size: number;
  mtime: number;
  mode: string;
  owner: string;
  group: string;
}

const TYPE: Record<string, EntryType> = { d: 'dir', f: 'file', l: 'link' };
const toType = (c: string): EntryType => TYPE[c] ?? 'other';

/** Parse find's NUL-separated `-printf` output (9 fields per entry). */
export function parseFind(out: string): Entry[] {
  const f = out.split('\0');
  const list: Entry[] = [];
  for (let i = 0; i + 8 < f.length; i += 9) {
    const [y, Y, size, mtime, mode, owner, group, link, name] = f.slice(i, i + 9);
    const type = toType(y);
    list.push({
      name: name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name,
      rel: name.includes('/') ? name : undefined,
      type,
      target: type === 'link' ? (Y === 'N' || Y === 'L' ? 'broken' : toType(Y)) : undefined,
      linkTo: type === 'link' ? link : undefined,
      size: Number(size) || 0,
      mtime: Number(mtime) || 0,
      mode: mode.padStart(3, '0'),
      owner,
      group,
    });
  }
  return list;
}

export const isDirLike = (e: Entry) => e.type === 'dir' || (e.type === 'link' && e.target === 'dir');

/** "/a/b" + "c" → "/a/b/c" (name already validated). */
export const join = (dir: string, name: string) => (dir === '/' ? `/${name}` : `${dir}/${name}`);
export const parent = (p: string) => (p === '/' ? '/' : p.slice(0, p.lastIndexOf('/')) || '/');
export const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** Normalise user-typed paths ("~", "a/../b", trailing "/"); null when invalid. */
export function normalize(input: string, home: string, cwd: string): string | null {
  let p = input.trim();
  if (p === '~' || p.startsWith('~/')) p = home + p.slice(1);
  if (!p.startsWith('/')) p = join(cwd, p);
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  const res = '/' + out.join('/');
  return absPath.safeParse(res).success ? res : null;
}

export async function list(path: string, asAdmin: boolean): Promise<Entry[]> {
  return parseFind(await runAction('files.list', { path }, { asAdmin }));
}

export async function search(path: string, q: string, asAdmin: boolean): Promise<Entry[]> {
  // find exits 1 when some subfolder is unreadable but still prints what it found: keep that
  let seen = '';
  try {
    return parseFind(await runAction('files.search', { path, q }, { asAdmin, onOutput: (chunk) => { seen += chunk; } }));
  } catch (e) {
    if ((e as { exitStatus?: number | null }).exitStatus === 1 && seen) return parseFind(seen);
    if ((e as { exitStatus?: number | null }).exitStatus === 1) return [];
    throw e;
  }
}

// ---------------------------------------------------------------- content

export const TEXT_LIMIT = 4 * 1024 * 1024;
export const PREVIEW_LIMIT = 24 * 1024 * 1024;

const su = (asAdmin: boolean) => (asAdmin ? ('require' as const) : undefined);

export interface TextFile {
  text: string;
  /** Cockpit change tag: saving fails if the file changed meanwhile. */
  tag: string;
}

export class BinaryFileError extends Error {}

/** Read a text file for the editor (≤ 4 MB, refuses binary content). */
export async function readText(path: string, asAdmin: boolean): Promise<TextFile> {
  const f = cockpit().file(path, { superuser: su(asAdmin), max_read_size: TEXT_LIMIT });
  try {
    return await new Promise<TextFile>((resolve, reject) => {
      const w = f.watch((content, tag, err) => {
        w.remove();
        if (err) return reject(err);
        const text = content ?? '';
        if (text.includes('\u0000')) return reject(new BinaryFileError('binary'));
        resolve({ text, tag });
      });
    });
  } finally {
    f.close();
  }
}

/** Save; `tag` guards against overwriting someone else's change. Returns the new tag. */
export async function writeText(path: string, text: string, tag: string | undefined, asAdmin: boolean): Promise<string> {
  const f = cockpit().file(path, { superuser: su(asAdmin) });
  try {
    return await f.replace(text, tag);
  } finally {
    f.close();
  }
}

/** Raw bytes (image preview / small downloads in dev). */
export async function readBytes(path: string, asAdmin: boolean): Promise<Uint8Array> {
  const f = cockpit().file<Uint8Array>(path, { binary: true, superuser: su(asAdmin), max_read_size: PREVIEW_LIMIT });
  try {
    return (await f.read()) ?? new Uint8Array();
  } finally {
    f.close();
  }
}

// ---------------------------------------------------------------- upload / download

const CHUNK = 256 * 1024;
const WINDOW = 8 * 1024 * 1024;

/**
 * Stream a File to `path` over an fsreplace1 channel in 256 KB chunks with flow
 * control (the bridge acknowledges bytes; at most 8 MB in flight). The target is
 * written to a temporary file and renamed only when complete; without `overwrite`
 * it fails if the file already exists.
 */
export function upload(
  file: File, path: string, asAdmin: boolean, overwrite: boolean, onProgress: (sent: number) => void, signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ch: CockpitChannel = cockpit().channel({
      payload: 'fsreplace1', path, binary: true, superuser: su(asAdmin), 'send-acks': 'bytes',
      ...(overwrite ? {} : { tag: '-' }), // "-" = the file must not exist yet
    });
    let sent = 0;
    let acked = 0;
    let waiting: (() => void) | null = null;
    let done = false;

    ch.addEventListener('control', (_ev, msg) => {
      if (msg.command === 'ack' && typeof msg.bytes === 'number') {
        acked += msg.bytes;
        onProgress(Math.min(acked, file.size));
        waiting?.();
        waiting = null;
      }
    });
    ch.addEventListener('close', (_ev, msg) => {
      done = true;
      waiting?.();
      if (msg.problem) reject(Object.assign(new Error(msg.message || msg.problem), { problem: msg.problem }));
      else {
        onProgress(file.size);
        resolve();
      }
    });
    signal?.addEventListener('abort', () => ch.close('cancelled'), { once: true });

    (async () => {
      while (sent < file.size && !done) {
        while (sent - acked > WINDOW && !done) await new Promise<void>((r) => (waiting = r));
        if (done) return;
        const buf = new Uint8Array(await file.slice(sent, sent + CHUNK).arrayBuffer());
        ch.send(buf);
        sent += buf.length;
      }
      if (!done) ch.control({ command: 'done' });
    })().catch((e) => {
      ch.close('internal-error');
      reject(e);
    });
  });
}

/**
 * Download through Cockpit's external channel: the browser streams the file
 * straight from an fsread1 channel (any size, no memory copy). The URL carries
 * the session's CSRF token, so it only works inside this logged-in session.
 */
export function downloadUrl(path: string, asAdmin: boolean): string | null {
  const tr = cockpit().transport;
  if (!tr?.csrf_token) return null;
  const name = baseName(path).replace(/["\\\r\n]/g, '_');
  const opts = {
    payload: 'fsread1', binary: 'raw', path, max_read_size: 1024 ** 4,
    ...(asAdmin ? { superuser: 'require' } : {}),
    external: {
      'content-disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(baseName(path))}`,
      'content-type': 'application/octet-stream',
    },
  };
  const query = btoa(unescape(encodeURIComponent(JSON.stringify(opts))));
  // transport.uri() is the ws:// address; the HTTP download uses the same path
  return `${new URL(tr.uri(`channel/${tr.csrf_token}`)).pathname}?${query}`;
}

export function triggerDownload(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---------------------------------------------------------------- display helpers

const TEXT_EXT = new Set([
  'txt', 'md', 'log', 'conf', 'cfg', 'ini', 'env', 'json', 'yaml', 'yml', 'toml', 'xml', 'csv', 'tsv', 'sh', 'bash', 'zsh',
  'py', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'scss', 'html', 'htm', 'php', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h',
  'cpp', 'hpp', 'sql', 'service', 'timer', 'socket', 'rules', 'list', 'sources', 'properties', 'gitignore', 'dockerignore', 'lock',
]);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif']);
const ARCHIVE_RE = /\.(tar|tar\.gz|tgz|tar\.xz|txz|tar\.bz2|tbz2|tar\.zst)$/i;

export const ext = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');
export const isImage = (name: string) => IMAGE_EXT.has(ext(name));
export const isTar = (name: string) => ARCHIVE_RE.test(name);
export const isZip = (name: string) => ext(name) === 'zip';
/** Likely text: known extension, dotfile, or no extension (Dockerfile, Makefile…). */
export const isTextLike = (name: string) => TEXT_EXT.has(ext(name)) || name.startsWith('.') || !name.includes('.');

export const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
};

export function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`;
}

/** "755" → "rwxr-xr-x" */
export function modeString(mode: string): string {
  const m = mode.slice(-3);
  return [...m].map((d) => {
    const n = Number(d);
    return `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`;
  }).join('');
}

import { z } from 'zod';

/*
 * Input validation shared by every action. Anything that ends up in an argv
 * array or a generated file must pass through one of these first.
 */

export const UNIT_RE = /^[a-zA-Z0-9@._-]+\.service$/;
export const BOT_NAME_RE = /^[a-z0-9_-]{2,32}$/;

export const unitName = z.string().regex(UNIT_RE, 'Noto‘g‘ri servis nomi');
export const botName = z.string().regex(BOT_NAME_RE, 'Bot nomi: 2–32 ta a-z, 0-9, _ yoki -');

/** Roots under which user-supplied paths are allowed (home is filled at runtime). */
export function allowedRoots(home: string): string[] {
  return [home.replace(/\/+$/, '') + '/', '/opt/', '/srv/'];
}

/**
 * Absolute path, no "..", no "//", only safe characters, and under an allowed root.
 * We check the string itself (not the filesystem) — symlinks are handled later by
 * running bots as the unprivileged user, never root.
 */
export function safePath(home: string) {
  const roots = allowedRoots(home);
  return z
    .string()
    .min(2)
    .max(4096)
    .refine((p) => p.startsWith('/'), 'Yo‘l / bilan boshlanishi kerak')
    .refine((p) => !p.split('/').includes('..'), '".." ishlatish mumkin emas')
    .refine((p) => !p.includes('//'), 'Yo‘lda "//" bo‘lmasin')
    .refine((p) => /^[A-Za-z0-9/._@+-]+$/.test(p), 'Yo‘lda faqat harf, raqam va / . _ - @ + bo‘lsin')
    .refine((p) => roots.some((r) => p.startsWith(r)), `Ruxsat etilgan joylar: ${roots.join(', ')}`);
}

/** Make free text safe to put in a single syslog line (audit log). */
export function oneLine(s: string, max = 200): string {
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, max);
}

// ---------------------------------------------------------------- file manager

/** Top-level directories the file manager never deletes, moves or chmods (also "/"). */
export const PROTECTED_PATHS = new Set([
  '/', '/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/lib32', '/lib64', '/media', '/mnt', '/opt', '/proc',
  '/root', '/run', '/sbin', '/snap', '/srv', '/sys', '/tmp', '/usr', '/var', '/var/lib', '/var/log', '/usr/local',
]);

/** One path component: any printable text except "/", never "." or "..". */
export const FILE_NAME_RE = /^(?!\.{1,2}$)[^/\u0000-\u001f\u007f]{1,255}$/;

/**
 * Absolute, already-normalised path (no "." / ".." / empty segments). Any
 * printable characters are fine: paths only ever travel as single argv elements.
 */
export const absPath = z
  .string()
  .max(4096)
  .refine((p) => p === '/' || (p.startsWith('/') && !p.endsWith('/')), 'Yo‘l / bilan boshlanishi kerak')
  .refine((p) => p === '/' || p.slice(1).split('/').every((s) => FILE_NAME_RE.test(s)), 'Yo‘l noto‘g‘ri');

/** A path that may be changed destructively (delete / move / rename / chmod). */
export const mutablePath = absPath.refine((p) => !PROTECTED_PATHS.has(p), 'Bu tizim papkasi — o‘zgartirib bo‘lmaydi');

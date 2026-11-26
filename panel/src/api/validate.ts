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

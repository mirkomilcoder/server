import { runAction } from './run';

/* Journal entries from `journalctl --output=json` (one JSON object per line). */

export type Level = 'err' | 'warn' | 'info' | 'debug';

export interface LogEntry {
  /** cursor: unique, used as React key */
  id: string;
  time: Date;
  level: Level;
  source: string;
  message: string;
}

function levelOf(priority: string | undefined): Level {
  const p = Number(priority ?? 6);
  if (p <= 3) return 'err';
  if (p === 4) return 'warn';
  if (p <= 6) return 'info';
  return 'debug';
}

/** journald stores non-UTF8 messages as byte arrays. */
function messageOf(m: unknown): string {
  if (typeof m === 'string') return m;
  if (Array.isArray(m)) return new TextDecoder().decode(new Uint8Array(m as number[]));
  return '';
}

export function parseJournalLine(line: string): LogEntry | null {
  try {
    const j = JSON.parse(line) as Record<string, unknown>;
    const us = Number(j.__REALTIME_TIMESTAMP);
    return {
      id: String(j.__CURSOR ?? `${us}-${Math.random()}`),
      time: new Date(us / 1000),
      level: levelOf(j.PRIORITY as string | undefined),
      source: String(j.SYSLOG_IDENTIFIER ?? j._COMM ?? j._SYSTEMD_UNIT ?? '?'),
      message: messageOf(j.MESSAGE),
    };
  } catch {
    return null;
  }
}

/** Streams entries to `onEntries` until the returned stop() is called. */
export function followJournal(lines: number, onEntries: (e: LogEntry[]) => void, onError: (e: unknown) => void): () => void {
  const ctrl = new AbortController();
  let buf = '';
  runAction('journal.follow', { lines }, {
    signal: ctrl.signal,
    onOutput: (chunk) => {
      if (ctrl.signal.aborted) return; // late data after stop()
      buf += chunk;
      const parts = buf.split('\n');
      buf = parts.pop() ?? '';
      const entries = parts.map(parseJournalLine).filter((e): e is LogEntry => e !== null);
      if (entries.length) onEntries(entries);
    },
  }).catch((e) => {
    if (!ctrl.signal.aborted) onError(e);
  });
  return () => ctrl.abort();
}

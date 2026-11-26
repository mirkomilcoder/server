import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, Pause, Play, Search } from 'lucide-react';
import { parseJournalLine, type LogEntry } from '@/api/journal';
import { runAction } from '@/api/run';
import { routeOption } from '@/router';
import { useT, type TranslationKey } from '@/i18n';
import { useToast } from '@/state/toasts';
import { Card } from '@/widgets/Card';
import { Skel } from '@/widgets/Skeletons';
import type { PageProps } from './registry';

/*
 * Journal viewer: filter by service, level, time range and text; live follow;
 * copy / download as plain text. Output is rendered as text only (never HTML).
 */

type Since = '15m' | '1h' | '6h' | '24h' | '7d';
const PRIORITIES = [3, 4, 6, 7] as const;
const SINCE: Since[] = ['15m', '1h', '6h', '24h', '7d'];
const MAX = 1500;

export default function LogsPage(_props: PageProps) {
  const { t, locale } = useT();
  const toast = useToast();
  const [unit, setUnit] = useState(routeOption('unit') ?? '');
  const [priority, setPriority] = useState<number>(6);
  const [since, setSince] = useState<Since>('1h');
  const [grep, setGrep] = useState('');
  const [grepApplied, setGrepApplied] = useState('');
  const [follow, setFollow] = useState(true);
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [units, setUnits] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  // service names for the picker
  useEffect(() => {
    runAction('services.list', {})
      .then((out) => setUnits((JSON.parse(out) as { unit: string }[]).map((u) => u.unit).sort()))
      .catch(() => {});
  }, []);

  // (re)query whenever a filter changes; with "follow" the same process keeps streaming
  useEffect(() => {
    const ctrl = new AbortController();
    let buf = '';
    setEntries(null);
    const params = {
      lines: 500, priority, since, follow,
      ...(unit && /\.service$/.test(unit) ? { unit } : {}),
      ...(grepApplied ? { grep: grepApplied } : {}),
    };
    const collected: LogEntry[] = [];
    let flush = 0;
    const push = () => {
      flush = 0;
      setEntries((old) => [...(old ?? []), ...collected.splice(0)].slice(-MAX));
    };
    runAction('journal.query', params, {
      signal: ctrl.signal,
      onOutput: (chunk) => {
        if (ctrl.signal.aborted) return;
        buf += chunk;
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';
        for (const p of parts) {
          const e = parseJournalLine(p);
          if (e) collected.push(e);
        }
        if (!flush) flush = window.setTimeout(push, 120); // batch renders
      },
    })
      .then(() => { if (!ctrl.signal.aborted) { push(); setEntries((e) => e ?? []); } })
      .catch(() => { if (!ctrl.signal.aborted) setEntries((e) => e ?? []); });
    // a quiet filter in follow mode: show "empty" instead of a skeleton forever
    const quiet = window.setTimeout(() => setEntries((e) => e ?? []), 2500);
    return () => { ctrl.abort(); window.clearTimeout(flush); window.clearTimeout(quiet); };
  }, [unit, priority, since, grepApplied, follow]);

  useEffect(() => {
    if (box.current && atBottom.current) box.current.scrollTop = box.current.scrollHeight;
  }, [entries]);

  const fmt = useMemo(() => new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }), [locale]);
  const asText = () => (entries ?? []).map((e) => `${e.time.toISOString()} ${e.level.toUpperCase()} ${e.source}: ${e.message}`).join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      toast({ kind: 'success', title: t('logs.copied') });
    } catch {
      toast({ kind: 'error', title: t('action.failed') });
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([asText()], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `journal-${unit || 'all'}-${new Date().toISOString().slice(0, 16).replace(':', '')}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('logs.title')}</h1>
          <p className="muted">{entries ? t('logs.count', { n: entries.length }) : t('common.loading')}</p>
        </div>
        <div className="page-head__actions">
          <button className={`btn${follow ? ' btn--accent' : ''}`} onClick={() => setFollow(!follow)} aria-pressed={follow}>
            {follow ? <Pause size={16} /> : <Play size={16} />} {t('logs.follow')}
          </button>
          <button className="btn" onClick={copy} disabled={!entries?.length}><Copy size={16} /> {t('logs.copy')}</button>
          <button className="btn" onClick={download} disabled={!entries?.length}><Download size={16} /> {t('logs.download')}</button>
        </div>
      </div>

      <div className="filters">
        <label className="filter">
          <span>{t('logs.unit')}</span>
          <select className="select" value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="">{t('logs.allUnits')}</option>
            {unit && !units.includes(unit) && <option value={unit}>{unit}</option>}
            {units.map((u) => <option key={u} value={u}>{u.replace(/\.service$/, '')}</option>)}
          </select>
        </label>
        <label className="filter">
          <span>{t('logs.priority')}</span>
          <select className="select" value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{t(`logs.p${p}` as TranslationKey)}</option>)}
          </select>
        </label>
        <label className="filter">
          <span>{t('logs.since')}</span>
          <select className="select" value={since} onChange={(e) => setSince(e.target.value as Since)}>
            {SINCE.map((s) => <option key={s} value={s}>{t(`logs.s${s}` as TranslationKey)}</option>)}
          </select>
        </label>
        <form className="filter filter--grow" onSubmit={(e) => { e.preventDefault(); setGrepApplied(grep.trim()); }}>
          <span>&nbsp;</span>
          <span className="input-wrap">
            <Search size={17} aria-hidden />
            <input className="input" placeholder={t('logs.search')} value={grep} maxLength={100}
              onChange={(e) => setGrep(e.target.value)} onBlur={() => setGrepApplied(grep.trim())} />
          </span>
        </form>
      </div>

      <Card className="logs-card">
        <div className="console console--logs" ref={box} role="log"
          onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
          {entries === null ? (
            <Skel h={16} w="60%" />
          ) : entries.length === 0 ? (
            <div className="console__line subtle">{t('logs.empty')}</div>
          ) : (
            entries.map((e) => (
              <div className="console__line" key={e.id}>
                <span className="console__time">{fmt.format(e.time)}</span>
                <span className={`lvl lvl--${e.level}`}>{e.level.toUpperCase().padEnd(5)}</span>
                <span className="console__src">{e.source}</span>
                {e.message}
              </div>
            ))
          )}
        </div>
        <p className="card__meta" style={{ marginTop: 10 }}>{t('logs.journalNote')}</p>
      </Card>
    </>
  );
}

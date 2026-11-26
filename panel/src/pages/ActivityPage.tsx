import { useMemo } from 'react';
import { Bot, User } from 'lucide-react';
import { parseJournalLine } from '@/api/journal';
import { runAction } from '@/api/run';
import { usePoll } from '@/hooks/usePoll';
import { useT } from '@/i18n';
import { useGuardian } from '@/state/guardian';
import { Card, MotionGrid } from '@/widgets/Card';
import { RowsSkeleton } from '@/widgets/Skeletons';
import type { PageProps } from './registry';

/*
 * Activity log = journal entries tagged "mirkomil-panel"
 * ("<user> <action> <target> <result>", written by run.ts) merged with
 * Guardian's automatic actions. Note (SECURITY.md): any local user can write
 * this tag, so it is a usage trail, not tamper-proof evidence.
 */

interface Row {
  key: string;
  time: Date;
  who: string;
  action: string;
  target: string;
  ok: boolean;
  source: 'panel' | 'guardian';
}

async function loadPanelActivity(): Promise<Row[]> {
  const out = await runAction('journal.query', { lines: 300, priority: 7, since: '7d', identifier: 'mirkomil-panel', follow: false });
  return out
    .split('\n')
    .map(parseJournalLine)
    .filter((e): e is NonNullable<typeof e> => !!e)
    .map((e) => {
      const [who = '?', action = '?', target = '-', ...rest] = e.message.split(' ');
      const result = rest.join(' ') || 'ok';
      return { key: e.id, time: e.time, who, action, target, ok: result === 'ok', source: 'panel' as const };
    });
}

export default function ActivityPage(_props: PageProps) {
  const { t, locale } = useT();
  const panel = usePoll(loadPanelActivity, 15_000);
  const { events } = useGuardian();
  const fmt = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

  const rows = useMemo(() => {
    const guardianRows: Row[] = (events ?? [])
      .filter((e) => e.kind === 'action')
      .map((e) => ({
        key: `g${e.id}`, time: new Date(e.ts * 1000), who: e.actor, action: e.title, target: e.check_id ?? '-',
        ok: e.severity !== 'warn' && e.severity !== 'crit', source: 'guardian' as const,
      }));
    return [...(panel.data ?? []), ...guardianRows].sort((a, b) => b.time.getTime() - a.time.getTime());
  }, [panel.data, events]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('activityPage.title')}</h1>
          <p className="muted">{t('activityPage.intro')}</p>
        </div>
      </div>
      <MotionGrid className="grid">
        <Card>
          {!panel.data && !panel.error ? (
            <RowsSkeleton rows={6} h={40} />
          ) : rows.length === 0 ? (
            <p className="muted" style={{ padding: 20, textAlign: 'center' }}>{t('activityPage.empty')}</p>
          ) : (
            <div className="act-table" role="table">
              <div className="act-row act-row--head" role="row">
                <span>{t('activityPage.col.time')}</span>
                <span>{t('activityPage.col.user')}</span>
                <span>{t('activityPage.col.action')}</span>
                <span>{t('activityPage.col.target')}</span>
                <span>{t('activityPage.col.result')}</span>
              </div>
              {rows.map((r) => (
                <div className="act-row" role="row" key={r.key}>
                  <span className="mono subtle">{fmt.format(r.time)}</span>
                  <span className="act-row__who">
                    {r.source === 'guardian' ? <Bot size={15} aria-hidden /> : <User size={15} aria-hidden />}
                    {r.who}
                  </span>
                  <span className="mono">{r.action}</span>
                  <span className="mono subtle">{r.target}</span>
                  <span><span className={`pill ${r.ok ? 'pill--success' : 'pill--danger'}`}>{r.ok ? 'ok' : t('svc.failed')}</span></span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </MotionGrid>
    </>
  );
}
